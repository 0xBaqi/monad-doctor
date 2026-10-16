'use client';
import { useRef } from 'react';
import type { HealthEnvelope } from '../lib/health-coordinator-model';
import type { HealthEvidenceRef } from '../lib/health-reconciliation';
import { PROVIDER_LABELS } from '../lib/model';
import { comparisonSummary, evidenceAnchor, observationText, reasonText, relationLabels, subjectLabel } from '../lib/health-comparison-presentation';
import styles from './page.module.css';

export function HealthComparisonView({ report, receivedAt, stale }: { report: HealthEnvelope; receivedAt: string; stale: boolean }) {
 const evidence = useRef<HTMLDetailsElement>(null), summary = comparisonSummary(report);
 function inspect(ref: HealthEvidenceRef) {
  if (evidence.current) evidence.current.open = true;
  document.getElementById(evidenceAnchor(ref))?.focus();
 }
 function reference(ref: HealthEvidenceRef) {
  return <a key={evidenceAnchor(ref)} href={'#'+evidenceAnchor(ref)} onClick={()=>inspect(ref)}>{ref.provider} / {ref.collectionId} / #{ref.evidenceId}</a>;
 }
 const observations = report.reconciliation.snapshots.flatMap(s=>s.collections.flatMap(c=>c.evidence.map(e=>({provider:s.provider,collectionId:c.collectionId,...e}))));
 const times = observations.flatMap(e=>'observedAt' in e.observation ? [e.observation.observedAt] : []);
 return <div className={styles.comparisonReport}>
  {stale&&<p className={styles.note} role="status"><strong>Previous snapshot — inputs have changed.</strong> Export downloads this captured comparison. Run explicitly to collect a new snapshot.</p>}
  <p>{PROVIDER_LABELS.primary} ↔ {PROVIDER_LABELS.secondary}</p>
  <div className={styles.summary} aria-label="Comparison metrics">
   <div><small>RPC DISPATCHED / PLANNED</small><strong>{report.counters.dispatched} / {report.counters.planned}</strong></div>
   <div><small>COLLECTION</small><strong className={styles.time}>{report.status}</strong></div>
   <div><small>RECEIVED AT (YOUR DEVICE)</small><strong className={styles.time}><time dateTime={receivedAt}>{new Date(receivedAt).toLocaleTimeString()}</time></strong></div>
  </div>
  <section className={styles.guided} aria-labelledby="comparison-summary-title">
   <h3 id="comparison-summary-title">What the comparison supports</h3><strong className={styles.diagnosis}>{summary.title}</strong>
   {summary.primary&&<p>{subjectLabel(summary.primary)}: {reasonText(summary.primary)}</p>}
   {report.reconciliation.integrityIssues.length>0&&<div className={styles.comparisonWarning}><strong>Internal provider inconsistencies</strong><ul>{report.reconciliation.integrityIssues.map((issue,i)=><li key={i}>{PROVIDER_LABELS[issue.provider]} · {issue.code}<div className={styles.sourceRow}>{issue.evidence.map(reference)}</div></li>)}</ul></div>}
   <p><strong>What remains unknown:</strong> {summary.uncertainty}</p>
   <div className={styles.nextStep}><strong>Next useful action</strong><p>{summary.next}</p></div>
   <p><strong>Cleanup at publication:</strong> {report.cleanupPending?'Pending — local cleanup was not confirmed.':'Locally acknowledged; this does not prove remote RPC termination.'} This snapshot will not update automatically.</p>
  </section>
  <div aria-label="Field comparisons" className={styles.comparisonRows}>{summary.ordered.map(row=><article key={row.subject.kind} className={styles.comparisonRow}>
   <h3>{subjectLabel(row)}</h3><strong className={row.relation==='contradiction'?styles.comparisonWarning:styles.comparisonRelation}>{relationLabels[row.relation]}</strong><p>{reasonText(row)}</p>
   <div className={styles.providerObservations}>{[row.left,row.right].map(side=><div key={side.provider}><h4>{PROVIDER_LABELS[side.provider]}</h4><p>{observationText(side.observation)}</p>{'observedAt' in side.observation&&<small>Recorded observation: <time dateTime={side.observation.observedAt}>{side.observation.observedAt}</time> · +{side.observation.startedOffsetMs} ms from run origin · {side.observation.durationMs} ms</small>}</div>)}</div>
   <details><summary>Fields and evidence dependencies</summary><p>Compared fields: {row.comparedFields.join(', ')}. Scope: {row.scope}.</p><div className={styles.sourceRow}>{row.dependencies.length?row.dependencies.map(reference):'No supporting evidence reference available.'}</div></details>
  </article>)}</div>
  <details className={styles.snapshot}><summary>Collection ledger and cleanup details</summary><p>Termination: {report.termination}. Completed decisions: {report.counters.completed}. Skipped: {report.counters.skipped}. Cleanup leases pending at publication: {report.counters.inFlight}.</p><p>Completed decisions can still hold cleanup leases. No quota refund or automatic retry occurs.</p><pre>{JSON.stringify(report.ledger,null,2)}</pre></details>
  <details className={styles.snapshot}><summary>Captured inputs and observation times</summary><pre>{JSON.stringify(report.request,null,2)}</pre><p>Coordinator {report.coordinatorVersion} · Reconciliation {report.reconciliation.reconciliationRuleVersion} · Run {report.runId}</p><p>Received by your device: {receivedAt}. Recorded observation timestamps: {times.length?[...new Set(times)].join(' · '):'unavailable'}.</p><p>Wall-clock timestamps are provenance, not scheduling authority or proof of freshness. Providers were sampled sequentially.</p></details>
  <details ref={evidence} className={styles.raw}><summary>Inspect provider-qualified RPC evidence</summary><p>No request is made when opening evidence. Null, skipped and unavailable observations remain distinct. Only narrow validated fields are retained.</p>{observations.map(e=>{
   const ref={runId:report.runId,provider:e.provider,collectionId:e.collectionId,evidenceId:e.evidenceId};
   return <div key={evidenceAnchor(ref)}><h4 id={evidenceAnchor(ref)} tabIndex={-1}>{PROVIDER_LABELS[e.provider]} · {e.collectionId} · #{e.evidenceId}</h4><pre>{JSON.stringify({reference:ref,request:e.request,observation:e.observation},null,2)}</pre></div>;
  })}</details>
 </div>;
}
