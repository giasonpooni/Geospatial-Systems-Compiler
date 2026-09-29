/** Offline focused harness. Production modules are strictly typechecked.
 * The SAME test assertions also run normally under the repository's Vitest suite.
 * Here only the describe/it import is adapted to node:test; no assertions are stubbed.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-commercial-'));
try {
  const compiled = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--strict', '--target', 'es2022', '--module', 'commonjs', '--outDir', tmp, 'src/lib/commercial/catalog.ts', 'src/lib/commercial/admission.ts'], { cwd: root, stdio: 'inherit' });
  if (compiled.error || compiled.status !== 0) throw new Error(`Production typecheck failed: ${compiled.error || compiled.status}`);
  console.log('Production TypeScript strict typecheck: PASS');
  const source = fs.readFileSync(path.join(root, 'src/lib/commercial/commercial.test.ts'), 'utf8');
  if (source.split("from 'vitest'").length !== 2) throw new Error('Expected exactly one Vitest test-runner import.');
  const test = ts.transpileModule(source.replace("from 'vitest'", "from 'node:test'"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } });
  fs.writeFileSync(path.join(tmp, 'commercial.test.js'), test.outputText);
  const run = spawnSync(process.execPath, ['--test', path.join(tmp, 'commercial.test.js')], { cwd: root, stdio: 'inherit' });
  if (run.error) throw run.error;
  process.exitCode = run.status ?? 1;
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
