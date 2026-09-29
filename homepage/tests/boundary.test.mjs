import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertIndependentCheckouts, assertExhibitAsset, assertShell, assertSynthetic, DOMAIN_COLLECTIONS, EXHIBIT_CSP, fileHashes, filesUnder, hardenExhibitHtml, inspectExhibit, validatePin } from '../scripts/boundary.mjs';
import { startStaticServer } from '../scripts/serve.mjs';
const publicRoot = new URL('../public/', import.meta.url);
const html = await readFile(new URL('index.html', publicRoot), 'utf8');
const css = await readFile(new URL('site.css', publicRoot), 'utf8');
const pin = JSON.parse(await readFile(new URL('../gsv.lock.json', import.meta.url), 'utf8'));
const snapshot = () => Object.fromEntries(DOMAIN_COLLECTIONS.map(key => [key, [{id: `${key}:fixture`, provenance: {source: 'synthetic:demo'}}]]));
const sampleHtml = '<html><head><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet"><link href="./assets/index-abc.css" rel="stylesheet"></head><body><canvas id="scene"></canvas><p>SYNTHETIC DATA</p><script type="module" src="./assets/index-abc.js"></script></body></html>';
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'notation-static-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'assets'));
  await mkdir(join(root, 'data'));
  await writeFile(join(root, 'index.html'), sampleHtml);
  await writeFile(join(root, 'assets/index-abc.js'), '/* TEST FIXTURE ONLY: SYNTHETIC / DEMO DATA; synthetic:demo; payloadEarth */');
  await writeFile(join(root, 'assets/index-abc.css'), 'body{margin:0}');
  for (const file of ['countries-110m.json', 'land-50m.json']) await writeFile(join(root, 'data', file), '{}');
  return root;
}

test('the real shell follows page order and has exactly one static GSV frame', () => assertShell(html, css));
test('product identities cannot turn into launch buttons', () => assert.throws(() => assertShell(html.replace('<strong>PAYLOAD</strong>', '<button>PAYLOAD</button>'), css)));
test('new compiler or operator links are rejected', () => assert.throws(() => assertShell(html.replace('href="#sources"', 'href="/api/economy/orders"'), css)));
test('a second map or script in the shell is rejected', () => {
  assert.throws(() => assertShell(html.replace('</main>', '<canvas></canvas></main>'), css));
  assert.throws(() => assertShell(html.replace('</main>', '<script src="x.js"></script></main>'), css));
});
test('marketing claims outside the brief are rejected', () => assert.throws(() => assertShell(html.replace('Industrial information', 'Live copper intelligence'), css)));
test('CSS cannot import remote assets or target the original synthetic chip', () => {
  assert.throws(() => assertShell(html, css + '@import "https://example.org/a.css";'));
  assert.throws(() => assertShell(html, css + '.pe-sb-chip{display:none}'));
});
test('pin requires exact repository, full commit, source and hint list', () => {
  validatePin(pin);
  for (const change of [{commit:'main'}, {repository:'other/GSV'}, {provenanceSource:'official:live'}, {commandHints:['spatial.map']}]) assert.throws(() => validatePin({...pin, ...change}));
});
test('all domain record collections must remain synthetic:demo', () => assert.equal(assertSynthetic(snapshot()).count, 8));
test('missing or real provenance refuses the build', () => {
  for (const source of [undefined, 'official:public', 'payload:spatial', 'synthetic:other']) {
    const data = snapshot(); data.nodes[0].provenance.source = source;
    assert.throws(() => assertSynthetic(data));
  }
});
test('empty, absent, or nested non-synthetic records refuse the build', () => {
  const empty = Object.fromEntries(DOMAIN_COLLECTIONS.map(key => [key, []]));
  assert.throws(() => assertSynthetic(empty));
  const missing = snapshot(); delete missing.flows; assert.throws(() => assertSynthetic(missing));
  const nested = snapshot(); nested.nodes[0].nested = {provenance:{source:'private:fixture'}}; assert.throws(() => assertSynthetic(nested));
});
test('distribution hardening removes only external font requests, retaining GSV boot and assets', () => {
  const output = hardenExhibitHtml(sampleHtml);
  assert.ok(output.includes(EXHIBIT_CSP));
  assert.doesNotMatch(output, /fonts\.google/);
  assert.match(output, /SYNTHETIC DATA/);
  assert.match(output, /\.\/assets\/index-abc\.js/);
});
test('unknown remote resources and inline scripts refuse distribution', () => {
  assert.throws(() => hardenExhibitHtml(sampleHtml.replace('https://fonts.googleapis.com', 'https://unreviewed.invalid')));
  assert.throws(() => hardenExhibitHtml(sampleHtml.replace('</body>', '<script>fetch("/api/economy")</script></body>')));
});
test('only production assets and the two topology files enter the exhibit', () => {
  for (const path of ['index.html','assets/index-123.js','assets/index-123.css','data/land-50m.json']) assertExhibitAsset(path);
  for (const path of ['../index.html','/index.html','assets/../index.html','assets\\evil.js','.env','server.js','api/economy/index.js','assets/index.js.map','data/released-private.json','CNAME']) assert.throws(() => assertExhibitAsset(path));
});
test('production scan requires the original chip and compatibility identity', async t => {
  const root = await fixture(t);
  assert.equal((await inspectExhibit(root)).length, 5);
  await writeFile(join(root, 'assets/index-abc.js'), 'synthetic:demo; payloadEarth;');
  await assert.rejects(inspectExhibit(root));
});
test('compiler routes, environment references and hidden files refuse distribution', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'assets/index-abc.js'), 'SYNTHETIC / DEMO DATA; synthetic:demo; payloadEarth; fetch("/api/economy")');
  await assert.rejects(inspectExhibit(root));
  await writeFile(join(root, '.env'), 'NOT_A_SECRET=test-fixture');
  await assert.rejects(inspectExhibit(root));
});
test('symlink assets cannot escape the distribution root', async t => {
  const root = await fixture(t);
  await symlink(join(root, 'index.html'), join(root, 'assets/link.js'));
  await assert.rejects(filesUnder(root));
});
test('artifact hashes are stable and content-sensitive', async t => {
  const root = await fixture(t);
  const first = await fileHashes(root); assert.deepEqual(first, await fileHashes(root));
  await writeFile(join(root, 'data/land-50m.json'), '{"fixture":true}');
  assert.notEqual(first['data/land-50m.json'], (await fileHashes(root))['data/land-50m.json']);
});
test('static preview has no auth and rejects all non-read methods and API paths', async t => {
  const root = await fixture(t);
  const server = await startStaticServer(root);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base)).status, 200);
  assert.equal((await fetch(base, {method:'HEAD'})).status, 200);
  for (const method of ['POST','PUT','PATCH','DELETE','OPTIONS']) assert.equal((await fetch(base + '/api/economy', {method})).status, 405);
  for (const path of ['/api/economy','/api/economy/shipments','/api/freight','/spatial.map','/.env','/missing','/%2e%2e/secret']) assert.equal((await fetch(base+path)).status, 404);
});

test('independent Git checkouts cannot share a parent application config', () => {
  assertIndependentCheckouts('/work/homepage-source', '/work/gsv-exhibit');
  assertIndependentCheckouts('/work/gsc', '/work/gsc-other');
  for (const [shell, gsv] of [['/work/gsc', '/work/gsc'], ['/work/gsc', '/work/gsc/.gsv'], ['/work/gsv/gsc', '/work/gsv']]) assert.throws(() => assertIndependentCheckouts(shell, gsv));
});
