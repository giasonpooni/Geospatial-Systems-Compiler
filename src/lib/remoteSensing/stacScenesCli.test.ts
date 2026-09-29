import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { retainSceneRun, sceneCli } from '../../../scripts/rs-scenes';
import { queryFixture, sceneFixture } from './stacScenes.cases';
import { digest, makeSnapshotReceipt } from './stacScenes';

describe('actual scene CLI artifacts and replay', () => {
  const inTemp = async (run: (root: string) => void | Promise<void>) => {
    const root = mkdtempSync(join(tmpdir(), 'rs-scene-test-'));
    try { await run(root); } finally { rmSync(root, { recursive: true, force: true }); }
  };
  const packet = (body = JSON.stringify({ type: 'FeatureCollection', features: [sceneFixture()], links: [] })) => {
    const bytes = new TextEncoder().encode(body), query = queryFixture();
    return { bytes, query, receipt: makeSnapshotReceipt(bytes, query, '2026-01-02T00:00:00Z', 'synthetic') };
  };
  it('writes exact bytes and hash-verifiable artifacts, with completion last', () => inTemp(root => {
    const p = packet(), output = join(root, 'one'); retainSceneRun(output, p.bytes, p.receipt, p.query);
    expect(readFileSync(join(output, 'snapshot.json'))).toEqual(Buffer.from(p.bytes));
    const manifest = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'));
    expect(manifest.status).toBe('COMPLETE');
    for (const file of manifest.files) expect(digest(readFileSync(join(output, file.path)))).toBe(file.sha256);
  }));
  it('refuses existing directories without modifying their manifests', () => inTemp(root => {
    const p = packet(), output = join(root, 'one'); retainSceneRun(output, p.bytes, p.receipt, p.query);
    const before = readFileSync(join(output, 'manifest.json'));
    expect(() => retainSceneRun(output, p.bytes, p.receipt, p.query)).toThrow();
    expect(readFileSync(join(output, 'manifest.json'))).toEqual(before);
  }));
  it('retains malformed source bytes and records refusal rather than losing evidence', () => inTemp(root => {
    const p = packet('{malformed-json'), output = join(root, 'bad');
    expect(() => retainSceneRun(output, p.bytes, p.receipt, p.query)).toThrow('INVALID_SNAPSHOT');
    expect(readFileSync(join(output, 'snapshot.json'))).toEqual(Buffer.from(p.bytes));
    expect(JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8')).status).toBe('REFUSED');
    expect(existsSync(join(output, 'inspection.json'))).toBe(false);
  }));
  it('replays the actual CLI without network and keeps execution separate', () => inTemp(async root => {
    const p = packet(), original = join(root, 'one'), replay = join(root, 'two');
    const a = retainSceneRun(original, p.bytes, p.receipt, p.query);
    const oldFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('NETWORK_MUST_NOT_RUN'); };
    try { await sceneCli(['replay', original, replay]); } finally { globalThis.fetch = oldFetch; }
    const b = JSON.parse(readFileSync(join(replay, 'inspection.json'), 'utf8'));
    expect(b.representationId).toBe(a.representationId); expect(b.executionRef).not.toBe(a.executionRef);
  }));
  it('tampered replay bytes produce a refusal manifest, not completed state', () => inTemp(async root => {
    const p = packet(), original = join(root, 'one'), replay = join(root, 'two');
    retainSceneRun(original, p.bytes, p.receipt, p.query);
    writeFileSync(join(original, 'snapshot.json'), '{}');
    await expect(sceneCli(['replay', original, replay])).rejects.toThrow('SNAPSHOT_HASH_MISMATCH');
    expect(JSON.parse(readFileSync(join(replay, 'manifest.json'), 'utf8')).status).toBe('REFUSED');
  }));
});
