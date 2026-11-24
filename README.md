# PSIA Airside SOC Console

A browser-based Security Operations Centre (SOC) console for a simulated Pakistani international airport. Built as the AI automation component of an Information Assurance and GRC programme.

The console uses an offline Naïve Bayes text classifier to triage security alerts as **Attack**, **Benign**, or **Review**. It runs entirely in the browser — no server, no internet, no install required.

---

## Live Demo

Open `SOC Console/index.html` in **Chrome or Edge**.

On Windows you can also double-click **`Start SOC Console.cmd`** to launch it directly.

> Firefox is not supported — the audit log hashing requires `crypto.subtle` which Firefox blocks on local files.

---

## What It Does

### AI Alert Triage
- Classifies 40 synthetic airport security alerts using a Multinomial Naïve Bayes classifier trained in the browser
- Trained on 48 labeled airport alert descriptions (24 attack, 24 benign)
- Returns Attack / Benign / Review verdict with probability score and word-level explanations
- Falls back to severity-only rules if the ML model is switched off

### Security Guardrails
- **Data masking** — strips Pakistani CNICs, phone numbers, passport numbers and emails from alert text before inference
- **Prompt injection detection** — regex catches instruction-like phrases and forces Review verdict
- **Input validation** — empty text, oversized inputs and low vocabulary coverage all route to Review

### Incident Response Workflow
- Three simulated incident groups: OT disruption, backup/ransomware, identity and data exposure
- Approval catalogue with tier-1 and tier-2 actions
- Dual-role approval enforcement — same person cannot approve twice
- Approvals trigger a register overlay that updates the live risk score

### Audit Log
- Every action (replay, triage, approval, register change) is logged with a SHA-256 chain
- Tamper detection via Verify Log
- Full session export as JSON evidence

### CISO Dashboard
- Live risk posture, control effectiveness, compliance percentage
- Risk heatmap (5×5 likelihood × impact)
- Readiness bars for IAM, BC/DR, Incident Response
- Updates in real time when the register overlay is applied

### AI Governance Page
- Documents 10 AI risks and their controls (hallucination, bias, data leakage, prompt injection, model drift, over-reliance, explainability, unfamiliar inputs, availability, vendor risk)
- AI governance readiness score (5.8/10) and governance maturity (2.4/5)
- Model assurance panel with live benchmark results

---

## Benchmark Results

| Metric | Severity-only Rules | Hybrid ML |
|---|---|---|
| Accuracy | 60% | **95%** |
| Missed attacks | 9 | **0** |
| False escalations | 7 | 2 |
| Recall | 55% | **100%** |
| F1 | 57.9% | **95.2%** |

Tested on 40 held-out synthetic alerts. 37 receive a direct Attack or Benign verdict. 3 go to Review. Human verification applies to all suggestions.

---

## How the AI Works

The classifier is a Multinomial Naïve Bayes model implemented from scratch in `model.js` — no external libraries.

1. Trains on 48 labeled descriptions from `scenarios.js` on page load
2. Strips stop words, tokenizes, builds a vocabulary with token counts per class
3. At inference: computes log-probability for Attack vs Benign using Laplace smoothing
4. Returns probability, matched terms, and per-word contribution weights
5. Thresholds: ≥ 0.66 → Attack, ≤ 0.34 → Benign, between → Review

---

## Project Structure

```
PSIA-SOC-Console/
├── SOC Console/
│   ├── index.html          # Entry point
│   ├── app.js              # UI, state, routing, approval workflow
│   ├── model.js            # Naive Bayes classifier, guardrails, masking
│   ├── scenarios.js        # Training data, test alerts, approval catalogue
│   ├── data.js             # Asset register, risk register, controls, compliance
│   ├── style.css           # Styles
│   ├── Benchmark.json      # Packaged benchmark results
│   └── Sample Session Evidence.json
├── Exercise Evidence.csv   # Simulated control observations
├── Start SOC Console.cmd   # Windows launcher
└── README.md
```

---

## Technologies

- Vanilla JavaScript (ES2020) — no frameworks, no dependencies
- Multinomial Naive Bayes — implemented from scratch
- Web Crypto API (SHA-256) — audit log integrity
- HTML / CSS — no build step

---

## Academic Context

Built as the AI automation deliverable for an Information Assurance course (Aviation sector). The organization is a hypothetical Pakistan Smart International Airport (PSIA). The simulation covers governance, risk management, security controls, compliance (PISF 2026, ISO 27001, NIST CSF, IEC 62443), IAM, BC/DR, incident response, and AI governance.

This is an academic simulation. Approvals never control real equipment.
