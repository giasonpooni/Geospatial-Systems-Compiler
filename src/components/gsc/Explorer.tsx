"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { GsvInvestigation } from '@/lib/gscBrowser/session';
import type { InvestigationFrame } from '@/lib/gscBrowser/session';
import type { ViewKind } from '@/lib/gsc/projections';
import styles from './explorer.module.css';

const MapView = dynamic(() => import('./SpatialViews').then((m) => m.MapView), { ssr: false });
const GlobeView = dynamic(() => import('./SpatialViews').then((m) => m.GlobeView), { ssr: false });
const views: readonly [ViewKind, string][] = [['geojson', 'Map'], ['unit-sphere', 'Globe'], ['table', 'Records'], ['timeline', 'Timeline'], ['relations', 'Relations']];
const hour = 3_600_000;
const label = (s: string) => s.replace('T', ' ').replace('.000Z', ' UTC').replace('Z', ' UTC');

export default function Explorer() {
  const session = useRef<GsvInvestigation | null>(null);
  const [frame, setFrame] = useState<InvestigationFrame | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [playing, setPlaying] = useState(false);
  const [limit, setLimit] = useState(100);
  useEffect(() => {
    let alive = true;
    void GsvInvestigation.load().then((loaded) => {
      if (alive) { session.current = loaded; setFrame(loaded.frame()); }
    }).catch((e) => { if (alive) setError(String(e)); });
    return () => { alive = false; session.current = null; };
  }, []);
  const command = useCallback((type: string, value: unknown) => {
    const active = session.current;
    if (!active) return;
    const next = active.dispatch({ type, value });
    if (!next.ok) { setError(next.diagnostics.map((d) => d.message).join('; ')); return; }
    setError(''); setFrame(active.frame());
  }, []);
  const select = useCallback((id: string | null) => command('select', id), [command]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      const active = session.current;
      if (!active) return;
      const at = Date.parse(active.frame().state.eventCursor!.value);
      const end = Date.parse(active.snapshot.timeRange.end);
      if (at >= end) { setPlaying(false); return; }
      command('eventCursor', new Date(Math.min(at + hour, end)).toISOString());
    }, 1000);
    return () => clearInterval(timer);
  }, [playing, command]);
  const active = session.current;
  const start = active ? Date.parse(active.snapshot.timeRange.start) : 0;
  const end = active ? Date.parse(active.snapshot.timeRange.end) : 1;
  const rows = frame?.temporal.ir.records.filter((r) => `${r.label} ${r.kind} ${r.source.recordId}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  const selected = frame?.selected;
  const shown = new Map(frame?.temporal.ir.records.map((r) => [r.id, r.label]));
  const visibleGeometry = frame?.map.features.length ?? 0;
  return <main className={styles.shell}>
    <header className={styles.header}>
      <Link href="/" className={styles.brand}>N<span>NOTATION SYSTEMS</span></Link>
      <nav><Link href="/terminal">Physical-economy terminal</Link><Link href="/operations">Freight operations</Link></nav>
    </header>
    <section className={styles.heading}>
      <div><p className={styles.eyebrow}>STATE · VARIATION · INVARIANCE</p><h1>Geospatial Systems Compiler</h1>
      <p className={styles.subtitle}>One investigation. Multiple representations. Trace every displayed record to its source.</p></div>
      <div className={styles.badge}>SYNTHETIC / DEMO DATA<span>No live telemetry or scientific validation</span></div>
    </section>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!frame ? <p role="status">{error ? 'Investigation unavailable. No data substituted.' : 'Validating the pinned synthetic provider…'}</p> : <>
      <section className={styles.controls} aria-label="Investigation controls">
        <div className={styles.tabs} role="tablist" aria-label="Representation">
          {views.map(([id, name]) => <button key={id} role="tab" aria-selected={frame.state.view === id}
            onClick={() => command('view', id)}>{name}</button>)}
        </div>
        <div className={styles.clockRow}>
          <label>Event cursor <output data-testid="event-time">{label(frame.state.eventCursor!.value)}</output>
            <input aria-label="Event cursor" type="range" min={start} max={end} step={hour}
              value={Date.parse(frame.state.eventCursor!.value)} onChange={(e) => { setPlaying(false); command('eventCursor', new Date(Number(e.target.value)).toISOString()); }} /></label>
          <label>Known by <output data-testid="knowledge-time">{label(frame.state.knowledgeCutoff!.value)}</output>
            <input aria-label="Knowledge cutoff" type="range" min={start} max={end} step={hour}
              value={Date.parse(frame.state.knowledgeCutoff!.value)} onChange={(e) => command('knowledgeCutoff', new Date(Number(e.target.value)).toISOString())} /></label>
          <button onClick={() => setPlaying(!playing)} aria-pressed={playing}>{playing ? 'Pause' : 'Play synthetic timeline'}</button>
        </div>
        <p className={styles.caption}>Observation history is [dataset start, event cursor). Applicability is checked at the cursor; knowledge cutoff is independent. No interpolation of evidence.</p>
      </section>
      <div className={styles.stats}><span><strong>{visibleGeometry}</strong> geographic records</span>
        <span><strong data-testid="eligible-count">{frame.temporal.ir.records.length}</strong> eligible records</span>
        <span><strong data-testid="excluded-count">{frame.temporal.excluded.length}</strong> withheld by time</span>
        <span><strong>{frame.temporal.contextOnly.length}</strong> structure-only records</span></div>
      <section className={styles.workspace} data-testid="workspace" data-view={frame.state.view}>
        <div className={styles.viewport}>
          {frame.state.view === 'geojson' && <MapView frame={frame} onSelect={select} />}
          {frame.state.view === 'unit-sphere' && <GlobeView frame={frame} onSelect={select} />}
          {['table', 'timeline', 'relations'].includes(frame.state.view) && <div className={styles.tableWrap}>
            <table><thead><tr><th>Record</th>{frame.state.view === 'timeline' ? <><th>Event / measurement period</th><th>Known by</th></> : frame.state.view === 'relations' ? <><th>Relation</th><th>Target</th></> : <><th>Role / origin</th><th>Declared quantity</th></>}</tr></thead><tbody>
            {frame.state.view === 'relations' ? rows.slice(0, limit).flatMap((r) => r.links.map((edge, i) => <tr key={`${r.id}:${i}`}>
              <td><button onClick={() => select(r.id)}>{r.label}</button></td><td>{edge.predicate}</td><td><button onClick={() => select(edge.targetId)}>{shown.get(edge.targetId)}</button></td></tr>))
              : rows.slice(0, limit).map((r) => <tr key={r.id} data-selected={frame.state.selectedRecordId === r.id}>
                <td><button onClick={() => select(r.id)}>{r.label}</button></td>
                {frame.state.view === 'timeline' ? <><td>{r.eventTime?.value ?? (r.period ? `${r.period.from?.value ?? '?'} → ${r.period.to?.value ?? '?'} (${r.period.end})` : 'Not supplied')}</td><td>{r.knownAt?.value ?? 'Not supplied'}</td></>
                  : <><td>{r.role} / {r.valueKind}</td><td>{r.quantity ? `${r.quantity.value} ${r.quantity.unit ?? '[unit missing]'}` : 'Not supplied'}</td></>}
              </tr>)}</tbody></table>
            {rows.length > limit && <button onClick={() => setLimit(limit + 100)}>Show more records</button>}
            {!rows.length && <p>No records eligible for these clocks and search. Nothing has been filled in.</p>}
          </div>}
        </div>
        <aside className={styles.inspector} aria-label="Evidence inspector">
          <label className={styles.search}>Find in eligible records<input type="search" aria-label="Find eligible records" value={search} onChange={(e) => { setSearch(e.target.value); setLimit(100); }} placeholder="Facility, route or source ID" /></label>
          <div className={styles.results}>{rows.slice(0, 16).map((r) => <button key={r.id} onClick={() => select(r.id)} aria-pressed={frame.state.selectedRecordId === r.id}><span>{r.label}</span><small>{r.kind} · {r.valueKind}</small></button>)}</div>
          <div className={styles.selection} data-testid="selection" data-record={frame.state.selectedRecordId ?? ''}>
            {frame.selectedUnavailable ? <p role="status">Selected record is not eligible at these clocks. Its identity is retained; its values are withheld.</p>
              : selected ? <><p className={styles.eyebrow}>SOURCE-BOUND INSPECTION</p><h2>{selected.label}</h2>
              <dl><dt>Source identity</dt><dd>{selected.source.recordId}</dd><dt>Role / origin</dt><dd>{selected.role} / {selected.valueKind}</dd>
                <dt>Known at</dt><dd>{selected.knownAt?.value ?? 'Not supplied'} ({selected.knownAtBasis})</dd>
                <dt>Geometry basis</dt><dd>{selected.geometry?.basis ?? 'Not supplied'}</dd>
                <dt>Applicability</dt><dd>{frame.temporal.contextOnly.includes(selected.id) ? 'Not supplied — structural context only' : 'Eligible at selected time'}</dd>
                <dt>Uncertainty</dt><dd>{selected.uncertaintyRefs.length ? selected.uncertaintyRefs.join(', ') : 'Not supplied; not zero'}</dd></dl>
              <h3>Provider state at event cursor</h3>
              {frame.dynamic.status === 'available' ? <div data-testid="dynamic-state"><p>Synthetic model output · not a measurement</p>
                <dl><dt>Utilization</dt><dd>{frame.dynamic.value.utilization.toFixed(5)} (fraction)</dd><dt>Congestion</dt><dd>{frame.dynamic.value.congestion.toFixed(5)} (fraction)</dd><dt>Status</dt><dd>{frame.dynamic.value.status}</dd><dt>Input events</dt><dd>{frame.dynamic.inputEventIds.join(', ') || 'None active'}</dd></dl></div>
                : <p data-testid="dynamic-unavailable">{frame.dynamic.reason}</p>}
              <h3>Provenance</h3>{selected.provenance.map((p, i) => <dl key={i}><dt>Source</dt><dd>{p.sourceId}</dd><dt>Evidence references</dt><dd>{p.evidenceIds.join(', ') || 'None supplied'}</dd></dl>)}
              <p className={styles.caption}>Raw nested source detail is omitted in temporal views to prevent future-history leakage.</p>
              </> : <p>Select a map feature or record to inspect its origin, time and modelled state.</p>}
          </div>
        </aside>
      </section>
      <footer className={styles.footer}><div><strong>Representation, not authority.</strong> Viewing does not admit evidence, execute a workload or establish scientific validity.</div>
        <div>Dataset: {frame.state.bindings.datasetId} · Snapshot / release / run: not supplied.<br />ESM and workbench connections: not configured in this public demonstration.</div></footer>
    </>}
  </main>;
}
