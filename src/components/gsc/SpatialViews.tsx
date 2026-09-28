"use client";
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { FeatureCollection } from 'geojson';
import type { InvestigationFrame } from '@/lib/gscBrowser/session';
import styles from './explorer.module.css';
import 'maplibre-gl/dist/maplibre-gl.css';

type Props = { frame: InvestigationFrame; onSelect: (id: string | null) => void };
export function MapView({ frame, onSelect }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const callback = useRef(onSelect); callback.current = onSelect;
  const latest = useRef(frame); latest.current = frame;
  const [status, setStatus] = useState('loading');
  useEffect(() => {
    if (!host.current) return;
    const abort = new AbortController();
    let alive = true, instance: maplibregl.Map;
    const update = () => {
      if (!alive || !instance.getLayer('nodes')) return;
      const data = latest.current.map;
      const detached: FeatureCollection = { type: 'FeatureCollection', features: data.features.map((f) => ({
        ...f, properties: { ...f.properties }, geometry: f.geometry.type === 'Point'
          ? { type: 'Point', coordinates: [...f.geometry.coordinates] }
          : { type: 'LineString', coordinates: f.geometry.coordinates.map((p) => [...p]) },
      })) };
      (instance.getSource('records') as maplibregl.GeoJSONSource)?.setData(detached);
      instance.setPaintProperty('nodes', 'circle-color', ['case', ['==', ['get', 'recordId'], latest.current.state.selectedRecordId ?? ''], '#ffd277', '#5ee1d4']);
      instance.setPaintProperty('nodes', 'circle-radius', ['case', ['==', ['get', 'recordId'], latest.current.state.selectedRecordId ?? ''], 8, 4]);
      instance.setPaintProperty('routes', 'line-color', ['case', ['==', ['get', 'recordId'], latest.current.state.selectedRecordId ?? ''], '#ffd277', '#477b9d']);
    };
    try {
      instance = new maplibregl.Map({ container: host.current, center: [-35, 28], zoom: 1.15,
        attributionControl: false, style: { version: 8, sources: {
          records: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
          land: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        }, layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#080e19' } },
          { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': '#18293b', 'fill-outline-color': '#345063' } },
          { id: 'routes', type: 'line', source: 'records', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#477b9d', 'line-width': 1.8 } },
          { id: 'nodes', type: 'circle', source: 'records', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': '#5ee1d4', 'circle-radius': 4, 'circle-stroke-width': 1, 'circle-stroke-color': '#080e19' } },
        ] } });
    } catch (error) { setStatus(`unavailable: ${String(error)}`); return; }
    map.current = instance;
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    const load = async () => {
      update();
      try {
        const response = await fetch('/gsc/world/countries-110m.json', { signal: abort.signal });
        if (!response.ok) throw new Error(`World topology HTTP ${response.status}`);
        const topology = await response.json() as Topology<{ countries: GeometryCollection }>;
        if (!alive) return;
        (instance.getSource('land') as maplibregl.GeoJSONSource).setData(feature(topology, topology.objects.countries));
        setStatus('ready');
      } catch (error) { if (alive) setStatus(`unavailable: ${String(error)}`); }
    };
    const pick = (e: maplibregl.MapMouseEvent) => {
      const hit = instance.queryRenderedFeatures(e.point, { layers: ['nodes', 'routes'] })[0];
      callback.current(typeof hit?.properties?.recordId === 'string' ? hit.properties.recordId : null);
    };
    const error = (e: maplibregl.ErrorEvent) => { if (alive) setStatus(`unavailable: ${e.error.message}`); };
    instance.on('load', load); instance.on('click', pick); instance.on('error', error);
    // Component-local event avoids remounting a WebGL context on every state change.
    const node = host.current; node.addEventListener('gsc:update', update);
    const observer = new ResizeObserver(() => { if (alive) instance.resize(); }); observer.observe(node);
    return () => {
      alive = false; abort.abort(); observer.disconnect(); node.removeEventListener('gsc:update', update);
      instance.off('load', load); instance.off('click', pick); instance.off('error', error);
      instance.remove(); map.current = null;
    };
  }, []);
  useEffect(() => { host.current?.dispatchEvent(new Event('gsc:update')); }, [frame]);
  return <div className={styles.spatial}><div ref={host} className={styles.canvasHost} data-testid="map-view" data-status={status} />
    <div className={styles.mapNote}>MapLibre · WGS84 longitude/latitude · Natural Earth cartographic context</div>
    {status !== 'ready' && <div className={styles.renderStatus} role="status">Map {status}</div>}</div>;
}
export function GlobeView({ frame, onSelect }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const backend = useRef<import('@/lib/gscBrowser/globe').GlobeBackend | null>(null);
  const callback = useRef(onSelect); callback.current = onSelect;
  const latest = useRef(frame); latest.current = frame;
  const [status, setStatus] = useState('loading');
  useEffect(() => {
    let alive = true;
    void import('@/lib/gscBrowser/globe').then(({ GlobeBackend }) => {
      if (!alive || !host.current) return;
      try {
        const instance = new GlobeBackend(host.current, (id) => callback.current(id), (s) => { if (alive) setStatus(s); });
        backend.current = instance;
        instance.update(latest.current.globe, latest.current.state.selectedRecordId, latest.current.state.eventCursor!.value);
      } catch (error) { if (alive) setStatus(`unavailable: ${String(error)}`); }
    }).catch((error) => { if (alive) setStatus(`unavailable: ${String(error)}`); });
    return () => { alive = false; backend.current?.dispose(); backend.current = null; };
  }, []);
  useEffect(() => { backend.current?.update(frame.globe, frame.state.selectedRecordId, frame.state.eventCursor!.value); }, [frame]);
  return <div className={styles.spatial}><div ref={host} className={styles.canvasHost} data-testid="globe-view" data-status={status} />
    <div className={styles.mapNote}>Three.js · GSV unit-sphere display · great-circle display interpolation, not routed distance</div>
    {status !== 'ready' && <div className={styles.renderStatus} role="status">Globe {status}</div>}</div>;
}
