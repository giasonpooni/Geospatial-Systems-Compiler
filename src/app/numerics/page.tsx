'use client';

import { useRef, useState } from 'react';
import { inspectLinearMapView, type LinearMapInspection } from '../../lib/notation/linear-map-view';
import { inspectUncertaintyView, type UncertaintyInspection } from '../../lib/notation/linear-uncertainty-view';
import { inspectFsrtView, type FsrtInspection } from '../../lib/notation/fsrt-view';
import { FsrtResult } from './fsrt-result';

/** Local artifact inspection only. Files are never sent to a server or executor. */
export default function NumericsPage() {
  const [file, setFile] = useState<File | null>(null);
  const [expected, setExpected] = useState('');
  const [mean, setMean] = useState<LinearMapInspection | null>(null);
  const [uncertainty, setUncertainty] = useState<UncertaintyInspection | null>(null);
  const [fsrt, setFsrt] = useState<FsrtInspection | null>(null);
  const [message, setMessage] = useState('Select a retained view and its independently recorded SHA-256.');
  const generation = useRef(0);
  function invalidate() { generation.current++; setMean(null); setUncertainty(null); setFsrt(null); }
  async function inspect() {
    invalidate(); const current = generation.current;
    if (!file) { setMessage('Select a retained JSON view.'); return; }
    if (file.size > 262144) { setMessage('File exceeds the 256 KiB limit.'); return; }
    setMessage('Checking the retained bytes.');
    try {
      const envelope: unknown = JSON.parse(await file.text());
      let m: LinearMapInspection | null = null;
      let u: UncertaintyInspection | null = null;
      let f: FsrtInspection | null = null;
      if (envelope && typeof envelope === 'object' && 'schema' in envelope
          && envelope.schema === 'ciw.fsrt-view-envelope.v1') {
        f = await inspectFsrtView(envelope, expected.trim());
      } else if (envelope && typeof envelope === 'object' && 'schema' in envelope
          && envelope.schema === 'notation.linear-uncertainty-view-envelope.v1') {
        u = await inspectUncertaintyView(envelope, expected.trim()); m = u.mean;
      } else { m = await inspectLinearMapView(envelope, expected.trim()); }
      if (generation.current !== current) return;
      setMean(m); setUncertainty(u); setFsrt(f);
      setMessage('Bytes match the selected digest. This is not independent scientific validation or permission to act.');
    } catch (error) {
      if (generation.current === current) setMessage(error instanceof Error ? error.message : 'View refused.');
    }
  }
  return <main className="mx-auto max-w-6xl space-y-6 p-8">
    <header><h1 className="text-3xl font-semibold">Retained numerical results</h1>
      <p className="mt-2">Inspect Python-coordinated native results and FSRT fluid snapshots. No provider is launched.</p></header>
    <section className="space-y-3" aria-label="Artifact selection">
      <label className="block">Retained view JSON
        <input className="block mt-1" type="file" accept=".json,application/json" onChange={e => {
          invalidate(); setFile(e.target.files?.[0] ?? null); setMessage('Selection changed; inspect again.');
        }}/></label>
      <label className="block">Expected SHA-256 from your trusted artifact record
        <input className="block w-full rounded border p-2 font-mono" value={expected}
          placeholder="sha256:…" onChange={e => { invalidate(); setExpected(e.target.value); setMessage('Digest changed; inspect again.'); }}/></label>
      <p>Copying the digest from the same file checks only self-consistency. Files stay in this browser.</p>
      <button className="rounded border px-4 py-2" type="button" onClick={inspect}>Inspect retained result</button>
      <p role="status" aria-live="polite">{message}</p>
    </section>
    {fsrt && <FsrtResult inspection={fsrt} />}
    {mean && <section className="space-y-3" aria-label="Mean result">
      <h2 className="text-xl font-semibold">Quantity response</h2>
      <p>{mean.view.model.owner} · {mean.view.provider} · frame: {mean.view.frame}</p>
      <div className="overflow-x-auto"><table className="w-full text-left">
        <thead><tr>{['Quantity','Unit','Baseline','Change','Value'].map(x => <th className="p-2" key={x}>{x}</th>)}</tr></thead>
        <tbody>{mean.view.outputs.map(q => <tr key={q.id}>{[q.id,q.unit,q.baseline,q.delta,q.value].map((x,i) =>
          <td className="border-t p-2" key={i}>{String(x)}</td>)}</tr>)}</tbody></table></div>
      <details><summary>Execution and result identities</summary><pre className="overflow-auto p-2">{JSON.stringify({
        case: mean.view.case_digest, model: mean.view.model.digest, execution: mean.view.execution_id,
        result: mean.view.result_id, runtime: mean.view.runtime_digest, verification: mean.view.verification_id,
      }, null, 2)}</pre></details>
      {!uncertainty && <p>No propagated covariance accompanies this mean-only view.</p>}
    </section>}
    {uncertainty && <section className="space-y-3" aria-label="Full covariance">
      <h2 className="text-xl font-semibold">Full propagated covariance</h2>
      <p>Fixed supplied Jacobian and declared input covariance only. Off-diagonal entries are retained; entry (i, j) has unit i × unit j.</p>
      <div className="overflow-x-auto"><table className="w-full text-left">
        <thead><tr><th className="p-2">Quantity / unit</th>{uncertainty.covariance.quantityIds.map((id,i) =>
          <th className="p-2" key={id}>{id} / {uncertainty.covariance.units[i]}</th>)}</tr></thead>
        <tbody>{uncertainty.covariance.matrix.map((row,i) => <tr key={i}>
          <th className="border-t p-2">{uncertainty.covariance.quantityIds[i]} / {uncertainty.covariance.units[i]}</th>
          {row.map((x,j) => <td className="border-t p-2 font-mono" key={j}>{String(x)}</td>)}</tr>)}</tbody></table></div>
      <p>No confidence interval, calibration, physical validation or state admission is inferred from this matrix.</p>
      <details><summary>Covariance identities</summary><pre className="overflow-auto p-2">{JSON.stringify({
        covariance: uncertainty.covariance.id, inputCovariance: uncertainty.covariance.inputId,
        calculation: uncertainty.calculationId, verification: uncertainty.verificationId,
        nativeStages: uncertainty.nativeStageCount,
      }, null, 2)}</pre></details>
    </section>}
  </main>;
}
