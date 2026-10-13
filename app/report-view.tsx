'use client';
import { useRef } from 'react';
import type { Finding, Report } from '../lib/model';
import { PROVIDER_LABELS } from '../lib/model';
import { exportReport } from '../lib/export';
import { guidance } from '../lib/guidance';
import { evidenceReferences, guidedSummary, isContradiction } from '../lib/presentation';
import styles from './page.module.css';

export function ReportView({ report, stale }: { report: Report; stale: boolean }) {
 const raw = useRef<HTMLDetailsElement>(null);
 const shared = exportReport(report);
 const summary = guidedSummary(report);
 function inspect(id: number) {
  if (raw.current) raw.current.open = true;
  document.getElementById('evidence-' + id)?.focus();
 }
 function refs(f: Finding) {
  const ids = evidenceReferences(report, f);
  return ids.length ? ids.map(id => <a key={id} href={'#evidence-' + id} onClick={() => inspect(id)}>Evidence #{id}</a>) : <span>{f.evidence.length ? 'Referenced evidence unavailable' : 'Input + documented rule'}</span>;
 }
 function basis(f: Finding) { return isContradiction(f) ? 'Contradictory · unknown' : f.basis; }
 return <>
  {stale && <p className={styles.note} role="status"><strong>Previous snapshot — inputs have changed.</strong> This report uses the captured inputs below. Run again to check the current form. Export downloads this previous snapshot.</p>}
  <div className={styles.summary} aria-label="Report metrics">
   <div><small>RPC REQUESTS</small><strong>{report.evidence.length.toString().padStart(2, '0')}</strong></div>
   <div><small>NEEDS ATTENTION</small><strong>{report.findings.filter(f => ['error', 'warning'].includes(f.severity)).length.toString().padStart(2, '0')}</strong></div>
   <div><small>CAPTURED AT</small><strong className={styles.time}><time dateTime={report.startedAt}>{new Date(report.startedAt).toLocaleTimeString()}</time></strong><small>{PROVIDER_LABELS[report.provider]}</small></div>
  </div>
  <section className={styles.guided} aria-labelledby="guided-title">
   <h3 id="guided-title">What the evidence supports</h3>
   {summary.primary ? <>
    <div className={styles.findingTop}><span className={styles[summary.primary.severity === 'error' ? 'errorBadge' : summary.primary.severity]}>{summary.primary.severity}</span><span className={styles.basis}>{basis(summary.primary)}</span></div>
    <strong className={styles.diagnosis}>{summary.primary.title}</strong><p>{summary.primary.detail}</p>
   </> : <p>No findings were returned. No outcome can be established.</p>}
   <div className={styles.uncertainty}><strong>What remains unknown</strong><p>{summary.limitations}</p>
    {summary.unknown.length > 0 && <ul>{summary.unknown.filter(f => f !== summary.primary).map(f => <li key={f.id}>{f.title} · {basis(f)}</li>)}</ul>}
   </div>
   <div className={styles.nextStep}><strong>Recommended next action</strong><p>{summary.primary?.nextStep ?? 'Inspect the evidence and rerun explicitly if necessary; no outcome is established.'}</p></div>
   {summary.primary && <div className={styles.sourceRow}>{refs(summary.primary)}</div>}
   {report.input.gasLimit && <p className={styles.capturedLimit}>Proposed limit: {report.input.gasLimit} gas</p>}
   <div className={styles.outcomes}>{summary.outcomes.map(({ label, finding }) => <div className={styles.outcome} key={label}><h4>{label}</h4>{finding ? <><p>{finding.title} · {basis(finding)}</p><details className={styles.outcomeEvidence}><summary>Evidence references</summary><div className={styles.sourceRow}>{refs(finding)}</div></details></> : <p>Unknown — no finding establishes this outcome.</p>}</div>)}</div>
  </section>
  <details className={styles.snapshot}><summary>Captured inputs and observation window</summary>
   <p>Provider: {PROVIDER_LABELS[report.provider]} · Rules {report.ruleVersion} · Captured mode: {report.mode}</p>
   <p>Observation window: <time dateTime={report.startedAt}>{report.startedAt}</time> to <time dateTime={report.completedAt}>{report.completedAt}</time>. Requests are sequential observations.</p>
   <pre>{JSON.stringify(shared.input, null, 2)}</pre>
  </details>
  <h3 className={styles.findingsTitle}>All findings <span>({summary.ordered.length})</span></h3>
  <p className={styles.findingsNote}>Passing checks do not resolve separate unknown or contradictory outcomes. Expand any finding for its original detail and verification steps.</p>
  <div className={styles.findings}>{summary.ordered.map(f => <article key={f.id} className={styles.finding}>
   <details className={styles.findingDetails}>
    <summary><div className={styles.findingTop}><span className={styles[f.severity === 'error' ? 'errorBadge' : f.severity]}>{f.severity}</span><span className={styles.basis}>{basis(f)}</span><code>{f.id}</code></div><h3>{f.title}</h3></summary>
    <div className={styles.findingBody}><p>{f.detail}</p><div className={styles.nextStep}><strong>Next step</strong><p>{f.nextStep}</p></div>
     <details className={styles.explanation}><summary>Understand and verify this finding</summary><dl>{Object.entries(guidance(f.id)).map(([key, text]) => <div key={key}><dt>{{ checked: 'What was checked', unknown: 'What remains unknown', why: 'Why it matters', verify: 'How to verify' }[key as keyof ReturnType<typeof guidance>]}</dt><dd>{text}</dd></div>)}</dl></details>
     <div className={styles.sourceRow}>{f.sources.map((source, i) => <a key={source} href={source} target="_blank" rel="noreferrer">Monad docs {i + 1} ↗</a>)}{refs(f)}</div>
    </div>
   </details>
  </article>)}</div>
  <details ref={raw} className={styles.raw}><summary>Inspect RPC evidence (calldata redacted) <span>{report.evidence.length} observations</span></summary>
   <p>Original observation IDs, methods, provider attribution and timestamps are retained. Calldata is hidden here and in exports; public addresses and hashes remain. No request is made when opening evidence.</p>
   {shared.evidence.map(e => <div key={e.id}><h4 id={'evidence-' + e.id} tabIndex={-1}>#{e.id} · {e.method} · {PROVIDER_LABELS[report.provider]} <small>{e.durationMs} ms</small></h4><pre>{JSON.stringify(e, null, 2)}</pre></div>)}
  </details>
 </>;
}
