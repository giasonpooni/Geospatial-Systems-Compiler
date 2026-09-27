/** Compile and test the dependency-free GSC slice without changing the app build. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'src/lib/gsc');
const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
const sources = walk(source).filter((file) => file.endsWith('.ts'));
// Development guardrail, not a sandbox. Every static dependency must stay inside this slice.
for (const file of sources) {
  const contents = readFileSync(file, 'utf8');
  if (/\b(?:window|document)\s*\./.test(contents)) throw new Error(`Browser dependency in compiler: ${file}`);
  for (const match of contents.matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g)) {
    const specifier = match[1];
    const target = path.resolve(path.dirname(file), specifier);
    if (!specifier.startsWith('.') || (target !== source && !target.startsWith(source + path.sep)))
      throw new Error(`Dependency crosses the compiler boundary: ${file} -> ${specifier}`);
  }
}
const build = mkdtempSync(path.join(tmpdir(), 'gsc-test-'));
const localTsc = path.join(root, 'node_modules/typescript/bin/tsc');
try {
  const args = ['--strict', '--target', 'ES2022', '--module', 'commonjs', '--moduleResolution', 'node',
    '--rootDir', source, '--outDir', build, ...sources];
  if (existsSync(localTsc)) execFileSync(process.execPath, [localTsc, ...args], { cwd: root, stdio: 'inherit' });
  else execFileSync('tsc', args, { cwd: root, stdio: 'inherit' });
  const tests = walk(path.join(root, 'tests/gsc')).filter((file) => file.endsWith('.node.mjs'));
  execFileSync(process.execPath, ['--test', ...tests], { cwd: root, stdio: 'inherit',
    env: { ...process.env, GSC_BUILD_DIR: build } });
} finally { rmSync(build, { recursive: true, force: true }); }
