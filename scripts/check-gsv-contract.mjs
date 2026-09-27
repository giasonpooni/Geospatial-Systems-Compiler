/** Check the local mirror; optional argument compares a separately fetched pinned upstream file. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const pin = JSON.parse(readFileSync(new URL('../docs/gsv-contract-pin.json', import.meta.url), 'utf8'));
assert.equal(pin.repository, 'giasonpooni/Geospatial-State-Visualization');
assert.match(pin.commit, /^[a-f0-9]{40}$/); assert.equal(pin.path, 'src/data/esmProjection.ts');
const local = readFileSync(new URL('../src/lib/explorer/esmProjection.ts', import.meta.url));
assert.equal(createHash('sha256').update(local).digest('hex'), pin.sha256, 'Consumer mirror drifted from the reviewed contract');
if (process.argv[2]) assert.deepEqual(readFileSync(process.argv[2]), local, 'Pinned upstream consumer and local mirror differ');
console.log('GSV consumer mirror matches its exact content pin' + (process.argv[2] ? ' and supplied upstream bytes.' : '.'));
