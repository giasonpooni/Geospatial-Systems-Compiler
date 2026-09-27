import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPublicProjection } from '../../src/lib/explorer/loadProjection.ts';
import { fixture } from '../helpers/public-projection.mjs';
const config = p => ({ enabled: '1', esmOrigin: 'http://127.0.0.1:3001', specJson: JSON.stringify(p.spec),
  digest: p.digest, viewerUrl: 'http://127.0.0.1:5173/embed.html' });
const response = p => new Response(JSON.stringify(p), { headers: { 'Content-Type': 'application/json', 'X-Payload-Fixture-Only': 'true' } });
test('server adapter sends only the pinned read-only request and validates returned bytes', async () => {
  const p = await fixture(); let calls = 0;
  const result = await loadPublicProjection(config(p), async (url, init) => {
    calls++; assert.equal(url.toString(), 'http://127.0.0.1:3001/api/projections/preview');
    assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    assert.equal(init.credentials, 'omit'); assert.equal(init.headers.Authorization, undefined);
    assert.deepEqual(JSON.parse(init.body), p.spec); return response(p);
  });
  assert.equal(calls, 1); assert.equal(result.projection.digest, p.digest); assert.ok(Object.isFrozen(result.projection));
});
test('disabled and incomplete publication settings never call ESM', async () => {
  const p = await fixture();
  for (const settings of [{}, { ...config(p), enabled: '0' }, { ...config(p), digest: undefined }]) {
    await assert.rejects(loadPublicProjection(settings, () => { throw new Error('Network must not be reached'); }), /EXPLORER_NOT_CONFIGURED/);
  }
});
test('invalid public selection and endpoints fail before network access', async () => {
  const p = await fixture();
  for (const change of [{ esmOrigin: 'https://example.com/private' }, { viewerUrl: 'javascript:alert(1)' },
    { viewerUrl: 'https://example.com/?token=x' }, { specJson: JSON.stringify({ ...p.spec, viewer: 'COUNTERPARTY_SHARED' }) }])
    await assert.rejects(loadPublicProjection({ ...config(p), ...change }, () => { throw new Error('Must not fetch'); }), /INVALID_EXPLORER_CONFIGURATION/);
});
test('missing fixture header and upstream errors are unavailable, never forwarded verbatim', async () => {
  const p = await fixture();
  for (const r of [new Response(JSON.stringify(p)), new Response('private details', { status: 403 })])
    await assert.rejects(loadPublicProjection(config(p), async () => r), /^ProjectionRefusal: PROJECTION_UNAVAILABLE$/);
});
test('upstream binding mismatch refuses instead of returning a fallback', async () => {
  const p = await fixture(); const settings = config(p); p.spec.source.releaseId = 'other';
  await assert.rejects(loadPublicProjection(settings, async () => response(p)), /SOURCE_BINDING_MISMATCH/);
});
test('oversized response stream is cancelled', async () => {
  const p = await fixture(); let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1_048_577)); }, cancel() { cancelled = true; } });
  const r = new Response(stream, { headers: { 'Content-Type': 'application/json', 'X-Payload-Fixture-Only': 'true' } });
  await assert.rejects(loadPublicProjection(config(p), async () => r), /PROJECTION_TOO_LARGE/); assert.equal(cancelled, true);
});
test('malformed UTF-8 refuses with no raw upstream text', async () => {
  const p = await fixture(); const r = new Response(new Uint8Array([0xc3, 0x28]), { headers: { 'Content-Type': 'application/json', 'X-Payload-Fixture-Only': 'true' } });
  await assert.rejects(loadPublicProjection(config(p), async () => r), /PROJECTION_UNAVAILABLE/);
});
