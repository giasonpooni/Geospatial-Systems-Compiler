/** Local-only discovery/replay tool. No network without the explicit discover verb. */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { collectLandsatSnapshot, CatalogError } from '../src/lib/remoteSensing/landsatCatalog';
import { digest, inspectSceneSnapshot, makeSnapshotReceipt, MAX_SNAPSHOT_BYTES, parseSceneQuery, SceneError,
  type SceneQuery, type SnapshotReceipt } from '../src/lib/remoteSensing/stacScenes';

function readBounded(path: string, max: number): Uint8Array {
  if (statSync(path).size > max) throw new Error('LOCAL_INPUT_TOO_LARGE');
  return readFileSync(path);
}
function readJson(path: string, max = 64 * 1024): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readBounded(path, max)));
}
const json = (x: unknown) => JSON.stringify(x, null, 2) + '\n';
/** Create-only directory. A manifest is written last; partial output is never COMPLETE. */
export function retainSceneRun(output: string, bytes: Uint8Array, receipt: SnapshotReceipt, q: SceneQuery) {
  mkdirSync(output); // No recursive creation and no overwriting an earlier run.
  const executionRef = `run:${randomUUID()}`;
  const files: [string, string | Uint8Array][] = [
    ['snapshot.json', bytes], ['receipt.json', json(receipt)], ['query.json', json(q)],
  ];
  // Capture exact source bytes BEFORE normalization, including a malformed response.
  for (const [name, content] of files) writeFileSync(join(output, name), content, { flag: 'wx' });
  const manifest = (status: 'COMPLETE' | 'REFUSED', representationId: string | null) => {
    writeFileSync(join(output, 'manifest.json'), json({ schemaVersion: 'rs.scene.run.v1', status,
      operationRef: 'gsc.rs-scene-inspect.v1', executionRef, representationId,
      evidenceId: receipt.evidenceId, verificationRef: null,
      implementationRef: process.env.GSC_IMPLEMENTATION_REF ?? null,
      files: files.map(([path, content]) => ({ path, sha256: digest(content) })),
      admission: 'NOT_PERFORMED', release: 'NOT_PERFORMED', physicalVerification: 'NOT_PERFORMED' }), { flag: 'wx' });
  };
  let result: ReturnType<typeof inspectSceneSnapshot>;
  try { result = inspectSceneSnapshot(bytes, receipt, q, executionRef); }
  catch (error) {
    const refusal = json({ status: 'REFUSED', code: error instanceof SceneError ? error.code : 'LOCAL_RUN_FAILED' });
    writeFileSync(join(output, 'refusal.json'), refusal, { flag: 'wx' }); files.push(['refusal.json', refusal]);
    manifest('REFUSED', null); throw error;
  }
  for (const [name, content] of [['inspection.json', json(result)], ['scene-envelopes.geojson', json(result.geojson)]]) {
    writeFileSync(join(output, name), content, { flag: 'wx' }); files.push([name, content]);
  }
  manifest('COMPLETE', result.representationId);
  return result;
}
export async function sceneCli(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === '--help') {
    console.log('Usage: npx tsx scripts/rs-scenes.ts demo NEW_DIR | discover QUERY_JSON NEW_DIR | replay RUN_DIR NEW_DIR'); return;
  }
  let bytes: Uint8Array, receipt: SnapshotReceipt, query: SceneQuery;
  let output: string;
  if (args[0] === 'demo' && args.length === 2) {
    query = parseSceneQuery(readJson(resolve('examples/remote-sensing/query.json')));
    bytes = readBounded(resolve('examples/remote-sensing/landsat-synthetic.json'), MAX_SNAPSHOT_BYTES);
    receipt = makeSnapshotReceipt(bytes, query, '2026-01-02T00:00:00Z', 'synthetic'); output = args[1];
  } else if (args[0] === 'discover' && args.length === 3) {
    query = parseSceneQuery(readJson(resolve(args[1])));
    const captured = await collectLandsatSnapshot(query); bytes = captured.bytes; receipt = captured.receipt; output = args[2];
  } else if (args[0] === 'replay' && args.length === 3) {
    const input = resolve(args[1]);
    query = parseSceneQuery(readJson(join(input, 'query.json')));
    receipt = readJson(join(input, 'receipt.json')) as SnapshotReceipt;
    bytes = readBounded(join(input, 'snapshot.json'), MAX_SNAPSHOT_BYTES); output = args[2];
    // inspectSceneSnapshot rechecks byte hash, source, query and time; receipt is not trusted by the cast.
  } else { throw new Error('INVALID_ARGUMENTS'); }
  const result = retainSceneRun(resolve(output), bytes, receipt, query);
  console.log(json({ mode: result.mode, representationId: result.representationId,
    accounting: result.accounting, pixelsRead: 0, catalogCompleteness: 'NOT_ESTABLISHED',
    admission: 'NOT_PERFORMED', release: 'NOT_PERFORMED' }));
}
if (require.main === module) {
  sceneCli(process.argv.slice(2)).catch(error => {
    const code = error instanceof SceneError || error instanceof CatalogError ? error.code : 'LOCAL_RUN_FAILED';
    // No local path, rejected payload, response body or raw exception message is logged.
    console.error(JSON.stringify({ status: 'REFUSED', code })); process.exitCode = 1;
  });
}
