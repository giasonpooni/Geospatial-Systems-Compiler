/** Structural continuity guard. Does not certify scientific equivalence. */
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
const ledger = JSON.parse(readFileSync(new URL('../docs/replacement-ledger.json', import.meta.url), 'utf8'));
const root = new URL('../', import.meta.url);
assert.equal(ledger.schema, 'notation.capability-replacement.v1');
assert.equal(ledger.retirementAuthorized, false, 'Retirement needs a separate reviewed change and equivalence evidence');
assert.ok(ledger.protectedPaths.length >= 5);
assert.equal(new Set(ledger.capabilities.map(c => c.id)).size, ledger.capabilities.length);
for (const capability of ledger.capabilities) {
  assert.equal(capability.status, 'ADDED');
  assert.ok(capability.implementation.length && capability.checks.length);
}
for (const path of [...ledger.protectedPaths, ...ledger.capabilities.flatMap(c => [...c.implementation, ...c.checks])]) {
  assert.ok(!path.startsWith('/') && !path.split('/').includes('..'));
  assert.ok(statSync(new URL(path, root)).isFile(), `Missing protected capability or gate: ${path}`);
}
const notice = readFileSync(new URL('docs/licenses/osiris-MIT.txt', root));
const blob = createHash('sha1').update(`blob ${notice.length}\0`).update(notice).digest('hex');
assert.equal(blob, '4f9328b44947cb3b8c4b7c6963772b6aaf26db73', 'Retain the original MIT notice verbatim');
console.log('Replacement ledger: additive paths and retained notice intact; no retirement authorized.');
