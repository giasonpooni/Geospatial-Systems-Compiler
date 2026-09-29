import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, lstat } from 'node:fs/promises';
import { join, posix } from 'node:path';

export const SHELL_CSP = "default-src 'none'; style-src 'self'; img-src 'self' data:; frame-src 'self'; script-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
// Existing GSV HUD uses inline style properties. No inline JavaScript is allowed.
export const EXHIBIT_CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'";
export const DOMAIN_COLLECTIONS = ['nodes', 'routes', 'flows', 'commodities', 'events', 'constraints', 'assertions', 'observations'];
const BLOCKED_BUNDLE_TEXT = /\/api\/(?:economy|freight)\b|PAYLOAD_[A-Z][A-Z0-9_]*|NEXT_PUBLIC_|live\s+comtrade/i;
const FORBIDDEN_COPY = /\$\s*(?:20k|650k|25m)|\b(?:data broker|OSINT|CAI|HAFD|pairing-field|live copper intelligence)\b/i;

export function validatePin(pin) {
  assert.equal(pin.repository, 'giasonpooni/Geospatial-State-Visualization', 'Only the reviewed GSV repository is eligible');
  assert.match(pin.commit, /^[a-f0-9]{40}$/, 'Pin a full immutable Git commit, not a branch or URL');
  assert.equal(pin.packageName, 'payload-earth');
  assert.equal(pin.provenanceSource, 'synthetic:demo');
  assert.deepEqual(pin.commandHints, ['show maritime', 'show copper flows', 'find toronto', 'help']);
  return pin;
}

export function assertSynthetic(snapshot) {
  let count = 0;
  const counts = {};
  for (const collection of DOMAIN_COLLECTIONS) {
    assert.ok(Array.isArray(snapshot[collection]), `Missing domain collection: ${collection}`);
    counts[collection] = snapshot[collection].length;
    for (const record of snapshot[collection]) {
      assert.equal(record?.provenance?.source, 'synthetic:demo', `${collection}:${record?.id ?? '?'} is not synthetic:demo`);
      count++;
    }
  }
  assert.ok(count > 0, 'An empty snapshot is not an exhibit');
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if ('provenance' in value) assert.equal(value.provenance?.source, 'synthetic:demo', 'Non-synthetic nested provenance');
    for (const child of Object.values(value)) visit(child);
  };
  visit(snapshot);
  return { count, counts };
}

export function assertExhibitAsset(path) {
  assert.equal(path, posix.normalize(path), 'Non-canonical asset path');
  assert.ok(!path.includes('\\') && !path.startsWith('/') && !path.includes('..'), 'Unsafe asset path');
  assert.ok(path === 'index.html' || /^assets\/[A-Za-z0-9_-]+\.(?:js|css)$/.test(path) || /^data\/(?:countries-110m|land-50m)\.json$/.test(path), `Unexpected GSV build file: ${path}`);
}

export function hardenExhibitHtml(html) {
  assert.match(html, /<head>/i, 'Missing exhibit head');
  assert.match(html, /id="scene"/);
  assert.match(html, /SYNTHETIC DATA/);
  // Drop only the existing Google Fonts requests from the distribution HTML.
  // Source, theme CSS, data, HUD, and the original status chip remain untouched.
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1] ?? '';
    if (/^https:\/\/fonts\.(?:googleapis|gstatic)\.com(?:\/|$)/.test(href)) return '';
    assert.ok(!/^(?:https?:)?\/\//i.test(href), `External exhibit resource: ${href}`);
    return tag;
  });
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    assert.match(match[1], /\bsrc="\.\/assets\/[A-Za-z0-9_-]+\.js"/, 'Only local Vite production modules are allowed');
    assert.equal(match[2].trim(), '', 'No inline exhibit scripts');
  }
  assert.doesNotMatch(html, /<base\b|<form\b|<iframe\b|\bon[a-z]+\s*=/i);
  assert.doesNotMatch(html, BLOCKED_BUNDLE_TEXT);
  return html.replace(/<head>/i, `<head>\n    <meta http-equiv="Content-Security-Policy" content="${EXHIBIT_CSP}">\n    <meta name="referrer" content="no-referrer">`);
}

export function assertShell(html, css) {
  assert.equal([...html.matchAll(/<iframe\b/gi)].length, 1, 'Exactly one exhibit iframe');
  assert.match(html, /<iframe[^>]+src="\.\/exhibit\/"/);
  assert.match(html, /sandbox="allow-scripts allow-same-origin"/);
  assert.match(html, /id="build-status"[^>]*>[\s\S]*?Synthetic snapshot<\/span>/);
  assert.ok(html.includes(SHELL_CSP), 'Shell CSP missing');
  assert.doesNotMatch(html, /<script\b|<form\b|<input\b|<canvas\b|<base\b|\bon[a-z]+\s*=/i);
  assert.doesNotMatch(html, FORBIDDEN_COPY);
  assert.doesNotMatch(html, BLOCKED_BUNDLE_TEXT);
  assert.doesNotMatch(css, /@import\b|\burl\s*\(|pe-sb-chip|pe-statusbar|\bexpression\s*\(/i);
  const allowedLinks = new Set(['#main', '#exhibit', '#architecture', '#sources', './favicon.svg', './site.css', './exhibit/', './build-manifest.json', './licenses/GSV-GPL-3.0.txt', './source/gsv-source.tar.gz', './source/homepage-source.tar.gz', 'https://github.com/giasonpooni/Geospatial-State-Visualization', 'https://github.com/giasonpooni/Geospatial-Systems-Compiler', 'https://notation.systems']);
  for (const match of html.matchAll(/\bhref="([^"]+)"/g)) assert.ok(allowedLinks.has(match[1]), `Unreviewed link: ${match[1]}`);
  const surfaces = /<div class="surfaces"[\s\S]*?<\/div>/.exec(html)?.[0] ?? '';
  for (const name of ['PAYLOAD', 'TRADEWIND', 'LANDSHARK']) assert.ok(surfaces.includes(name));
  assert.doesNotMatch(surfaces, /<a\b|<button\b|<form\b/i, 'Product identities are not launchers');
  assert.ok(html.indexOf('class="org-strip"') < html.indexOf('id="exhibit"'));
  assert.ok(html.indexOf('id="exhibit"') < html.indexOf('id="architecture"'));
  assert.ok(html.indexOf('id="architecture"') < html.indexOf('id="sources"'));
}

export async function filesUnder(root, prefix = '') {
  const result = [];
  for (const entry of (await readdir(join(root, prefix), { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name, 'en'))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    const stat = await lstat(join(root, path));
    assert.ok(!stat.isSymbolicLink(), `Symlink not allowed: ${path}`);
    if (stat.isDirectory()) result.push(...await filesUnder(root, path));
    else { assert.ok(stat.isFile(), `Not a regular file: ${path}`); result.push(path); }
  }
  return result;
}

export async function inspectExhibit(root) {
  const paths = await filesUnder(root);
  for (const required of ['index.html', 'data/countries-110m.json', 'data/land-50m.json']) assert.ok(paths.includes(required), `Missing production asset: ${required}`);
  assert.ok(paths.some(path => /^assets\/.+\.js$/.test(path)), 'Missing built Vite JavaScript');
  assert.ok(paths.some(path => /^assets\/.+\.css$/.test(path)), 'Missing built Vite stylesheet');
  for (const path of paths) {
    assertExhibitAsset(path);
    const text = await readFile(join(root, path), 'utf8');
    assert.doesNotMatch(text, BLOCKED_BUNDLE_TEXT, `Operational reference in ${path}`);
  }
  const js = (await Promise.all(paths.filter(path => path.endsWith('.js')).map(path => readFile(join(root, path), 'utf8')))).join('\n');
  assert.ok(js.includes('SYNTHETIC / DEMO DATA'), 'Existing GSV status chip is missing');
  assert.ok(js.includes('synthetic:demo'), 'Synthetic source identity is missing');
  assert.ok(js.includes('payloadEarth'), 'Compatibility browser identity is missing');
  return paths;
}

export async function fileHashes(root) {
  const hashes = {};
  for (const path of await filesUnder(root)) hashes[path] = createHash('sha256').update(await readFile(join(root, path))).digest('hex');
  return hashes;
}
