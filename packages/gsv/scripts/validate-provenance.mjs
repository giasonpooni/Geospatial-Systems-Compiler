#!/usr/bin/env node
/**
 * Provenance check — every record in the synthetic snapshot must carry
 * provenance.source in the SAME field a real record will carry
 * 'external:ais' / 'payload:spatial'. "Is this real?" must stay a
 * query, not a memory. Fails the build if any record lacks a source.
 *
 * Runs the actual dataset via Node type-stripping (src/data is pure,
 * erasable TypeScript by construction — the seam check guarantees it).
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const mod = await import(
  pathToFileURL(resolve(ROOT, 'src/data/synthetic/world.ts')).href
);
const snapshot = mod.buildWorldSnapshot();

const missing = [];
const check = (arr, label) => {
  for (const rec of arr ?? []) {
    if (!rec?.provenance?.source) missing.push(`${label}:${rec?.id ?? '?'}`);
  }
};
check(snapshot.nodes, 'node');
check(snapshot.routes, 'route');
check(snapshot.flows, 'flow');
check(snapshot.commodities, 'commodity');
check(snapshot.events, 'event');
check(snapshot.constraints, 'constraint');
check(snapshot.assertions, 'assertion');
check(snapshot.observations, 'observation');

if (missing.length) {
  console.error('PROVENANCE CHECK FAILED — records without provenance.source:\n');
  for (const m of missing) console.error('  ✗ ' + m);
  process.exit(1);
}

const n =
  snapshot.nodes.length +
  snapshot.routes.length +
  snapshot.flows.length +
  snapshot.commodities.length +
  snapshot.events.length +
  snapshot.constraints.length +
  (snapshot.assertions?.length ?? 0) +
  (snapshot.observations?.length ?? 0);
console.log(`provenance check ok — ${n} records, all carry provenance.source`);
