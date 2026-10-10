'use client';
import Link from 'next/link';
import { guidance } from '../lib/guidance';
import { exportReport } from '../lib/export';
import { useState, type FormEvent } from 'react';
import { PROVIDER_LABELS, SOURCES, type Mode, type Provider, type Report } from '../lib/model';
import styles from './page.module.css';
const workflows: {id:Mode;number:string;title:string;subtitle:string}[] = [
 {id:'health',number:'01',title:'RPC health',subtitle:'Check the connection'},
 {id:'gas',number:'02',title:'Gas-limit analysis',subtitle:'Understand what you pay'},
 {id:'transaction',number:'03',title:'Transaction lifecycle',subtitle:'Separate execution from finality'}
];
export default function Dashboard() {
 const [mode,setMode]=useState<Mode>('health'),[provider,setProvider]=useState<Provider>('primary');
 const [hash,setHash]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[data,setData]=useState('0x'),[value,setValue]=useState('0'),[gasLimit,setGasLimit]=useState('1000000');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[report,setReport]=useState<Report|null>(null);
 function changeMode(next:Mode) { setMode(next);setReport(null);setError(''); }
 async function run(event:FormEvent) {
  event.preventDefault();setBusy(true);setError('');setReport(null);
  try {
   const body={mode,provider,...(mode==='transaction'?{hash}:{}),...(mode==='gas'?{gasLimit,call:{from,to,data,value}}:{})};
   const response=await fetch('/api/diagnose',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
   const result=await response.json();
   if(!response.ok) throw new Error(typeof result.error==='string'?result.error:'Diagnostic request failed.');
   setReport(result as Report);
  } catch(e) { setError(e instanceof Error && e.name==='TimeoutError'?'The diagnostic timed out. Retry or choose the other RPC provider.':e instanceof Error?e.message:'Unable to reach the diagnostic server.'); }
  finally {setBusy(false);}
 }
 function exportEvidence() {
  if(!report)return;
  let shared;try {shared=exportReport(report);}catch {setError('This report could not be safely exported. Rerun the diagnostic.');return;}
  const blob=new Blob([JSON.stringify(shared,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='monad-doctor-'+report.mode+'-'+report.startedAt.replace(/[:.]/g,'-')+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 const warnings=report?.findings.filter(f=>f.severity==='warning'||f.severity==='error').length;
 return <div className={styles.shell}>
  <header className={styles.header}><Link className={styles.brand} href="/" aria-label="Monad Doctor home"><span className={styles.logo}>+</span><span>monad<span className={styles.brandLight}>doctor</span></span></Link><div className={styles.headerRight}><span className={styles.readOnly}>Read-only by design</span><span className={styles.network}>TARGET <b>Mainnet / 143</b></span></div></header>
  <main>
   <section className={styles.hero}><div><p className={styles.eyebrow}>THE INTEGRATION WORKBENCH</p><h1>Find the fault.<br/><span>Keep the evidence.</span></h1><p className={styles.intro}>A clearer path from “why did this happen?” to your next fix.<br/>Inspect Monad RPC, gas limits, and transaction outcomes.</p></div><div className={styles.heroNote}><span className={styles.cross}>✳</span><p>Built for Monad.<br/><strong>Grounded in what the RPC returns.</strong></p><a href={SOURCES.rpc} target="_blank" rel="noreferrer">Official technical reference ↗</a></div></section>
   <div className={styles.workspace}>
    <aside className={styles.sidebar}><p className={styles.sectionLabel}>CHOOSE A DIAGNOSTIC</p><nav aria-label="Diagnostics">{workflows.map(w=><button key={w.id} disabled={busy} aria-pressed={mode===w.id} className={mode===w.id?styles.activeTool:styles.tool} onClick={()=>changeMode(w.id)}><span className={styles.toolNumber}>{w.number}</span><span><strong>{w.title}</strong><small>{w.subtitle}</small></span><span aria-hidden="true">↗</span></button>)}</nav><div className={styles.safety}><span className={styles.smallCross}>+</span><strong>Your keys stay yours.</strong><p>No wallet connection.<br/>No signatures. No transactions.</p><span>Requests only read or simulate.</span></div></aside>
    <div className={styles.mainColumn}>
     <section className={styles.panel} aria-labelledby="diagnostic-title"><div className={styles.panelHeading}><div><p className={styles.sectionLabel}>DIAGNOSTIC / {workflows.find(w=>w.id===mode)?.number}</p><h2 id="diagnostic-title">{workflows.find(w=>w.id===mode)?.title}</h2></div><span className={styles.tag}>MONAD MAINNET</span></div>
      <form onSubmit={run}><fieldset disabled={busy} className={styles.fieldset}><label className={styles.field}>RPC provider<select value={provider} onChange={e=>{setProvider(e.target.value as Provider);setReport(null);}}>{Object.entries(PROVIDER_LABELS).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select><small>Server-approved public endpoints. No API key required.</small></label>
      {mode==='health'&&<div className={styles.explainer}><span className={styles.orbit} aria-hidden="true">◎</span><div><strong>Start with the fundamentals.</strong><p>Confirm chain ID, read the latest and finalized heads, and inspect response timing. An unavailable check stays unknown.</p><div className={styles.checkLabels}><span>Chain identity</span><span>Block evidence</span><span>RPC availability</span></div></div></div>}
      {mode==='transaction'&&<><label className={styles.field}>Transaction hash<input required value={hash} onChange={e=>setHash(e.target.value)} placeholder="0x… (64 hexadecimal characters)" spellCheck={false} autoComplete="off" maxLength={66}/><small>Use a public Monad Mainnet transaction hash.</small></label><p className={styles.note}>A receipt describes execution. Finality also requires a matching block and the provider’s finalized head. A null lookup does not mean failure.</p></>}
      {mode==='gas'&&<><div className={styles.exampleRow}><p>Analyze an unsigned call. Nothing is submitted.</p><button type="button" className={styles.textButton} onClick={()=>{setFrom('0x0000000000000000000000000000000000000001');setTo('0x000000000000000000000000000000000000dead');setValue('0');setData('0x');setGasLimit('1000000');setReport(null);}}>Load padding example ↗</button></div><div className={styles.formGrid}><label className={styles.field}>Sender address<input required value={from} onChange={e=>setFrom(e.target.value)} placeholder="0x…" spellCheck={false} maxLength={42}/></label><label className={styles.field}>Recipient address<input required value={to} onChange={e=>setTo(e.target.value)} placeholder="0x…" spellCheck={false} maxLength={42}/></label><label className={styles.field}>Proposed gas limit<input required inputMode="numeric" value={gasLimit} onChange={e=>setGasLimit(e.target.value)} maxLength={78}/></label><label className={styles.field}>Value in wei<input required inputMode="numeric" value={value} onChange={e=>setValue(e.target.value)} maxLength={78}/></label></div><label className={styles.field}>Calldata<textarea required value={data} onChange={e=>setData(e.target.value)} spellCheck={false} maxLength={8194} rows={2}/><small>Hex bytes, up to 4 KiB. Use 0x for empty calldata.</small></label><p className={styles.note}>Monad charges the submitted gas limit. Estimation uses a sampled finalized block; future state and fees can change.</p></>}
      <div className={styles.formFooter}><span>Evidence first. Assumptions labeled.</span><button className={styles.runButton} disabled={busy} type="submit">{busy?'Reading RPC…':'Run diagnostic'} <span aria-hidden="true">{busy?'◌':'→'}</span></button></div></fieldset></form>
      {error&&<div className={styles.error} role="alert">{error}</div>}
     </section>
     <section className={styles.results} aria-label="Diagnostic results" aria-busy={busy} aria-live="polite">
      <div className={styles.resultHeader}><div><p className={styles.sectionLabel}>THE EVIDENCE</p><h2>Your diagnostic report</h2></div>{report&&<button className={styles.exportButton} onClick={exportEvidence}>Export JSON ↓</button>}</div>
      {!report?<div className={styles.empty}><span className={styles.emptyIcon} aria-hidden="true">{busy?'◌':'⌁'}</span><h3>{busy?'Following the evidence…':'Ready when you are.'}</h3><p>{busy?'Requests are bounded. Partial results will remain visible if a check fails.':'Run a diagnostic to see observations, possible risks, and concrete next steps.'}</p><span>No sample findings. No invented results.</span></div>:<><div className={styles.summary}><div><small>RPC REQUESTS</small><strong>{report.evidence.length.toString().padStart(2,'0')}</strong></div><div><small>NEEDS ATTENTION</small><strong>{warnings?.toString().padStart(2,'0')}</strong></div><div><small>CAPTURED AT</small><strong className={styles.time}>{new Date(report.startedAt).toLocaleTimeString()}</strong><small>{PROVIDER_LABELS[report.provider]}</small></div></div>
       <div className={styles.findings}>{report.findings.map(f=><article key={f.id} className={styles.finding}><div className={styles.findingTop}><span className={styles[f.severity === 'error' ? 'errorBadge' : f.severity]}>{f.severity==='pass'?'✓':f.severity==='error'?'!':f.severity==='warning'?'!':'i'} {f.severity}</span><span className={styles.basis}>{f.basis}</span><code>{f.id}</code></div><h3>{f.title}</h3><p>{f.detail}</p><div className={styles.nextStep}><strong>Next step</strong><p>{f.nextStep}</p></div><details className={styles.explanation}><summary>Understand and verify this finding</summary><dl>{Object.entries(guidance(f.id)).map(([key,text])=><div key={key}><dt>{{checked:"What was checked",unknown:"What remains unknown",why:"Why it matters",verify:"How to verify"}[key as keyof ReturnType<typeof guidance>]}</dt><dd>{text}</dd></div>)}</dl></details><div className={styles.sourceRow}>{f.sources.map((s,i)=><a key={s} href={s} target="_blank" rel="noreferrer">Monad docs {i+1} ↗</a>)}<span>{f.evidence.length?'Evidence #'+f.evidence.join(', #'):'Input + documented rule'}</span></div></article>)}</div>
       <details className={styles.raw}><summary>Inspect reproducible RPC evidence <span>{report.evidence.length} requests</span></summary><p>Validated response fields only. Upstream error text is excluded to prevent credential echoes. Export includes public addresses; calldata is redacted.</p>{report.evidence.map(e=><div key={e.id}><h4>#{e.id} · {e.method} <small>{e.durationMs} ms</small></h4><pre>{JSON.stringify(e,null,2)}</pre></div>)}</details></>}
     </section>
    </div>
   </div>
   <footer className={styles.footer}><span>MONAD DOCTOR <b>/</b> M3 WORKBENCH</span><span>Observed ≠ inferred ≠ unknown</span><a href={SOURCES.gas} target="_blank" rel="noreferrer">Understand Monad gas ↗</a></footer>
  </main>
 </div>;
}
