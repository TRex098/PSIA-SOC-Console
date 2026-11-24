
"use strict";
const PSIAModel = (() => {
  const maxTextLength = 4000;
  const stop = new Set("a an and are as at by for from in is it of on or the to was were with".split(" "));
  const words = text => (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter(word => !stop.has(word));
  const sensitive = [
    [/\b\d{5}-\d{7}-\d\b/g, "[CNIC]"],
    [/\b(?:\+92[- ]?|0)3\d{2}[- ]?\d{7}\b/g, "[PHONE]"],
    [/\b[A-Z]{2}\d{7}\b/g, "[DOCUMENT]"],
    [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL]"],
  ];
  const injection = /\b(?:ignore|disregard|override|bypass)\s+(?:\w+\s+){0,3}(?:instructions|rules|approval|policy)|\b(?:mark|classify)\s+(?:\w+\s+){0,3}(?:benign|compliant)|\b(?:already|pre)[ -]approved\b|\b(?:system prompt|respond only)\b/i;

  function guard(text) {
    if (typeof text !== "string" || !text.trim()) {
      return {masked: "[Missing or invalid alert description]", matches: 0, flagged: false,
        issue: "A non-empty text description is required. Send this record for manual review."};
    }
    if (text.length > maxTextLength) {
      return {masked: "[Alert description exceeds 4,000 characters]", matches: 0, flagged: false,
        issue: "The description exceeds the input limit. Shorten it or review the original record manually."};
    }
    let matches = 0;
    let masked = text;
    for (const [pattern, replacement] of sensitive) {
      masked = masked.replace(pattern, () => { matches += 1; return replacement; });
    }
    return {masked, matches, flagged: injection.test(masked), issue: null};
  }

  function train(records) {
    if (!Array.isArray(records) || !records.length) throw new Error("Labeled training descriptions are required.");
    const vocab = new Set();
    const classes = Object.fromEntries(["Attack", "Benign"].map(name => [name, {docs: 0, total: 0, tokens: new Map()}]));
    for (const [name, body] of records) {
      const group = classes[name];
      if (!group || typeof body !== "string" || !body.trim() || body.length > maxTextLength) {
        throw new Error("Each training record needs an Attack or Benign label and a valid description.");
      }
      group.docs += 1;
      for (const token of words(body)) {
        vocab.add(token);
        group.total += 1;
        group.tokens.set(token, (group.tokens.get(token) || 0) + 1);
      }
    }
    if (Object.values(classes).some(group => !group.docs || !group.total)) {
      throw new Error("Training must include text examples of both Attack and Benign.");
    }
    return body => {
      const tokens = typeof body === "string" ? words(body.slice(0, maxTextLength)) : [];
      const known = tokens.filter(token => vocab.has(token));
      const scores = Object.values(classes).map(group =>
        Math.log(group.docs / records.length) + known.reduce((sum, token) =>
          sum + Math.log(((group.tokens.get(token) || 0) + 1) / (group.total + vocab.size)), 0));
      const probability = 1 / (1 + Math.exp(scores[1] - scores[0]));
      const counts = new Map();
      for (const token of known) counts.set(token, (counts.get(token) || 0) + 1);
      const contributions = [...counts].map(([term, count]) => {
        const weights = Object.values(classes).map(group =>
          Math.log(((group.tokens.get(term) || 0) + 1) / (group.total + vocab.size)));
        return {term, weight: count * (weights[0] - weights[1])};
      }).sort((left, right) => Math.abs(right.weight) - Math.abs(left.weight));
      return {probability, known, totalTerms: tokens.length,
        vocabularyCoverage: tokens.length ? known.length / tokens.length : 0, contributions};
    };
  }

  function assess(alert, assets, predict) {
    const clean = guard(alert.text);
    const asset = assets[alert.asset];
    if (!asset) throw new Error("Unknown asset " + alert.asset);
    const inputIssue = clean.issue || (!Number.isInteger(alert.severity) || alert.severity < 1 || alert.severity > 5
      ? "Severity must be a whole number from 1 to 5. Manual review is required." : null);
    const result = predict && !inputIssue ? predict(clean.masked) : null;
    const rules = inputIssue ? "Review" : alert.severity >= 4 ? "Attack" : "Benign";
    let verdict = rules;
    let reason = "Fallback threshold: SIEM severity of 4 or 5 escalates.";
    if (result) {
      const unfamiliar = new Set(result.known).size < 2 || result.vocabularyCoverage < 0.25;
      verdict = unfamiliar ? "Review" : result.probability >= 0.66 ? "Attack" :
        result.probability <= 0.34 ? "Benign" : "Review";
      reason = unfamiliar ? "Too little familiar vocabulary. Manual review is required." :
        verdict === "Review" ? "The model score is between the decision thresholds. Manual review is required." :
        "The model score crossed the " + (verdict === "Attack" ? "66% attack" : "34% benign") + " threshold.";
    }
    if (alert.safety && verdict === "Benign") {
      verdict = "Review";
      reason = "Safety-sensitive event requires review.";
    }
    if (clean.flagged) {
      verdict = "Review";
      reason = "Instruction-like text requires manual review.";
    }
    if (inputIssue) {
      verdict = "Review";
      reason = inputIssue;
    }
    return {id: alert.id, time: alert.time, source: alert.source, asset: alert.asset, name: asset.name,
      owner: asset.owner, severity: inputIssue ? null : alert.severity,
      priority: inputIssue ? null : alert.severity * asset.criticality,
      text: clean.masked, verdict, reason, ruleVerdict: rules, flagged: clean.flagged,
      probability: result ? Number(result.probability.toFixed(4)) : null, masked: clean.matches,
      vocabularyCoverage: result ? result.vocabularyCoverage : null,
      knownTerms: result ? result.known.length : 0, totalTerms: result ? result.totalTerms : 0,
      contributions: result ? result.contributions.slice(0, 6) : [], inputIssue,
      group: alert.group};
  }

  function evaluate(records, assets, predict) {
    const run = model => {
      const stats = {tp: 0, tn: 0, fp: 0, fn: 0, review: 0};
      const predictions = records.map(record => {
        const row = assess(record, assets, model);
        const result = model ? row.verdict : row.ruleVerdict;
        // Review is a human escalation for the binary comparison.
        const escalated = result !== "Benign";
        const positive = record.label === "Attack";
        stats[positive ? (escalated ? "tp" : "fn") : (escalated ? "fp" : "tn")] += 1;
        if (result === "Review") stats.review += 1;
        return {id: row.id, label: record.label, verdict: result, priority: row.priority, probability: model ? row.probability : null};
      });
      const {tp, tn, fp, fn} = stats;
      return {...stats, accuracy: (tp + tn) / records.length, precision: tp / (tp + fp || 1),
        recall: tp / (tp + fn || 1), f1: 2 * tp / (2 * tp + fp + fn || 1), predictions};
    };
    return {count: records.length, rules: run(null), hybrid: run(predict)};
  }

  return {train, guard, assess, evaluate, maxTextLength};
})();
if (typeof module !== "undefined") module.exports = PSIAModel;
