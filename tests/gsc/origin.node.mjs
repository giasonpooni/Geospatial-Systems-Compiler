import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

test('imported GSV validator restores exactly to the audited source blob', () => {
  let source = readFileSync(new URL('../../src/lib/gsc/compat/gsv/validation.ts', import.meta.url), 'utf8');
  source = '/** Runtime eligibility checks, not source authentication or evidence admission. */\n' + source.slice(source.indexOf('import type'));
  source = source.replace('export function dataTree(value:', 'function dataTree(value:');
  source = source.replace('if (item === undefined && !arrayEntry) return;', 'if (item === undefined && !arrayEntry) return; // optional TypeScript properties');
  source = source.replace("optional(r, 'corridorId', identifier);", "optional(r, 'corridorId', identifier); // external grouping label, not an invented entity");
  const bytes = Buffer.from(source);
  const hash = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  assert.equal(hash, 'fe6a9db4b0faa43426b84136088adae66a37f07a',
    'Validator changed beyond the documented export/comment adaptation; audit and update the integration ledger deliberately');
});
