#!/usr/bin/env node
/** Build only the public shell + pinned GSV. Never import or start the parent app. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { validatePin, assertSynthetic, assertShell, inspectExhibit, hardenExhibitHtml, fileHashes, SHELL_CSP, EXHIBIT_CSP } from './boundary.mjs';

assert.ok(Number(process.versions.node.split('.')[0]) >= 24, 'The public build requires Node.js 24+. Do not retarget GSV to Node 22.');
assert.ok(process.argv.length === 4 && process.argv[2] === '--gsv', 'Usage: node homepage/scripts/build.mjs --gsv /path/to/separate/GSV/checkout');
const home = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gsv = await realpath(resolve(process.argv[3]));
const pin = validatePin(JSON.parse(await readFile(join(home, 'gsv.lock.json'), 'utf8')));
const git = (...args) => execFileSync('git', args, { cwd: gsv, encoding: 'utf8' }).trim();
assert.equal(await realpath(git('rev-parse', '--show-toplevel')), gsv, 'GSV must be a separate checkout');
assert.equal(git('rev-parse', 'HEAD'), pin.commit, 'GSV checkout does not match reviewed pin');
assert.equal(git('status', '--porcelain'), '', 'GSV source must be clean, including untracked files');
assert.ok(!(await readdir(gsv)).some(name => name.startsWith('.env')), 'No .env files may be loaded into the public GSV build');
assert.equal(JSON.parse(await readFile(join(gsv, 'package.json'), 'utf8')).name, pin.packageName);
for (const seam of ['scripts/check-seam.mjs', 'scripts/validate-provenance.mjs']) assert.ok((await readFile(join(gsv, seam), 'utf8')).length > 0);
const html = await readFile(join(home, 'public/index.html'), 'utf8');
const css = await readFile(join(home, 'public/site.css'), 'utf8');
assertShell(html, css);

// Deliberately do not forward PAYLOAD_*, VITE_*, tokens, or operator environment.
const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'WINDIR'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
env.CI = 'true';
await rm(join(gsv, 'dist'), { recursive: true, force: true });
if (process.platform === 'win32') {
  execFileSync('cmd.exe', ['/d', '/s', '/c', 'npm run build'], { cwd: gsv, env, stdio: 'inherit' });
} else {
  execFileSync('npm', ['run', 'build'], { cwd: gsv, env, stdio: 'inherit' });
}
assert.equal(git('status', '--porcelain'), '', 'GSV build unexpectedly changed source');
const { buildWorldSnapshot } = await import(pathToFileURL(join(gsv, 'src/data/synthetic/world.ts')).href);
const provenance = assertSynthetic(buildWorldSnapshot());
await inspectExhibit(join(gsv, 'dist'));

const stage = join(home, `.dist-build-${process.pid}`);
const destination = join(home, 'dist');
await rm(stage, { recursive: true, force: true });
try {
  await mkdir(stage, { recursive: true });
  // Four explicit shell files; never recursively copy the GSC repository.
  for (const name of ['index.html', 'site.css', 'favicon.svg', '404.html']) await cp(join(home, 'public', name), join(stage, name));
  await cp(join(gsv, 'dist'), join(stage, 'exhibit'), { recursive: true });
  await writeFile(join(stage, 'exhibit/index.html'), hardenExhibitHtml(await readFile(join(stage, 'exhibit/index.html'), 'utf8')));
  await mkdir(join(stage, 'licenses'));
  await cp(join(gsv, 'LICENSE'), join(stage, 'licenses/GSV-GPL-3.0.txt'));
  await mkdir(join(stage, 'source'));
  await writeFile(join(stage, 'source/gsv-source.tar.gz'), execFileSync('git', ['archive', '--format=tar.gz', '--prefix=gsv/', pin.commit], { cwd: gsv, maxBuffer: 50 * 1024 * 1024 }));
  const shellCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: home, encoding: 'utf8' }).trim();
  await writeFile(join(stage, 'source/homepage-source.tar.gz'), execFileSync('git', ['archive', '--format=tar.gz', '--prefix=notation-homepage/', shellCommit, 'homepage', '.github/workflows/notation-homepage.yml', 'LICENSE'], { cwd: resolve(home, '..'), maxBuffer: 50 * 1024 * 1024 }));
  await writeFile(join(stage, '.nojekyll'), '');
  await writeFile(join(stage, '_headers'), `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()\n/\n  Content-Security-Policy: ${SHELL_CSP}\n/index.html\n  Content-Security-Policy: ${SHELL_CSP}\n/exhibit/*\n  Content-Security-Policy: ${EXHIBIT_CSP}\n`);
  await writeFile(join(stage, 'build-manifest.json'), JSON.stringify({
    schema: 'notation.homepage-build.v1',
    shellCommit,
    gsv: pin,
    domainRecords: provenance,
    publicSurface: { staticOnly: true, canonicalWrites: false, evidenceAdmission: false, liveProvider: false, connectedAdapters: false },
    distributionChanges: ['Remove external Google Fonts links from GSV built HTML; retain local fallback fonts.', 'Add read-only CSP and no-referrer policy to GSV built HTML. No GSV source or status-chip changes.'],
    sha256: await fileHashes(stage),
  }, null, 2) + '\n');
  await rm(destination, { recursive: true, force: true });
  await rename(stage, destination);
  console.log(`\nPublic static build: ${destination}\nGSV ${pin.commit}\n${provenance.count} domain records: every source is synthetic:demo.\nNo GSC application, server, credentials, or API routes copied.`);
} finally {
  await rm(stage, { recursive: true, force: true });
}
