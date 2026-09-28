import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';

// Keep the Node regression files outside Vitest's filename convention while
// making the existing `npm test` command exercise the compiler boundary too.
it('GSC compiler, adapter, projection, origin and investigation regressions', () => {
  execFileSync(process.execPath, [fileURLToPath(new URL('../../scripts/test-gsc.mjs', import.meta.url))], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)), timeout: 55_000, stdio: 'pipe',
  });
}, 60_000);
