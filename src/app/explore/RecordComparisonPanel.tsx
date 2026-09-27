'use client';
import { useState } from 'react';
import type { PublicProjection } from '@/lib/explorer/esmProjection';
import { compareRecords } from '@/lib/explorer/recordComparison';

export default function RecordComparisonPanel({ projection }: { projection: PublicProjection }) {
  const [baseline, setBaseline] = useState(''), [candidate, setCandidate] = useState('');
  const result = baseline && candidate ? compareRecords(projection, baseline, candidate) : null;
  const a = projection.records.find(r => r.recordId === baseline), b = projection.records.find(r => r.recordId === candidate);
  // Normalize before scaling, avoiding overflow for very large finite values.
  const magnitude = Math.max(Math.abs(Number(a?.value) || 0), Math.abs(Number(b?.value) || 0), Number.MIN_VALUE);
  const x = (value: unknown) => 350 + (Number(value) / magnitude) * 260;
  const selectStyle = { background: '#101c2a', color: '#e4edf5', padding: 10, border: '1px solid #52647a', borderRadius: 6, maxWidth: '100%' };
  return <section aria-label="Recorded-value comparison" style={{ marginTop: 32, borderTop: '1px solid #34455a', paddingTop: 24 }}>
    <h2 style={{ fontSize: 24 }}>Variation — compare two declared values</h2>
    <p>Same subject, predicate, unit, basis and projection time. This is a descriptive difference, not a causal estimate, model run or significance test.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, margin: '16px 0' }}>
      <label>Baseline record<br /><select aria-label="Baseline record" style={selectStyle} value={baseline} onChange={e => setBaseline(e.target.value)}><option value="">Choose a baseline</option>{projection.records.map(r => <option key={r.recordId} value={r.recordId}>{r.title} — {r.recordId}</option>)}</select></label>
      <label>Candidate record<br /><select aria-label="Candidate record" style={selectStyle} value={candidate} onChange={e => setCandidate(e.target.value)}><option value="">Choose a candidate</option>{projection.records.map(r => <option key={r.recordId} value={r.recordId}>{r.title} — {r.recordId}</option>)}</select></label>
    </div>
    {!result ? <p>Choose both records to inspect compatibility and difference.</p> : result.status === 'REFUSED' ?
      <p role="status">Comparison unavailable: <code>{result.reason}</code>. Original records remain readable.</p> : <>
        <figure style={{ margin: '20px 0', padding: 16, background: '#101c2a', borderRadius: 12 }}>
          <svg role="img" aria-label={`Recorded values in ${result.unit}: baseline ${a!.value}, candidate ${b!.value}. Difference ${result.difference}.`} viewBox="0 0 700 190" style={{ display: 'block', width: '100%' }}>
            <line x1="90" x2="610" y1="125" y2="125" stroke="#7a91a8" />
            <line x1="350" x2="350" y1="30" y2="140" stroke="#7a91a8" strokeDasharray="4 5" />
            <text x="350" y="160" textAnchor="middle" fill="#acbed0" fontSize="14">0 · {result.unit}</text>
            <circle cx={x(a!.value)} cy="55" r="7" fill="#80cce5" /><text x="12" y="30" fill="#e4edf5" fontSize="14">Baseline: {a!.value}</text>
            <circle cx={x(b!.value)} cy="100" r="7" fill="#ffcf76" /><text x="12" y="85" fill="#e4edf5" fontSize="14">Candidate: {b!.value}</text>
          </svg>
          <figcaption>Shared linear scale, symmetric about zero. Marker size is a display choice, not uncertainty.</figcaption>
        </figure>
        <p><strong>Difference: {result.difference} {result.unit}</strong> · relative difference: {result.relativeDifference === null ? `Unavailable (${result.relativeUnavailable})` : `${result.relativeDifference} × baseline magnitude`}</p>
        <p>Uncertainty of the difference is unavailable: joint uncertainty and dependence were not supplied. Declared input uncertainties are retained separately.</p>
        <details><summary>Comparison inputs, evidence and method</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12 }}>{JSON.stringify(result, null, 2)}</pre></details>
      </>}
  </section>;
}
