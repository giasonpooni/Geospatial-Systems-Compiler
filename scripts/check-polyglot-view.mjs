// Compile the standalone boundary and exercise it without a Next server or WebGL.
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'notation-linear-view-'));
try {
  const local = join(root, 'node_modules/typescript/bin/tsc');
  const args = ['--strict', '--target', 'ES2022', '--module', 'commonjs', '--lib', 'ES2022,DOM', '--outDir', out,
    join(root, 'src/lib/notation/linear-map-view.ts'), join(root, 'src/lib/notation/linear-uncertainty-view.ts')];
  const compile = existsSync(local)
    ? spawnSync(process.execPath, [local, ...args], { cwd: root, stdio: 'inherit' })
    : spawnSync('tsc', args, { cwd: root, stdio: 'inherit' });
  if (compile.error) throw compile.error;
  if (compile.status !== 0) throw new Error('TypeScript compilation failed');
  const test = spawnSync(process.execPath, ['--test', join(root, 'validation/linear-map-view.node.mjs')], {
    cwd: root, stdio: 'inherit', env: { ...process.env, LINEAR_MAP_MODULE: pathToFileURL(join(out, 'linear-map-view.js')).href, LINEAR_UNCERTAINTY_MODULE: pathToFileURL(join(out, 'linear-uncertainty-view.js')).href }
  });
  if (test.error) throw test.error;
  if (test.status !== 0) throw new Error('Projection contract checks failed');
} finally { rmSync(out, { recursive: true, force: true }); }
