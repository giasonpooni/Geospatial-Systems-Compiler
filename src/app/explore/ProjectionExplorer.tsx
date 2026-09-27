'use client';

import { useEffect, useRef, useState } from 'react';
import RecordComparisonPanel from './RecordComparisonPanel';
import { projectionDiagnostics } from '@/lib/explorer/recordComparison';
import { BRIDGE_SCHEMA, bridgeMessage, drawablePositions, type PublicProjection } from '@/lib/explorer/esmProjection';

export default function ProjectionExplorer({ projection, viewerUrl }: { projection: PublicProjection; viewerUrl: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [channel, setChannel] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const [viewerStatus, setViewerStatus] = useState('Connecting to the geographic viewer');
  const origin = new URL(viewerUrl).origin;
  useEffect(() => { selectedRef.current = null; setSelected(null); }, [projection.digest]);
  useEffect(() => { setChannel(crypto.randomUUID().replaceAll('-', '')); }, []);
  function send(type: string, payload: Record<string, unknown>) {
    if (channel) frame.current?.contentWindow?.postMessage({ schema: BRIDGE_SCHEMA, channel, type, ...payload }, origin);
  }
  function load() { send('load', { projection, spec: projection.spec, digest: projection.digest }); }
  useEffect(() => {
    if (!channel) return;
    let completed = false;
    const timer = setTimeout(() => { if (!completed) setViewerStatus('Viewer unavailable or still loading. The exact records remain readable below.'); }, 15000);
    const receive = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== frame.current?.contentWindow) return;
      const message = event.data;
      if (bridgeMessage(message, channel, 'ready')) {
        frame.current?.contentWindow?.postMessage({ schema: BRIDGE_SCHEMA, channel, type: 'load',
          projection, spec: projection.spec, digest: projection.digest }, origin);
      } else if (bridgeMessage(message, channel, 'loaded') && message.digest === projection.digest) {
        completed = true; clearTimeout(timer); setViewerStatus('Connected · exact projection acknowledged');
        frame.current?.contentWindow?.postMessage({ schema: BRIDGE_SCHEMA, channel, type: 'select',
          digest: projection.digest, recordId: selectedRef.current }, origin);
      } else if (bridgeMessage(message, channel, 'selected') && message.digest === projection.digest &&
        (message.recordId === null || (typeof message.recordId === 'string' && projection.records.some(r => r.recordId === message.recordId)))) {
        const id = message.recordId as string | null; selectedRef.current = id; setSelected(id);
      } else if (bridgeMessage(message, channel, 'refused')) {
        completed = true; clearTimeout(timer);
        setViewerStatus('Viewer refused the projection. The table remains available; no replacement or inferred geometry was accepted.');
      }
    };
    window.addEventListener('message', receive);
    return () => { clearTimeout(timer); window.removeEventListener('message', receive); };
  }, [channel, origin, projection]);
  const choose = (id: string | null) => {
    selectedRef.current = id; setSelected(id); send('select', { digest: projection.digest, recordId: id });
  };
  const frameUrl = channel ? `${viewerUrl}#${new URLSearchParams({ parentOrigin: location.origin, channel })}` : null;
  const record = projection.records.find(r => r.recordId === selected);
  const positions = projection.geometry.positions.filter(p => p.recordId === selected);
  const buttonStyle = { background: 'transparent', color: '#a9e0f5', border: 0, padding: '8px 0', cursor: 'pointer', textAlign: 'left' as const };
  const diagnostics = projectionDiagnostics(projection);
  return <>
    <details aria-label="Projection identity" style={{ padding: 18, border: '1px solid #34455a', borderRadius: 12, overflowWrap: 'anywhere' }}>
      <summary><strong>Fixture-only demonstration · exact source and time bindings</strong></summary>
      <p>Release: <code>{projection.spec.source.releaseId}</code></p>
      <p>Known at: <time>{projection.spec.selection.knownAt}</time><br />Valid at: <time>{projection.spec.selection.validAt}</time></p>
      <p style={{ fontSize: 12 }}>Projection: <code>{projection.digest}</code><br />Source snapshot: <code>{projection.spec.source.snapshotDigest}</code></p>
      <p>These are fixed time selections, not a live clock. A different time requires a new ESM projection. Viewing does not execute a model, verify a scientific claim, or admit state.</p>
    </details>
    <p role="status" aria-live="polite">{viewerStatus}</p>
    {frameUrl && <iframe ref={frame} title="GSV — read-only geographic record inspection" src={frameUrl} onLoad={load}
      sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer"
      style={{ width: '100%', height: 560, border: '1px solid #34455a', borderRadius: 12, background: '#020409' }} />}
    <p>{projection.records.length} selected records · {drawablePositions(projection).length} declared point markers · {projection.geometry.unplaced.length} records without geometry.</p>
    <p>Polygons and extents are retained in the inspector, not turned into facility points. Several source positions for one record remain distinct.</p>
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 660 }}>
        <caption style={{ textAlign: 'left', padding: '16px 0', fontWeight: 600 }}>Exact records — select one to synchronize the globe and evidence inspector</caption>
        <thead><tr>{['Record', 'Subject', 'Value', 'Unit', 'Geometry', 'Status'].map(h => <th key={h} scope="col" style={{ padding: 10, borderBottom: '1px solid #34455a', textAlign: 'left' }}>{h}</th>)}</tr></thead>
        <tbody>{projection.records.map(r => {
          const shapes = projection.geometry.positions.filter(p => p.recordId === r.recordId);
          const geometry = shapes.length ? [...new Set(shapes.map(p => p.shape.kind))].join(', ') : 'Unavailable';
          return <tr key={r.recordId} style={{ background: selected === r.recordId ? '#18394c' : 'transparent' }}>
            <td style={{ padding: 10, borderBottom: '1px solid #243348' }}><button style={buttonStyle} aria-pressed={selected === r.recordId} onClick={() => choose(r.recordId)}>{r.title}<br /><code>{r.recordId}</code></button></td>
            <td style={{ padding: 10 }}>{r.subject.subjectId}</td><td style={{ padding: 10 }}>{r.value}</td>
            <td style={{ padding: 10 }}>{r.unit ?? 'Not stated'}</td><td style={{ padding: 10 }}>{geometry}</td><td style={{ padding: 10 }}>{r.statusAtKnownAt}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <section aria-label="Projection diagnostics" style={{ marginTop: 24 }}>
      <h2 style={{ fontSize: 22 }}>State — what is supplied, and what is missing</h2>
      <p>Descriptive counts, not a quality score or a scientific validation.</p>
      <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 16 }}>{Object.entries(diagnostics).map(([key,value]) => <div key={key} style={{ background: '#101c2a', padding: 14, borderRadius: 8 }}><dt>{key.replace(/([A-Z])/g, ' $1')}</dt><dd style={{ fontSize: 28, margin: 0 }}>{value}</dd></div>)}</dl>
    </section>
    <RecordComparisonPanel key={projection.digest} projection={projection} />
    <section aria-label="Evidence inspector" style={{ marginTop: 24 }}>
      <h2 style={{ fontSize: 22 }}>Evidence inspector</h2>
      {record ? <><button style={buttonStyle} onClick={() => choose(null)}>Clear selection</button>
        <p><code>{record.canonicalId}</code> · source <code>{record.provenance.sourceId}</code> · {record.evidenceClass}</p>
        <p>The following is the retained record and its supporting position declarations. Units, uncertainty, provenance, rights and original geometry are not rewritten.</p>
        <pre style={{ maxHeight: 540, overflow: 'auto', padding: 18, background: '#101c2a', borderRadius: 12, fontSize: 12 }}>{JSON.stringify({ record, positions }, null, 2)}</pre></> : <p>Select a record in the table or a point on the globe.</p>}
    </section>
  </>;
}
