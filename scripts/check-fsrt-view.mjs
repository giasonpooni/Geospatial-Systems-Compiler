// The pure reader needs TypeScript only. Real fixtures are mandatory for tests.
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'notation-fsrt-view-'));
try {
  const local = join(root, 'node_modules/typescript/bin/tsc');
  const args = ['--strict', '--target', 'ES2022', '--module', 'commonjs', '--lib', 'ES2022,DOM', '--outDir', out,
    join(root, 'src/lib/notation/fsrt-view.ts')];
  const compile = existsSync(local)
    ? spawnSync(process.execPath, [local, ...args], { cwd: root, stdio: 'inherit' })
    : spawnSync('tsc', args, { cwd: root, stdio: 'inherit' });
  if (compile.error) throw compile.error;
  if (compile.status !== 0) throw new Error('FSRT reader TypeScript compilation failed');
  if (!process.argv.includes('--compile-only')) {
    if (!process.env.FSRT_VIEW_FIXTURES) throw new Error('Real retained fixture directory is required; compile alone does not qualify the reader');
    const test = spawnSync(process.execPath, ['--test', join(root, 'validation/fsrt-view.node.mjs')], {
      cwd: root, stdio: 'inherit', env: { ...process.env, FSRT_VIEW_MODULE: pathToFileURL(join(out, 'fsrt-view.js')).href }
    });
    if (test.error) throw test.error;
    if (test.status !== 0) throw new Error('FSRT retained-view checks failed');
  }
} finally { rmSync(out, { recursive: true, force: true }); }
