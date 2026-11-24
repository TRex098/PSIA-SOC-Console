
"use strict";
const view = document.querySelector("#view");
const status = document.querySelector("#status");
const actorList = [
  ["Amina","SOC Lead"],["Faisal","OT Engineering"],["Sana","Airport Operations"],
  ["Raza","Internal Audit"],["Mariam","CISO"],
];
const state = {
  page:"overview", alerts:[], selectedAlert:null, decisions:{}, log:[], overlay:null,
  register:"Assets", query:"", filter:"All", mode:"ml", replayMode:null, busy:false, actionNotice:null,
  benchmark:{running:false, latest:null, error:"", attempt:0},
  trial:{text:"", asset:"A-15", severity:"2", safety:true, open:false, result:null},
};
const predict = PSIAModel.train(PSIAScenarios.training);
const percent = x => (x * 100).toFixed(1) + "%";
const esc = value => String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
const table = (headers,rows) => '<div class="table-wrap"><table><thead><tr>'+
  headers.map(x=>"<th scope='col'>"+esc(x)+"</th>").join("")+"</tr></thead><tbody>"+
  rows.map(r=>"<tr>"+r.map(x=>"<td>"+esc(x)+"</td>").join("")+"</tr>").join("")+"</tbody></table></div>";
const cards = items => '<div class="metrics">'+items.map(([value,title,tone])=>'<div class="metric'+(tone?' metric-'+tone:'')+'"><span>'+esc(title)+'</span><strong>'+esc(value)+'</strong></div>').join("")+"</div>";
const heading = (title,detail) => "<h1>"+esc(title)+"</h1>"+(detail?'<p class="lede">'+esc(detail)+"</p>":"");
const tell = (message, error=false) => {status.textContent=message; status.classList.toggle("error",error);};
const verdictTones = {Attack:"critical",Review:"warning",Benign:"positive"};
const badge = (label,tone="neutral") => '<span class="badge badge-'+tone+'">'+esc(label)+'</span>';
const riskBand = score => score>=15 ? "Critical" : score>=10 ? "High" : score>=5 ? "Medium" : "Low";
const riskTone = score => score>=15 ? "critical" : score>=5 ? "warning" : "positive";
const valueList = entries => '<dl class="detail-values">'+entries.map(([key,value])=>'<div><dt>'+esc(key)+'</dt><dd>'+esc(value)+'</dd></div>').join("")+'</dl>';

async function hash(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), x=>x.toString(16).padStart(2,"0")).join("");
}
async function writeLog(kind, data) {
  const previous = state.log.at(-1)?.digest || "0".repeat(64);
  const record = {time:new Date().toISOString(),kind,data,previous};
  state.log.push({...record,digest:await hash(JSON.stringify(record))});
}
async function verifyLog() {
  let previous = "0".repeat(64);
  for (const {digest,...record} of state.log) {
    if (record.previous!==previous || digest!==await hash(JSON.stringify(record))) return false;
    previous=digest;
  }
  return true;
}

function metrics() {
  const {registers,dimensions} = PSIAData;
  const outcomes = Object.fromEntries(registers.Controls.rows.map(r=>[r[0],r[8]]));
  if (state.overlay) outcomes["C-15"]="Fail";
  const rows = registers.Risks.rows.map(row=>{
    const [id,,title,,l,i,tl,ti]=row;
    const suffix=id.slice(-2);
    const gate=PSIAData.riskGates[suffix];
    const supported=outcomes["C-"+suffix]==="Pass" && (!gate || outcomes["C-"+gate]==="Pass");
    const likelihood=state.overlay?.risk===id ? state.overlay.likelihood : supported ? Math.max(1,+l-1) : +l;
    return {id,title,inherent:+l*i,current:likelihood*i,target:+tl*ti,verified:supported,likelihood,impact:+i};
  });
  const requirements = registers.Compliance.rows.filter(r=>r[4]==="Exercise baseline");
  const readiness = Object.fromEntries(Object.entries(dimensions.readiness).map(([key,ids])=>[key,ids.filter(id=>outcomes["C-"+id]==="Pass").length/ids.length]));
  const sum = rows.reduce((total,r)=>total+r.current,0);
  const effective = Object.values(outcomes).filter(x=>x==="Pass").length;
  const satisfied=requirements.filter(r=>r[5]==="Satisfied" && outcomes[r[3]]==="Pass").length;
  const openFindings=PSIAData.findings.filter(finding=>finding.status!=="Closed");
  return {rows,sum,effective,applicable:Object.keys(outcomes).length,open:openFindings.length,
    criticalGaps:openFindings.filter(finding=>finding.severity==="Critical").length,
    satisfied,assessed:requirements.length,compliance:satisfied/requirements.length,
    maturity:dimensions.maturity.reduce((a,b)=>a+b)/dimensions.maturity.length,
    ai:dimensions.ai.reduce((a,b)=>a+b)/(dimensions.ai.length*2)*10,readiness,
    critical:rows.filter(r=>r.current>=15).length,high:rows.filter(r=>r.current>=10 && r.current<15).length,
    outside:rows.filter(r=>r.current>6).length,pending:registers.Compliance.rows.length-requirements.length};
}

function incidentGroups() {
  // Replay uses the case's explicit investigation key, not the hidden benchmark label.
  return Object.entries(PSIAScenarios.names).map(([key,name])=>({
    key,name,alerts:state.alerts.filter(a=>a.group===key&&a.verdict!=="Benign"),
  })).filter(group=>group.alerts.length);
}

function overview() {
  const {benchmark:b}=PSIAData;
  const m=metrics();
  return '<section class="hero"><div class="hero-content"><p class="hero-label">AIRFIELD SECURITY OPERATIONS</p><h1>Airside assurance overview</h1><p>Replay Blackout Beacon and BHS Jam, then trace the airfield isolation finding from audit evidence to the CISO risk dashboard.</p><div class="hero-actions"><button class="primary" data-go="console">Open SOC Console <span aria-hidden="true">→</span></button><button class="secondary" data-go="dashboard">View CISO Dashboard</button></div></div><div class="runway-art" aria-hidden="true"><i></i><i></i><i></i><span></span></div></section>'+
    cards([[m.rows.length,"Risk scenarios"],[m.critical,"Critical current risks"],[percent(m.effective/m.applicable),"Control effectiveness"],[percent(b.hybrid.accuracy),"AI triage accuracy"]])+
    '<div class="grid"><section class="panel overview-panel"><h2>Blackout Beacon and BHS Jam</h2><p>Assignment 02 traced an unauthorized 4G modem to an airfield PLC switch. Assignment 03 follows the resulting lighting disruption and pivot into baggage controls.</p><button data-go="registers">Browse evidence and registers</button></section>'+
    '<section class="panel overview-panel"><h2>AI benchmark</h2><p>'+b.hybrid.tp+' of '+b.attacks+' labeled attacks escalated. Compare the local classifier and severity-only rules across '+b.count+' held-out synthetic alerts.</p><button data-go="evaluation">View evaluation</button></section></div>';
}

function incidentActions(group) {
  if (!group) return '<p class="empty">This alert has no linked incident actions.</p>';
  const actions=PSIAScenarios.approvalCatalogue.filter(action=>action.incident===group.key);
  return '<div class="section-title"><h3>Incident actions</h3>'+badge(group.key)+'</div><p class="incident-name">'+esc(group.name)+'</p>'+
    actions.map(action=>{
      const approvals=state.decisions[action.id]||[];
      const complete=approvals.length===action.tier;
      const actionStatus=complete ? badge("Approved","positive") : approvals.length ? badge("Awaiting second approval","warning") : badge("Pending");
      const notice=state.actionNotice?.id===action.id?state.actionNotice:null;
      return '<article class="action"><div class="section-title"><span class="code">'+esc(action.id+" · "+action.ref)+'</span>'+actionStatus+'</div><h4 id="action-'+action.id+'" tabindex="-1">'+esc(action.title)+'</h4>'+
        '<p>'+esc(PSIAScenarios.playbook[action.ref])+'</p>'+
        '<p class="approval-roles"><strong>Approvers</strong> '+esc(action.roles.join(" and "))+'</p>'+
        (action.dependsOn?'<p class="approval-roles">Requires simulated isolation approval and bench validation.</p>':"")+
        (approvals.length?'<p class="approval-roles">'+esc(approvals.map(([name,role])=>name+" · "+role).join(" / "))+'</p>':"")+
        '<button data-approve="'+action.id+'" aria-describedby="action-'+action.id+'" '+(complete?"disabled":"")+'>'+ (complete?"Approved in simulation":"Approve "+approvals.length+"/"+action.tier)+'</button>'+
        (notice?'<p class="action-notice'+(notice.error?' error':'')+'">'+esc(notice.text)+'</p>':"")+'</article>';
    }).join("");
}

function modelExplanation(alert,expanded=false) {
  if (alert.probability==null) return "";
  return '<details class="model-explanation" '+(expanded?"open":"")+'><summary>What influenced the model '+
    badge(percent(alert.vocabularyCoverage)+" vocabulary coverage","accent")+'</summary>'+
    '<p>'+alert.knownTerms+' of '+alert.totalTerms+' words after preprocessing occur in the training vocabulary. Score calibration against airport data is pending.</p>'+
    table(["Term","Favors","Weight"],alert.contributions.map(item=>[
      item.term,item.weight>0?"Attack":item.weight<0?"Benign":"Neither",item.weight.toFixed(2),
    ]))+'<p class="model-note">Weights show each word’s contribution to the attack-versus-benign log odds, including repeated occurrences.</p></details>';
}

function trialResult() {
  const result=state.trial.result;
  if (!result) return '<p>Enter an alert description to inspect the model’s suggestion.</p>';
  return '<div class="section-title"><h3>Suggested verdict</h3>'+badge(result.verdict,verdictTones[result.verdict])+'</div>'+
    '<p class="trial-review">'+badge("Awaiting human review","warning")+'</p>'+
    valueList([["Asset",result.asset+" · "+result.name],["Model attack score",result.probability==null?"Unavailable":percent(result.probability)]])+
    '<p class="alert-message">'+esc(result.text)+'</p><p>'+esc(result.reason)+'</p>'+
    (result.masked?'<p>'+badge(result.masked+" identifiers masked","accent")+'</p>':"")+
    modelExplanation(result,true);
}

function trialPanel() {
  const trial=state.trial;
  return '<details class="panel trial-panel" id="trial-panel" '+(trial.open?"open":"")+'><summary>Try a new alert</summary>'+
    '<p>Use a synthetic description. Every suggestion requires human review before it can support a finding.</p>'+
    '<div class="grid trial-grid"><form id="trial-form"><div class="field"><label for="trial-text">Alert description</label>'+
    '<textarea id="trial-text" rows="4" maxlength="'+PSIAModel.maxTextLength+'" aria-describedby="trial-help">'+esc(trial.text)+'</textarea>'+
    '<small id="trial-help">Up to 4,000 characters. For example, describe an unauthorized controller write or a scheduled backup.</small></div>'+
    '<div class="toolbar"><div class="field"><label for="trial-asset">Asset</label><select id="trial-asset">'+
    Object.entries(PSIAData.assets).map(([id,asset])=>'<option value="'+esc(id)+'" '+(trial.asset===id?"selected":"")+'>'+esc(id+" · "+asset.name)+'</option>').join("")+
    '</select></div><div class="field"><label for="trial-severity">Severity</label><select id="trial-severity">'+
    [1,2,3,4,5].map(value=>'<option '+(trial.severity===String(value)?"selected":"")+'>'+value+'</option>').join("")+'</select></div></div>'+
    '<label class="checkbox-label"><input id="trial-safety" type="checkbox" '+(trial.safety?"checked":"")+'> Safety-sensitive event</label>'+
    '<button type="submit" class="primary">Classify new alert</button></form>'+
    '<section id="trial-result" class="trial-result" role="status" aria-live="polite" aria-atomic="true">'+trialResult()+'</section></div></details>';
}

function alertDetails(alert,groups) {
  if (!alert) return '<div class="panel empty">Select an alert to inspect its triage decision.</div>';
  const group=groups.find(item=>item.key===alert.group);
  return '<section class="panel alert-details" aria-label="Selected alert"><div class="section-title"><h2>'+esc(alert.id)+'</h2>'+
    badge(alert.verdict,verdictTones[alert.verdict])+'</div><h3 class="asset-name">'+esc(alert.name)+'</h3>'+
    valueList([["Asset ID",alert.asset],["Owner",alert.owner],["Source",alert.source],["Time",alert.time+" PKT"],
      ["SIEM severity",alert.severity+" / 5"],["Priority",alert.priority+" / 25"],
      ["Triage engine",state.replayMode==="ml"?"Offline ML":"Rules fallback"],
      ["Model attack score",alert.probability==null?"Unavailable in rules mode":percent(alert.probability)]])+
    '<h3>Alert description</h3><p class="alert-message">'+esc(alert.text)+'</p>'+
    '<h3>Decision rationale</h3><p class="alert-rationale">'+esc(alert.reason)+'</p>'+
    modelExplanation(alert)+
    (alert.flagged?badge("Instruction-like text","warning"):"")+
    (alert.masked?badge(alert.masked+" identifiers masked","accent"):"")+
    '<div class="case-actions">'+incidentActions(group)+'</div></section>';
}

function consolePage() {
  const groups=incidentGroups();
  const visible=state.alerts.filter(alert=>state.filter==="All"||alert.verdict===state.filter);
  const selected=visible.find(alert=>alert.id===state.selectedAlert)||visible[0];
  const replay=state.alerts.length ? badge("Exercise replay","accent") : badge("Ready");
  const toolbar='<div class="toolbar queue-toolbar"><button class="primary" id="replay">Replay attack</button>'+
    '<div class="field"><label for="engine">Next replay mode</label><select id="engine"><option value="ml">Offline ML</option>'+
    '<option value="rules" '+(state.mode==="rules"?"selected":"")+'>Rules fallback</option></select></div>'+
    '<div class="field"><label for="filter">Verdict</label><select id="filter" '+(state.alerts.length?"":"disabled")+'>'+
    ["All","Attack","Review","Benign"].map(value=>'<option '+(value===state.filter?"selected":"")+'>'+value+'</option>').join("")+'</select></div>'+
    '<div class="field"><label for="actor">Approving role</label><select id="actor">'+actorList.map(([name,role],i)=>
      '<option value="'+i+'" '+((state.actor||0)===i?"selected":"")+'>'+esc(name+" · "+role)+'</option>').join("")+'</select></div>'+
    (state.alerts.length?'<button id="export" class="export-button">Export session evidence</button>':"")+'</div>';
  const header='<div class="page-heading"><div>'+heading("SOC Console","Triage the simulated airport alerts and record incident decisions.")+'</div>'+replay+'</div>'+toolbar+trialPanel();
  if (!state.alerts.length) return header+'<section class="panel empty"><h2>Alert queue</h2><p>Replay the 40-alert exercise to inspect verdicts, asset context, and incident actions.</p></section>';

  const queue='<section class="panel alert-queue"><div class="section-title"><h2>Alert queue</h2><span class="code">'+visible.length+' / '+state.alerts.length+'</span></div>'+
    '<div class="queue-list">'+(visible.length ? visible.map(alert=>
      '<button class="queue-item" data-alert="'+esc(alert.id)+'" aria-pressed="'+(alert.id===selected?.id)+'"><span class="queue-main"><span class="code">'+esc(alert.id+" · "+alert.time)+'</span><strong>'+esc(alert.name)+'</strong><span>'+esc(alert.asset+" · "+alert.source)+'</span></span><span class="queue-risk">'+
      badge(alert.verdict,verdictTones[alert.verdict])+badge(riskBand(alert.priority)+" "+alert.priority,riskTone(alert.priority))+'</span></button>'
    ).join("") : '<p class="empty">No alerts have this verdict.</p>')+'</div></section>';
  return header+cards([[state.alerts.length,"Alerts replayed","accent"],[groups.length,"Incident groups"],
    [state.alerts.filter(alert=>alert.verdict==="Review").length,"Alerts for review","warning"],[state.overlay?"Verified":"Pending","Airfield finding",state.overlay?"positive":"neutral"]])+
    '<div class="triage-grid">'+queue+alertDetails(selected,groups)+'</div>';
}

function findingDetail(finding) {
  const live=state.overlay?.finding===finding.id;
  const evidence=[finding.evidence,...(finding.retestEvidence?[finding.retestEvidence]:[]),...(live?[state.overlay.evidence]:[])];
  return '<details class="finding-detail" id="'+esc(finding.id)+'"><summary><span class="code">'+esc(finding.id)+'</span> '+esc(finding.owner)+' '+badge(finding.severity,"critical")+' '+badge(finding.status,"warning")+'</summary>'+
    valueList([["Related risks",finding.risks],["Due date",finding.due],["Observed condition",finding.condition],["Corrective action",finding.action],["Required retest",finding.retest]])+
    (live?'<p class="finding-update">EV-LIVE-01 corroborates this failure. Closure still requires the specified retest.</p>':"")+
    '<div class="toolbar"><button data-control="'+esc(finding.control)+'">Inspect '+esc(finding.control)+'</button>'+
    evidence.map(id=>'<button class="evidence-link" data-evidence="'+esc(id)+'">'+esc(id)+'</button>').join("")+'</div>'+
    '<p class="model-note">Evidence links include baseline and any assigned retest record. Inspect the recorded result before claiming closure.</p></details>';
}

function dashboard() {
  const m=metrics(), latest=state.benchmark.latest, b=latest?.result||PSIAData.benchmark;
  const top=[...m.rows].sort((a,b)=>b.current-a.current).slice(0,5);
  const inherent=m.rows.reduce((total,row)=>total+row.inherent,0)/m.rows.length;
  const target=m.rows.reduce((total,row)=>total+row.target,0)/m.rows.length;
  const criticalFindings=PSIAData.findings.filter(finding=>finding.status!=="Closed"&&finding.severity==="Critical")
    .sort((left,right)=>left.due.localeCompare(right.due)||left.id.localeCompare(right.id));
  const priorities=["F-15","F-03","F-06","F-14","F-09"].map(id=>PSIAData.findings.find(finding=>finding.id===id));
  const actionRows=priorities.map(finding=>'<tr><td><button class="evidence-link" data-finding="'+esc(finding.id)+'">'+esc(finding.id)+'</button></td>'+
    '<td>'+esc(finding.action)+'</td><td>'+esc(finding.owner)+'</td><td class="due-date">'+esc(finding.due)+'</td></tr>').join("");
  const matrix=Array.from({length:5},(_,i)=>{
    const impact=5-i;
    return [impact,...Array.from({length:5},(_,n)=>m.rows.filter(r=>r.impact===impact&&r.likelihood===n+1).length)];
  });
  const heat='<div class="heatmap" role="table" aria-label="Current risk counts by impact and likelihood"><div class="heat-row" role="row"><span role="columnheader">Impact</span>'+[1,2,3,4,5].map(n=>'<span role="columnheader">L'+n+'</span>').join("")+'</div>'+matrix.map(([impact,...cells])=>'<div class="heat-row" role="row"><span role="rowheader">'+impact+'</span>'+cells.map((count,i)=>'<span role="cell" class="heat-'+(impact*(i+1)>=15?'critical':impact*(i+1)>=10?'high':impact*(i+1)>=5?'medium':'low')+'" title="Score '+impact*(i+1)+'">'+(count||'–')+'</span>').join("")+'</div>').join("")+'</div>';
  const summary=state.overlay?"EV-LIVE-01 corroborates the existing C-15 failure. R-15 increases from 10 to 15.":"Risk exposure and control evidence from the reconciled exercise baseline.";
  const runTime=latest?new Intl.DateTimeFormat("en-GB",{dateStyle:"medium",timeStyle:"medium",timeZone:"Asia/Karachi"}).format(latest.finished)+" PKT":"Run the benchmark to measure this session.";
  return '<div class="page-heading"><div>'+heading("CISO Dashboard",summary)+'</div>'+
    badge(state.overlay?"Verified replay applied":"Exercise baseline",state.overlay?"positive":"neutral")+'</div>'+
    '<h2 class="group-title">Risk posture</h2>'+cards([
      [(m.sum/m.rows.length).toFixed(2)+" / 25","Mean current risk","accent"],[m.sum,"Total current exposure"],
      [m.critical,"Critical risks","critical"],[m.high,"High risks","warning"],
    ])+'<section class="panel dashboard-section"><div class="section-title"><h2>Risk treatment progress</h2>'+badge("Simulated assessment","accent")+'</div>'+
    '<div class="metrics treatment-metrics">'+
    '<div class="metric"><span>Mean inherent risk</span><strong>'+inherent.toFixed(2)+' / 25</strong></div>'+
    '<div class="metric metric-accent"><span>Mean current residual risk</span><strong>'+(m.sum/m.rows.length).toFixed(2)+' / 25</strong></div>'+
    '<div class="metric"><span>Planned target residual risk</span><strong>'+target.toFixed(2)+' / 25</strong></div>'+
    '<div class="metric metric-warning"><span>Risks outside appetite</span><strong>'+m.outside+' / '+m.rows.length+'</strong></div></div>'+
    '<p>Risk appetite is a current score of 6 or less. Treatment targets require implementation and passing retests. Unsupported reductions retain the inherent score.</p></section>'+
    '<div class="grid dashboard-grid"><section class="panel"><h2>Highest-scoring risks</h2>'+
    table(["Risk","Description","Rating"],top.map(r=>[r.id,r.title,r.current+" · "+riskBand(r.current)]))+
    '</section><section class="panel"><h2>Risk matrix</h2>'+heat+
    '<div class="legend">'+[badge("Low","positive"),badge("Medium / High","warning"),badge("Critical","critical")].join("")+'</div></section></div>'+
    '<h2 class="group-title">Assurance and findings</h2>'+cards([
      [percent(m.effective/m.applicable),"Control effectiveness","accent"],[percent(m.compliance),"Scoped compliance"],
      [m.open,"Open findings","warning"],[m.criticalGaps,"Critical control gaps","critical"],
    ])+'<section class="panel dashboard-section"><h2>Assessment scope</h2>'+valueList([
      ["Effective controls",m.effective+" / "+m.applicable+" applicable controls"],
      ["Satisfied requirements",m.satisfied+" / "+m.assessed+" assessed requirements"],
      ["Pending applicability",m.pending+" decisions excluded from the compliance denominator"],
      ["Assessment basis","Simulated control tests and scoped coursework criteria"],
    ])+'<p>Failed and unverified controls remain in the effectiveness denominator. Scoped compliance covers the adopted criteria.</p>'+
    '<div class="toolbar"><button data-controls="true">Inspect control registers</button><button data-compliance="true">Inspect compliance scope</button></div></section>'+
    '<section class="panel dashboard-section"><h2>Five priority actions</h2><p>Workbook finding owners and due dates. Select a finding to inspect its evidence and closure criteria.</p>'+
    '<div class="table-wrap"><table><thead><tr><th>Finding</th><th>Corrective action</th><th>Owner</th><th>Due date</th></tr></thead><tbody>'+actionRows+'</tbody></table></div></section>'+
    '<section class="panel dashboard-section"><div class="section-title"><h2>Critical findings and retests</h2>'+badge(criticalFindings.length+" open","critical")+'</div>'+
    '<p>Open exercise findings from the workbook. Internal Audit verifies corrective action and approves closure after a successful retest.</p>'+
    criticalFindings.map(findingDetail).join("")+'</section>'+
    '<div class="grid dashboard-grid"><section class="panel"><div class="section-title"><h2>Readiness</h2>'+badge("Simulated assessment","accent")+'</div><div class="readiness-bars">'+Object.entries(m.readiness).map(([key,value])=>accuracyBar(key,value,"hybrid")).join("")+'</div>'+
    valueList([["Governance maturity",m.maturity.toFixed(1)+" / 5"],["AI governance readiness",m.ai.toFixed(1)+" / 10"]])+
    '<button data-go="governance">Inspect governance assessment</button></section>'+
    '<section class="panel"><div class="section-title"><h2>AI pilot results</h2>'+badge(latest?"Latest local run":"Packaged benchmark","accent")+'</div>'+
    '<p>Measured prototype results on '+b.count+' synthetic cases.</p>'+
    accuracyBar("Hybrid escalation accuracy",b.hybrid.accuracy,"hybrid")+accuracyBar("Severity-only baseline",b.rules.accuracy,"rules")+
    accuracyBar("Classification coverage",(b.count-b.hybrid.review)/b.count,"hybrid")+
    valueList([["Sent for manual review",b.hybrid.review+" / "+b.count],["Missed attacks",b.hybrid.fn],["False escalations",b.hybrid.fp],["Human time savings","Unmeasured"]])+
    '<p>Review counts as escalation. Every suggestion requires human verification.</p><p>'+esc(runTime)+'</p>'+
    (latest?'<p>Run duration '+latest.duration.toFixed(2)+' ms. '+(latest.matches?"Predictions match the packaged benchmark.":"Predictions differ from the packaged benchmark.")+'</p>':"")+
    '<button data-go="evaluation">Inspect and run benchmark</button></section></div>';
}

function registers() {
  const {registers:records}=PSIAData;
  const {headers,rows}=records[state.register];
  let listed=rows.map(r=>[...r]);
  let columns=[...headers];
  if (state.register==="Risks") {
    const summaries=Object.fromEntries(metrics().rows.map(item=>[item.id,item]));
    columns=[...headers,"Current score","Basis"];
    listed=listed.map(r=>[...r,summaries[r[0]].current,state.overlay?.risk===r[0]?"Verified scenario raises likelihood":summaries[r[0]].verified?"Test-supported":"Unverified"]);
  }
  if (state.overlay && state.register==="Evidence") listed.push(["EV-LIVE-01","C-15","Human-verified replay","Unauthorized cellular path confirmed by Engineering and Internal Audit","Fail"]);
  if (state.overlay && state.register==="Controls") listed=listed.map(r=>r[0]==="C-15"?[...r.slice(0,7),"Assignment 02 failure corroborated in replay (EV-LIVE-01)","Fail"]:r);
  const filtered=listed.filter(row=>row.join(" ").toLowerCase().includes(state.query.toLowerCase()));
  return heading("Master registers","Browse the five linked registers. The exercise evidence overlay appears here after approval.")+
    '<div class="toolbar"><label for="register">Register</label><select id="register">'+Object.keys(records).map(x=>'<option '+(state.register===x?"selected":"")+'>'+x+'</option>').join("")+
    '</select><label for="query">Search</label><input id="query" type="search" value="'+esc(state.query)+'" placeholder="Asset, risk or evidence ID"></div>'+
    '<div id="register-results" aria-live="polite">'+table(columns,filtered)+"<p>"+filtered.length+" records</p></div>";
}

function governance() {
  const m=metrics();
  const b=state.benchmark.latest?.result||PSIAData.benchmark;
  const assessments=PSIAData.governance.readiness;
  const ai=assessments.filter(row=>row[0]==="AI governance readiness");
  const maturity=assessments.filter(row=>row[0]==="Governance maturity");
  const earned=ai.reduce((sum,row)=>sum+row[2],0);
  const maximum=ai.reduce((sum,row)=>sum+row[3],0);
  const evidenceButtons=ids=>ids.split(", ").map(id=>'<button class="evidence-link" data-evidence="'+esc(id)+'">'+esc(id)+'</button>').join(" ");
  const dimensions=ai.map(([,name,points,total,evidence,basis])=>
    '<article class="governance-dimension"><div class="section-title"><h3>'+esc(name)+'</h3>'+
    badge(points+" / "+total,points===total?"positive":points?"warning":"critical")+'</div>'+
    accuracyBar(points===total?"Full rubric points":points?"Partial readiness":"Evidence gap",points/total,"hybrid")+
    '<p>'+esc(basis)+'</p><div class="evidence-links">'+evidenceButtons(evidence)+'</div></article>').join("");
  const operational=Object.entries(m.readiness).map(([name,value])=>{
    const checks=assessments.filter(row=>row[0]===name);
    return accuracyBar(name==="BCDR"?"Business continuity and disaster recovery":name==="IAM"?"Identity and access management":"Incident response",value,"hybrid")+
      '<p class="readiness-basis">'+Math.round(value*checks.length)+' / '+checks.length+' controls have passing evidence</p>';
  }).join("");
  const approvals=state.log.filter(row=>row.kind==="approval").length;
  return '<div class="page-heading"><div>'+heading("AI Governance","Review the pilot’s accountability, readiness, evidence gaps and approval history.")+'</div>'+badge("Academic pilot","accent")+'</div>'+
    cards([[m.ai.toFixed(1)+" / 10","AI governance readiness","accent"],[m.maturity.toFixed(1)+" / 5","Governance maturity"],
      [ai.filter(row=>row[2]<row[3]).length+" / "+ai.length,"AI dimensions below full points","warning"],[m.pending,"Pending applicability decisions","warning"]])+
    '<div class="grid governance-grid"><section class="panel"><h2>Operational readiness</h2>'+operational+
    '<p>Simulated control-test results from the workbook. Every selected control remains in the denominator, including failed or unverified tests.</p><button data-controls="true">Inspect control registers</button></section>'+
    '<section class="panel"><h2>Pilot ownership and oversight</h2>'+valueList([
      ["Accountable owner","CISO"],["Independent assurance","Internal Audit"],["Response authorization","Named incident and control owners"],
      ["Operating scope","Offline synthetic alert triage"],["Review requirement","Every suggestion requires human verification"],["Reviewer time savings","Unmeasured"],
    ])+'<p>Demo approvers use selectable roles. Organizational identity assurance and independent reviewer exercises remain pending.</p>'+ 
    '<button data-go="console">Open review and approval workflow</button></section></div>'+
    '<section class="panel governance-section"><div class="section-title"><h2>AI readiness assessment</h2>'+badge(earned+" / "+maximum+" rubric points","accent")+'</div>'+
    '<p>Workbook Readiness tab. Six dimensions use a 0–2 rubric. '+earned+' ÷ '+maximum+' × 10 = '+m.ai.toFixed(1)+
    '/10. These are exercise assessment scores. Evidence links open the matching register record.</p><div class="grid governance-dimensions">'+dimensions+'</div></section>'+
    '<div class="grid governance-grid"><section class="panel"><h2>Governance maturity</h2>'+maturity.map(([,name,points,total])=>accuracyBar(name,points/total,"hybrid")).join("")+
    '<p>Average '+m.maturity.toFixed(1)+'/5 across five workbook dimensions. Bars show each dimension as a proportion of the five-point scale.</p></section>'+
    '<section class="panel"><div class="section-title"><h2>Model assurance</h2>'+badge(state.benchmark.latest?"Latest local run":"Packaged benchmark","accent")+'</div>'+
    accuracyBar("Hybrid escalation accuracy",b.hybrid.accuracy,"hybrid")+accuracyBar("Classification coverage",(b.count-b.hybrid.review)/b.count,"hybrid")+
    valueList([["Model","Multinomial Naive Bayes"],["Training / test records",PSIAScenarios.training.length+" / "+b.count],
      ["Cases sent for review",b.hybrid.review],["Missed attacks / false escalations",b.hybrid.fn+" / "+b.hybrid.fp]])+
    '<p>Measured on synthetic cases. Review counts as escalation. Independent airport validation and score calibration are pending.</p><button data-go="evaluation">Inspect benchmark results</button></section></div>'+
    '<section class="panel governance-section"><h2>Planned assurance actions</h2><p>Accountable roles, target years and acceptance criteria from the workbook Roadmap tab.</p>'+
    table(["Action","Target year","Accountable role","Verification milestone"],PSIAData.governance.roadmap.map(row=>[row[0]+" · "+row[2],row[1],row[3],row[5]]))+'</section>'+
    '<section class="panel governance-section"><h2>AI risks and safeguards</h2>'+
    table(["Risk","Control"],[
      ["Hallucination","The learned model classifies text. A fixed catalogue provides actions and references to approved playbook steps."],
      ["Bias","Compare missed attacks and false escalations across alert sources and safety sensitivity."],
      ["Data leakage","Mask four supported identifier formats before model inference or decision logging."],
      ["Prompt injection","Pattern matches force manual review. All alert text is escaped and remains data."],
      ["Model drift","Repeat the benchmark after a change and compare false negatives and source errors."],
      ["Over-reliance","Approval requires named demo roles. Two different authorized roles approve high-impact actions."],
      ["Explainability","Show the strongest weighted terms, vocabulary coverage, model score, deterministic priority and the playbook ID. Score calibration against independent airport data is pending."],
      ["Unfamiliar inputs","Route invalid descriptions, repeated single words and descriptions with little familiar vocabulary to Review. New alert suggestions always await human review."],
      ["Availability","Select rules fallback and retain the same review and approval workflow."],
      ["Vendor risk","No cloud model call or package install for the demo. Review model and dependencies before expansion."],
    ])+'</section><section class="panel"><div class="section-title"><h2>Decision log</h2>'+badge(approvals+" recorded approvals",approvals?"positive":"neutral")+'</div><p>The SHA-256 chain checks the entries in this browser session. Demo identities are preset. The exported log provides exercise evidence of recorded decisions.</p>'+
    '<div class="toolbar"><button id="verify">Verify log</button><button id="export">Export session evidence</button></div>'+
    table(["Entry","Action","Time (UTC)","SHA-256"],state.log.slice(-10).map((r,i)=>[Math.max(0,state.log.length-10)+i+1,r.kind,r.time,r.digest.slice(0,20)+"…"]))+"</section>";
}

function benchmarkNotice() {
  const {running,latest,error,attempt}=state.benchmark;
  if (running) return '<p id="benchmark-status" class="run-notice is-running"><span class="spinner" aria-hidden="true"></span>Running '+PSIAScenarios.heldout.length+' held-out alerts…</p>';
  if (error) return '<p id="benchmark-status" class="run-notice is-error">'+esc(error)+'</p>';
  if (!latest) return '<p id="benchmark-status" class="run-notice">Showing the packaged benchmark.</p>';
  const finished=new Intl.DateTimeFormat("en-GB",{dateStyle:"medium",timeStyle:"medium",timeZone:"Asia/Karachi"}).format(latest.finished);
  const elapsed=latest.duration<0.01?"<0.01":latest.duration.toFixed(2);
  return '<p id="benchmark-status" class="run-notice '+(latest.matches?"is-complete":"is-different")+'">'+
    '<strong>Run '+attempt+' complete</strong><span>'+latest.result.count+' alerts · '+esc(elapsed)+' ms · '+esc(finished)+' PKT</span>'+
    '<span>'+ (latest.matches?"Predictions match the packaged benchmark.":"Predictions differ from the packaged benchmark. Review the alert results.")+'</span></p>';
}

function confusion(title,scores) {
  return '<section class="panel matrix-panel"><h3>'+esc(title)+'</h3><table class="confusion">'+
    '<thead><tr><th scope="col">Actual label</th><th scope="col">Escalated</th><th scope="col">Cleared</th></tr></thead>'+
    '<tbody><tr><th scope="row">Attack</th><td class="matrix-correct">'+scores.tp+'<small>True positives</small></td>'+
    '<td class="matrix-error">'+scores.fn+'<small>Missed attacks</small></td></tr>'+
    '<tr><th scope="row">Benign</th><td class="matrix-error">'+scores.fp+'<small>False escalations</small></td>'+
    '<td class="matrix-correct">'+scores.tn+'<small>True negatives</small></td></tr></tbody></table></section>';
}

function accuracyBar(title,value,tone) {
  return '<div class="accuracy-row"><div><span>'+esc(title)+'</span><strong>'+percent(value)+'</strong></div>'+
    '<div class="accuracy-track"><span class="accuracy-'+tone+'" style="width:'+value*100+'%"></span></div></div>';
}

function evaluation() {
  const {running,latest}=state.benchmark;
  const packaged=PSIAData.benchmark;
  const b=latest?.result||packaged;
  const decided=b.count-b.hybrid.review;
  const decidedCorrect=b.hybrid.predictions.filter(row=>row.verdict!=="Review"&&row.verdict===row.label).length;
  const ruleById=new Map(b.rules.predictions.map(row=>[row.id,row]));
  const rows=b.hybrid.predictions.map(row=>{
    const rule=ruleById.get(row.id);
    const correct=(row.verdict!=="Benign")===(row.label==="Attack");
    return [row.id,row.label,rule.verdict,row.verdict,row.probability==null?"—":percent(row.probability),
      correct?"Correct":row.label==="Attack"?"Missed attack":"False escalation"];
  });
  return '<div class="page-heading evaluation-heading"><div>'+heading("Pilot evaluation",packaged.training+
    " training descriptions and "+b.count+" held-out synthetic alerts. Attack and Review count as escalations.")+
    '</div><div class="benchmark-control"><button class="primary" id="benchmark" '+(running?"disabled":"")+'>'+
    (running?"Running benchmark…":"Run accuracy benchmark")+'</button>'+benchmarkNotice()+'</div></div>'+
    '<section class="panel comparison"><div class="section-title"><h2>Accuracy comparison</h2>'+
    badge(latest?"Latest local run":"Packaged results",latest?"positive":"neutral")+'</div>'+
    accuracyBar("Hybrid ML and guardrails",b.hybrid.accuracy,"hybrid")+accuracyBar("Severity-only baseline",b.rules.accuracy,"rules")+'</section>'+
    cards([[b.count,"Held-out cases","accent"],[b.hybrid.fn,"Hybrid missed attacks",b.hybrid.fn?"critical":"positive"],
      [b.hybrid.fp,"Hybrid false escalations","warning"],[percent(b.hybrid.recall),"Hybrid recall","positive"]])+
    '<div class="grid matrix-grid">'+confusion("Hybrid confusion matrix",b.hybrid)+confusion("Severity-only confusion matrix",b.rules)+'</div>'+
    '<section class="panel results-panel"><h2>Model metrics</h2>'+table(["Measure","Severity only","Hybrid"],[
      ["Precision",percent(b.rules.precision),percent(b.hybrid.precision)],["Recall",percent(b.rules.recall),percent(b.hybrid.recall)],
      ["F1",percent(b.rules.f1),percent(b.hybrid.f1)],["Review verdicts",b.rules.review,b.hybrid.review],
    ])+'<h3>Coverage and review workload</h3>'+valueList([
      ["Classification coverage",percent(decided/b.count)+" · "+decided+" / "+b.count+" receive Attack or Benign"],
      ["Accuracy on classified cases",decided?percent(decidedCorrect/decided)+" · "+decidedCorrect+" / "+decided:"No classified cases"],
      ["Sent for manual review",b.hybrid.review+" / "+b.count],
      ["Human verification",b.count+" / "+b.count+" suggestions require verification"],
    ])+'<p>The headline accuracy measures escalation decisions. Review counts as escalation, so examine coverage and the confusion matrices alongside it.</p>'+
    '</section><section class="panel results-panel"><h2>Per-alert results</h2>'+
    table(["Alert","Actual","Severity-only verdict","Hybrid verdict","Model attack score","Hybrid outcome"],rows)+'</section>'+
    '<div class="grid"><section class="panel"><h2>Security fixtures</h2><p>'+packaged.injection.filter(item=>item.expected&&item.observed).length+
    ' / 5 instruction-like fixtures flagged. '+packaged.masking+' synthetic identifier values masked across the held-out set.</p></section>'+
    '<section class="panel"><h2>Original packaged timing study</h2><p>The earlier implementation measured '+packaged.medianMs+' ms median per '+packaged.count+'-alert batch over '+packaged.runs+
    ' runs. Modeled analyst effort: '+packaged.workload.manual+' to '+packaged.workload.assisted+' min. Human review time remains unmeasured.</p></section></div>';
}

async function runBenchmark() {
  const run=state.benchmark;
  if (run.running) return;
  run.running=true;
  run.error="";
  render();
  const announcer=document.querySelector("#benchmark-announcer");
  announcer.textContent="Running accuracy benchmark on "+PSIAScenarios.heldout.length+" held-out alerts.";
  // Give the browser a paint before running the synchronous classifier and scoring.
  await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
  try {
    const started=performance.now();
    const result=PSIAModel.evaluate(PSIAScenarios.heldout,PSIAData.assets,predict);
    const duration=performance.now()-started;
    const packaged=PSIAData.benchmark;
    const matches=["rules","hybrid"].every(key=>
      JSON.stringify(result[key].predictions)===JSON.stringify(packaged[key].predictions));
    run.latest={result,duration,finished:new Date(),matches};
    run.attempt+=1;
  } catch (error) {
    const context=run.latest?" The last completed run is still shown.":" The packaged results are still shown.";
    run.error="Benchmark failed. "+(error.message||"The model could not score these alerts.")+context+" Select Run accuracy benchmark to retry.";
  } finally {
    run.running=false;
    announcer.textContent=run.error||("Run "+run.attempt+" complete. Hybrid accuracy "+percent(run.latest.result.hybrid.accuracy)+
      ". Severity-only accuracy "+percent(run.latest.result.rules.accuracy)+". Predictions "+(run.latest.matches?"match":"differ from")+" the packaged benchmark.");
    if (state.page==="evaluation") {
      render();
      document.querySelector("#benchmark").focus({preventScroll:true});
    }
  }
}

const pages={overview,console:consolePage,dashboard,registers,governance,evaluation};
function render() {
  view.innerHTML=pages[state.page]();
  document.querySelectorAll("[data-page]").forEach(button=>{
    if (button.dataset.page===state.page) button.setAttribute("aria-current","page");
    else button.removeAttribute("aria-current");
  });
  document.querySelector("#mode").textContent=state.mode==="ml"?"Offline ML":"Rules fallback";
}

async function replay() {
  if (!window.crypto?.subtle) throw Error("Open the console in Microsoft Edge or Chrome to enable audit hashing.");
  state.alerts=[];state.decisions={};state.log=[];state.overlay=null;state.filter="All";
  state.selectedAlert=null;
  state.replayMode=state.mode;
  state.actionNotice=null;
  const start = performance.now();
  state.alerts=PSIAScenarios.heldout.map(a=>PSIAModel.assess(a,PSIAData.assets,state.mode==="ml"?predict:null));
  const elapsed=performance.now()-start;
  await writeLog("replay",{engine:state.mode,alerts:state.alerts.length,batchMs:Number(elapsed.toFixed(3))});
  for (const {id,verdict,priority,flagged,masked} of state.alerts) {
    await writeLog("triage",{id,verdict,priority,flagged,masked});
  }
  tell("Replay complete. Choose an approving role to test the response workflow.");
}

async function approve(id) {
  const action=PSIAScenarios.approvalCatalogue.find(a=>a.id===id);
  if(!action) throw Error("Unknown action.");
  const actor=actorList[state.actor||0];
  const decisions=state.decisions[id]||[];
  if (action.dependsOn && state.decisions[action.dependsOn]?.length!==2) throw Error("Complete simulated isolation before restart.");
  if (decisions.some(a=>a[0]===actor[0])) throw Error("Duplicate approval blocked. Choose the other authorized role.");
  if (!action.roles.includes(actor[1])) throw Error(actor[1]+" cannot approve this action.");
  if (decisions.length>=action.tier) throw Error("This action is already approved.");
  const next=[...decisions,actor];
  await writeLog("approval",{id,actor:actor[0],role:actor[1],step:next.length,simulation:true});
  state.decisions[id]=next;
  if (action.overlay && next.length===action.tier) {
    state.overlay={evidence:"EV-LIVE-01",control:"C-15",risk:"R-15",finding:"F-15",source:"A2-EV-15",result:"Fail",likelihood:3,simulation:true};
    await writeLog("register overlay",state.overlay);
    return "EV-LIVE-01 recorded. It corroborates the C-15 failure and raises R-15 from 10 to 15.";
  }
  return next.length===action.tier?"Action approved in the exercise.":"First approval recorded. The other authorized role must approve.";
}

function guarded(task,afterRender) {
  return async () => {
    if (state.busy) return;
    state.busy=true;
    try {await task(); render(); afterRender?.();} catch(error) {tell(error.message,true);}
    finally {state.busy=false;}
  };
}

document.addEventListener("click",event=>{
  const target=event.target.closest("button");
  if (!target || state.busy) return;
  if (target.dataset.finding) {
    const detail=document.getElementById(target.dataset.finding);
    detail.open=true;detail.querySelector("summary").focus();
    detail.scrollIntoView({block:"start",behavior:"auto"});return;
  }
  if (target.dataset.control || target.dataset.compliance) {
    state.page="registers";state.register=target.dataset.control?"Controls":"Compliance";
    state.query=target.dataset.control||"";
    render();window.scrollTo(0,0);document.querySelector("#query").focus();return;
  }
  if (target.dataset.controls) {
    state.page="registers";state.register="Controls";state.query="";
    render();window.scrollTo(0,0);document.querySelector("#register").focus();return;
  }
  if (target.dataset.evidence) {
    state.page="registers";state.register="Evidence";state.query=target.dataset.evidence;
    render();window.scrollTo(0,0);document.querySelector("#query").focus();return;
  }
  const page=target.dataset.page||target.dataset.go;
  if (page) {state.page=page;tell("");render();window.scrollTo(0,0);return;}
  if (target.dataset.alert) {
    const scroll=document.querySelector(".queue-list").scrollTop;
    state.selectedAlert=target.dataset.alert;
    render();
    document.querySelector(".queue-list").scrollTop=scroll;
    document.querySelector('[data-alert="'+state.selectedAlert+'"]').focus({preventScroll:true});
    return;
  }
  if (target.id==="replay") guarded(replay)();
  if (target.dataset.approve) {
    const id=target.dataset.approve;
    guarded(async ()=>{
      try {state.actionNotice={id,text:await approve(id),error:false};}
      catch(error) {state.actionNotice={id,text:error.message,error:true};}
      tell(state.actionNotice.text,state.actionNotice.error);
    },()=>{
      const button=document.querySelector('[data-approve="'+id+'"]');
      (button.disabled?document.querySelector("#action-"+id):button).focus({preventScroll:true});
    })();
  }
  if (target.id==="benchmark") runBenchmark();
  if (target.id==="verify") guarded(async ()=> {
    tell(state.log.length ? (await verifyLog()?"Verified "+state.log.length+" chained entries.":"The decision log failed verification."):"Replay an incident to generate a log.");
  })();
  if (target.id==="export") guarded(async ()=>{
    const blob=new Blob([JSON.stringify({alerts:state.alerts,log:state.log,overlay:state.overlay,metrics:metrics()},null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const link=document.createElement("a");
    link.href=url; link.download="PSIA-session-evidence.json"; link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    tell("Session evidence downloaded.");
  })();
});
document.addEventListener("change",event=>{
  const {id,value}=event.target;
  if (id==="actor") state.actor=Number(value);
  if (id==="filter") {state.filter=value;render();}
  if (id==="register") {state.register=value;state.query="";render();}
  if (id==="engine") {
    state.mode=value; render();
    tell("Triage mode set for the next replay.");
  }
  if (id==="trial-asset") state.trial.asset=value;
  if (id==="trial-severity") state.trial.severity=value;
  if (id==="trial-safety") state.trial.safety=event.target.checked;
});
document.addEventListener("input",event=>{
  if (event.target.id==="trial-text") {state.trial.text=event.target.value;return;}
  if (event.target.id!=="query") return;
  state.query=event.target.value;
  const updated=document.createElement("div");
  updated.innerHTML=registers();
  document.querySelector("#register-results").replaceChildren(...updated.querySelector("#register-results").childNodes);
});
document.addEventListener("toggle",event=>{
  if (event.target.id==="trial-panel") state.trial.open=event.target.open;
},true);
document.addEventListener("submit",event=>{
  if (event.target.id!=="trial-form") return;
  event.preventDefault();
  if (state.busy) return;
  const trial=state.trial;
  trial.result=PSIAModel.assess({id:"TRIAL-01",asset:trial.asset,severity:Number(trial.severity),
    text:trial.text,safety:trial.safety,source:"Synthetic user input",group:null},PSIAData.assets,predict);
  document.querySelector("#trial-result").innerHTML=trialResult();
});
render();
