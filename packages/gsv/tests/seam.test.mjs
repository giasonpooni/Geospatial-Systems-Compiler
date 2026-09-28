import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

for (const [specifier, succeeds] of [
  ['./contracts.ts', true], ['../core/time.ts', true], ['../data-extra/escape.ts', false],
  ['../data2/escape.ts', false], ['../../renderer.ts', false], ['three', false],
]) test(`seam containment: ${specifier}`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'gsv-seam-'));
  try {
    await mkdir(join(root, 'scripts')); await mkdir(join(root, 'src/data'), { recursive: true });
    await copyFile(new URL('../scripts/check-seam.mjs', import.meta.url), join(root, 'scripts/check-seam.mjs'));
    await writeFile(join(root, 'src/data/check.ts'), `import '${specifier}';\n`);
    const result = spawnSync(process.execPath, [join(root, 'scripts/check-seam.mjs')], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, succeeds ? 0 : 1, result.stderr);
  } finally { await rm(root, { recursive: true, force: true }); }
});
