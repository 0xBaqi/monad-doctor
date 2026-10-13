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
  <section className={styles.guided} aria-labelledby="guided-title">
   <h3 id="guided-title">What the evidence supports</h3>
   <p><strong>Provider:</strong> {PROVIDER_LABELS[report.provider]} · Rules {report.ruleVersion}</p>
   <p>Observation window: <time dateTime={report.startedAt}>{report.startedAt}</time> to <time dateTime={report.completedAt}>{report.completedAt}</time>. Requests are sequential observations.</p>
   <p><strong>Captured mode:</strong> {report.mode}{report.input.hash && <> · Hash: <code>{report.input.hash}</code></>}{report.input.gasLimit && <> · Proposed limit: {report.input.gasLimit} gas</>}</p>
   <details><summary>Captured inputs (calldata redacted)</summary><pre>{JSON.stringify(shared.input, null, 2)}</pre></details>
   {summary.primary ? <div><strong>{summary.primary.title}</strong><p>{summary.primary.detail}</p><span>{basis(summary.primary)}</span><div className={styles.sourceRow}>{refs(summary.primary)}</div></div> : <p>No findings were returned. No outcome can be established.</p>}
   {summary.outcomes.map(({ label, finding }) => <div className={styles.outcome} key={label}><h4>{label}</h4>{finding ? <><p>{finding.title} · {basis(finding)}</p><div className={styles.sourceRow}>{refs(finding)}</div></> : <p>Unknown — no finding establishes this outcome.</p>}</div>)}
   <h4>What remains unknown</h4><p>{summary.limitations}</p>
   {summary.unknown.map(f => <p key={f.id}>{f.title} · {basis(f)}</p>)}
   <div className={styles.nextStep}><strong>Recommended next action</strong><p>{summary.primary?.nextStep ?? 'Inspect the evidence and rerun explicitly if necessary; no outcome is established.'}</p></div>
  </section>
  <p>{report.evidence.length} RPC observations · {report.findings.filter(f => ['error', 'warning'].includes(f.severity)).length} findings need attention. Passing checks do not resolve separate unknown or contradictory outcomes.</p>
  <div className={styles.findings}>{summary.ordered.map(f => <article key={f.id} className={styles.finding}>
   <div className={styles.findingTop}><span className={styles[f.severity === 'error' ? 'errorBadge' : f.severity]}>{f.severity}</span><span className={styles.basis}>{basis(f)}</span><code>{f.id}</code></div>
   <h3>{f.title}</h3><p>{f.detail}</p><div className={styles.nextStep}><strong>Next step</strong><p>{f.nextStep}</p></div>
   <details className={styles.explanation}><summary>Understand and verify this finding</summary><dl>{Object.entries(guidance(f.id)).map(([key, text]) => <div key={key}><dt>{{ checked: 'What was checked', unknown: 'What remains unknown', why: 'Why it matters', verify: 'How to verify' }[key as keyof ReturnType<typeof guidance>]}</dt><dd>{text}</dd></div>)}</dl></details>
   <div className={styles.sourceRow}>{f.sources.map((source, i) => <a key={source} href={source} target="_blank" rel="noreferrer">Monad docs {i + 1} ↗</a>)}{refs(f)}</div>
  </article>)}</div>
  <details ref={raw} className={styles.raw}><summary>Inspect RPC evidence (calldata redacted) <span>{report.evidence.length} observations</span></summary>
   <p>Original observation IDs, methods, provider attribution and timestamps are retained. Calldata is hidden here and in exports; public addresses and hashes remain. No request is made when opening evidence.</p>
   {shared.evidence.map(e => <div key={e.id}><h4 id={'evidence-' + e.id} tabIndex={-1}>#{e.id} · {e.method} · {PROVIDER_LABELS[report.provider]} <small>{e.durationMs} ms</small></h4><pre>{JSON.stringify(e, null, 2)}</pre></div>)}
  </details>
 </>;
}
