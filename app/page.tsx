'use client';
import Link from 'next/link';
import { exportReport } from '../lib/export';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { HealthComparisonView } from './health-comparison-view';
import { readHealthComparisonResponse, decodeHealthComparison, type DecodedComparison } from '../lib/health-comparison-response';
import { COMPARISON_HEADER, COMPARISON_OPERATION } from '../lib/health-comparison-request';
import { ReportView } from './report-view';
import { inputErrors, responseError, retryAfterMs, snapshotIsStale, symptoms } from '../lib/presentation';
import { parseInput } from '../lib/validation';
import { PROVIDER_LABELS, SOURCES, type Input, type Mode, type Provider, type Report } from '../lib/model';
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
 const [healthScope,setHealthScope]=useState<'single'|'comparison'>('single');
 const [comparison,setComparison]=useState<{decoded:DecodedComparison;receivedAt:string}|null>(null);
 const activeRun=useRef<{controller:AbortController}|null>(null);
 useEffect(()=>()=>{activeRun.current?.controller.abort();},[]);
 const comparing=mode==='health'&&healthScope==='comparison';
 const [errors,setErrors]=useState<Record<string,string>>({}),[retryUntil,setRetryUntil]=useState(0);
 const submitButton=useRef<HTMLButtonElement>(null);
 const title=useRef<HTMLHeadingElement>(null),resultsTitle=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{if(!retryUntil)return;const timer=setTimeout(()=>setRetryUntil(0),Math.max(0,retryUntil-Date.now()));return ()=>clearTimeout(timer);},[retryUntil]);
 const input=useMemo<Input>(()=>({mode,provider,...(mode==='transaction'?{hash}:{}),...(mode==='gas'?{gasLimit,call:{from,to,data,value}}:{})}),[mode,provider,hash,gasLimit,from,to,data,value]);
 const stale=report? comparing||snapshotIsStale(input,report):false;
 const capturedComparison=comparison?.decoded.result.kind==='comparison'?comparison.decoded.result.report:null;
 function changeMode(next:Mode) {setMode(next);setErrors({});setError('');requestAnimationFrame(()=>title.current?.focus());}
 function fieldError(name:string) {return errors[name]?<small id={name+'-error'} className={styles.fieldError}>{errors[name]}</small>:null;}
 function fieldProps(name:string) {return {id:name,name,'aria-invalid':Boolean(errors[name]),'aria-describedby':errors[name]?name+'-error':undefined,onInput:()=>setErrors({})};}
 const run=useCallback(async (event:FormEvent) => {
  event.preventDefault();if(activeRun.current||retryUntil)return;
  const invalid=comparing?{}:inputErrors(input);setErrors(invalid);
  if(Object.keys(invalid).length){requestAnimationFrame(()=>document.getElementById(Object.keys(invalid)[0])?.focus());return;}
  const captured=comparing?{mode:'health_comparison',providers:['primary','secondary'],alignSharedHeight:true}:parseInput(input);
  const job={controller:new AbortController()};activeRun.current=job;setBusy(true);setError('');
  try {
   const response=await fetch('/api/diagnose',{method:'POST',headers:{'Content-Type':'application/json',...(comparing?{[COMPARISON_HEADER]:COMPARISON_OPERATION}:{})},body:JSON.stringify(captured),signal:AbortSignal.any([job.controller.signal,AbortSignal.timeout(comparing?28000:25000)])});
   if(activeRun.current!==job)return;
   const wait=retryAfterMs(response.headers.get('Retry-After'),Date.now());
   if(wait)setRetryUntil(Date.now()+wait);
   if(comparing&&response.status===504)throw new Error('Comparison publication timed out. Cancellation was requested; server cleanup is not confirmed. No new report was received.');
   if(!response.ok&&!(comparing&&response.status===500)) throw new Error(responseError(response.status));
   if(comparing){
    let decoded:DecodedComparison;
    try {decoded=await readHealthComparisonResponse(response,job.controller.signal,captured);}catch {throw new Error('The server returned an invalid or incompatible comparison. No new outcome is established.');}
    if(activeRun.current!==job)return;
    if(decoded.result.kind!=='comparison')throw new Error('The comparison could not be published safely. No new report was established; cleanup is not confirmed by this message.');
    setComparison({decoded,receivedAt:new Date().toISOString()});setReport(null);requestAnimationFrame(()=>resultsTitle.current?.focus());return;
   }
   let result:Report;
   try {result=await response.json();exportReport(result);if(snapshotIsStale(captured,result))throw new Error('Input mismatch');}
   catch {throw new Error('The server returned an invalid or incompatible report. No new diagnostic outcome is established.');}
   if(activeRun.current!==job)return;
   setReport(result);setComparison(null);requestAnimationFrame(()=>resultsTitle.current?.focus());
  } catch(e) {if(activeRun.current===job)setError(e instanceof Error && e.name==='TimeoutError'?'The diagnostic timed out. No new report was received. Retry explicitly when ready.':e instanceof TypeError?'Unable to reach the diagnostic server. Check connectivity and retry explicitly.':e instanceof Error?e.message:'Unable to reach the diagnostic server.');}
  finally {if(activeRun.current===job){activeRun.current=null;setBusy(false);}}
 },[retryUntil,input,comparing]);
 function cancelComparison(){const job=activeRun.current;if(!job)return;activeRun.current=null;job.controller.abort();setBusy(false);setError('Stopped waiting; server cleanup is not confirmed. No new comparison report was received.');requestAnimationFrame(()=>submitButton.current?.focus());}
 function download(text:string,name:string){const blob=new Blob([text],{type:'application/json'});const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function exportEvidence() {
  if(comparison){try{const validated=decodeHealthComparison(comparison.decoded.text);download(validated.text,'monad-doctor-comparison-'+(validated.result.kind==='comparison'?validated.result.report.runId:validated.result.runId)+'.json');}catch{setError('This comparison could not be safely exported.');}return;}
  if(!report)return;
  let shared;try {shared=exportReport(report);}catch {setError('This report could not be safely exported. Rerun the diagnostic.');return;}
  const blob=new Blob([JSON.stringify(shared,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='monad-doctor-'+report.mode+'-'+report.startedAt.replace(/[:.]/g,'-')+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 return <div className={styles.shell}>
  <header className={styles.header}><Link className={styles.brand} href="/" aria-label="Monad Doctor home"><span className={styles.logo}>+</span><span>monad<span className={styles.brandLight}>doctor</span></span></Link><div className={styles.headerRight}><span className={styles.readOnly}>Read-only by design</span><span className={styles.network}>TARGET <b>Mainnet / 143</b></span></div></header>
  <a className={styles.skipLink} href="#diagnostic-title">Skip to diagnostic</a><main>
   <section className={styles.hero}><div><p className={styles.eyebrow}>THE INTEGRATION WORKBENCH</p><h1>Investigate Monad<br/><span>integration problems.</span></h1><p className={styles.intro}>Before they reach production. Read-only checks backed by RPC evidence.<br/>Understand observations, uncertainty and the next action.</p></div><div className={styles.heroNote}><span className={styles.cross}>✳</span><p>Built for Monad.<br/><strong>Grounded in what the RPC returns.</strong></p><a href={SOURCES.rpc} target="_blank" rel="noreferrer">Official technical reference ↗</a></div></section>
   <section className={styles.symptoms} aria-labelledby="symptom-title"><h2 id="symptom-title">What are you investigating?</h2><div>{symptoms.map(s=><button key={s.mode} disabled={busy} aria-pressed={mode===s.mode} onClick={()=>changeMode(s.mode)}>{s.label}</button>)}</div><p>Selection makes no RPC requests.</p></section>
   <div className={styles.workspace}>
    <aside className={styles.sidebar}><details className={styles.expert}><summary>Technical modes</summary><nav aria-label="Diagnostics">{workflows.map(w=><button key={w.id} disabled={busy} aria-pressed={mode===w.id} className={mode===w.id?styles.activeTool:styles.tool} onClick={()=>changeMode(w.id)}><span className={styles.toolNumber}>{w.number}</span><span><strong>{w.title}</strong><small>{w.subtitle}</small></span><span aria-hidden="true">↗</span></button>)}</nav></details><div className={styles.safety}><span className={styles.smallCross}>+</span><strong>Your keys stay yours.</strong><p>No wallet connection.<br/>No signatures. No transactions.</p><span>Requests only read or simulate.</span></div></aside>
    <div className={styles.mainColumn}>
     <section className={styles.panel} aria-labelledby="diagnostic-title"><div className={styles.panelHeading}><div><p className={styles.sectionLabel}>DIAGNOSTIC / {workflows.find(w=>w.id===mode)?.number}</p><h2 ref={title} id="diagnostic-title" tabIndex={-1}>{workflows.find(w=>w.id===mode)?.title}</h2></div><span className={styles.tag}>MONAD MAINNET</span></div>
      <form onSubmit={run} noValidate><fieldset disabled={busy} className={styles.fieldset}>{mode==='health'&&<fieldset className={styles.healthScope}><legend>RPC health scope</legend><label><input type="radio" name="health-scope" checked={healthScope==='single'} onChange={()=>setHealthScope('single')}/> Inspect one provider</label><label><input type="radio" name="health-scope" checked={healthScope==='comparison'} onChange={()=>setHealthScope('comparison')}/> Compare both approved providers</label></fieldset>}{!comparing&&<label className={styles.field}>RPC provider<select value={provider} onChange={e=>{setProvider(e.target.value as Provider);}}>{Object.entries(PROVIDER_LABELS).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select><small>Approved public endpoints only. This does not test an arbitrary endpoint from your application.</small></label>}
      {comparing&&<div className={styles.explainer}><div><strong>Compare approved public observations.</strong><p>{PROVIDER_LABELS.primary} (rpc.monad.xyz) and {PROVIDER_LABELS.secondary} (rpc1.monad.xyz). Chain identity, finalized and latest heads are sampled sequentially, with an optional shared-height sample when eligible.</p><p>Up to eight RPC calls; one ten-unit quota reservation. No automatic retries, provider ranking or consensus verification.</p></div></div>}
      {mode==='health'&&!comparing&&<div className={styles.explainer}><span className={styles.orbit} aria-hidden="true">◎</span><div><strong>Inspect the selected public provider.</strong><p>Choose a provider; no other inputs are required. Confirm chain ID, compare latest and finalized heads, and inspect response timing. An unavailable check stays unknown.</p><div className={styles.checkLabels}><span>Chain identity</span><span>Block evidence</span><span>RPC availability</span></div></div></div>}
      {mode==='transaction'&&<><label className={styles.field}>Transaction hash<input {...fieldProps('hash')} required value={hash} onChange={e=>setHash(e.target.value)} placeholder="0x… (64 hexadecimal characters)" spellCheck={false} autoComplete="off" maxLength={66}/>{fieldError('hash')}<small>Use a public Monad Mainnet transaction hash. No hash? Retrieve it from your application’s submission response first.</small></label><p className={styles.note}>A receipt describes execution. Finality also requires a matching block and the provider’s finalized head. A null lookup does not mean failure.</p></>}
      {mode==='gas'&&<><div className={styles.exampleRow}><p>Provide sender, recipient, value, calldata and proposed gas. We simulate the unsigned call; nothing is submitted.</p><button type="button" className={styles.textButton} onClick={()=>{setFrom('0x0000000000000000000000000000000000000001');setTo('0x000000000000000000000000000000000000dead');setValue('0');setData('0x');setGasLimit('1000000');setErrors({});}}>Load padding example ↗</button></div><div className={styles.formGrid}><label className={styles.field}>Sender address<input {...fieldProps('from')} required value={from} onChange={e=>setFrom(e.target.value)} placeholder="0x…" spellCheck={false} maxLength={42}/>{fieldError('from')}</label><label className={styles.field}>Recipient address<input {...fieldProps('to')} required value={to} onChange={e=>setTo(e.target.value)} placeholder="0x…" spellCheck={false} maxLength={42}/>{fieldError('to')}</label><label className={styles.field}>Proposed gas limit<input {...fieldProps('gasLimit')} required inputMode="numeric" value={gasLimit} onChange={e=>setGasLimit(e.target.value)} maxLength={78}/>{fieldError('gasLimit')}</label><label className={styles.field}>Value in wei<input {...fieldProps('value')} required inputMode="numeric" value={value} onChange={e=>setValue(e.target.value)} maxLength={78}/>{fieldError('value')}</label></div><label className={styles.field}>Calldata<textarea {...fieldProps('data')} required value={data} onChange={e=>setData(e.target.value)} spellCheck={false} maxLength={8194} rows={2}/>{fieldError('data')}<small>Hex bytes, up to 4 KiB. Use 0x for empty calldata.</small></label><p className={styles.note}>Monad charges the submitted gas limit. Estimation uses a sampled finalized block; future state and fees can change.</p></>}
      <div className={styles.formFooter}><span>{comparing?'Up to 8':mode==='health'?'Up to 3':mode==='gas'?'Up to 4':'Up to 5'} RPC calls per run. No automatic retries.</span><button ref={submitButton} className={styles.runButton} disabled={busy||retryUntil>0} type="submit">{busy?'Reading RPC…':comparing?'Run comparison':'Run diagnostic'} <span aria-hidden="true">{busy?'◌':'→'}</span></button></div></fieldset></form>{busy&&comparing&&<button type="button" className={styles.exportButton} onClick={cancelComparison}>Cancel comparison</button>}
      {retryUntil>0&&<p className={styles.note} role="status">Run is paused until {new Date(retryUntil).toISOString()} to respect the server’s Retry-After. No automatic retry.</p>}
      {error&&<div className={styles.error} role="alert">{error}</div>}
     </section>
     <p role="status" className={styles.announcement}>{busy?'Reading bounded RPC evidence.':error?'No new report received.':report||comparison?'Report received. Review findings and uncertainty.':'Ready to run a diagnostic.'}</p>
     <section className={styles.results} aria-label="Diagnostic results" aria-busy={busy}>
      <div className={styles.resultHeader}><div><p className={styles.sectionLabel}>THE EVIDENCE</p><h2 ref={resultsTitle} tabIndex={-1}>Your diagnostic report</h2></div>{(report||comparison)&&<button className={styles.exportButton} onClick={exportEvidence}>Export JSON ↓</button>}</div>
      {!report&&!comparison?<div className={styles.empty}><span className={styles.emptyIcon} aria-hidden="true">{busy?'◌':'⌁'}</span><h3>{busy?'Following the evidence…':'Ready when you are.'}</h3><p>{busy?'Requests are bounded. Available and unavailable observations will be distinguished in the returned report.':'Run a diagnostic to see observations, uncertainty and concrete next steps.'}</p><span>No sample findings. No invented results.</span></div>:<>{busy&&<p role="status">Previous report remains visible while the new check runs.</p>}{capturedComparison&&comparison?<HealthComparisonView report={capturedComparison} receivedAt={comparison.receivedAt} stale={!comparing}/>:report?<ReportView report={report} stale={stale}/>:null}</>}
     </section>
    </div>
   </div>
   <footer className={styles.footer}><span>MONAD DOCTOR <b>/</b> READ-ONLY WORKBENCH</span><span>Observed ≠ inferred ≠ unknown</span><a href={SOURCES.gas} target="_blank" rel="noreferrer">Understand Monad gas ↗</a></footer>
  </main>
 </div>;
}
