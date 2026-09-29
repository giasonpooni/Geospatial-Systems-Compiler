import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { qualifyDelivery, qualifySeatValue, qualifyWatch } from './admission';
import { COMMERCIAL_SKUS, SEAT_VALUE_TEST } from './catalog';

const AT = '2026-09-28T12:00:00Z';
const request = (extra = {}) => ({ sku: 'seat', delivery: 'memo_export', customerOrgId: 'org:fixture-buyer', scope: { kind: 'commodity', id: 'copper' }, purpose: 'commodity_state', objectKinds: ['site'], sourceIds: ['fixture-source'], derived: false, ...extra });
const grant = (extra = {}) => ({ sourceId: 'fixture-source', customerOrgId: 'org:fixture-buyer', status: 'approved', subjects: 'industrial_objects', sourceRegistryAccepted: true, scopeKeys: ['commodity:copper'], permissions: ['seat_display', 'memo_export'], derivedAllowed: false, termsRef: 'fixture:terms', reviewRef: 'fixture:review', snapshotRef: 'fixture:vintage', startsAt: '2026-01-01T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z', ...extra });
const codes = (r: ReturnType<typeof qualifyDelivery>) => r.issues.map(i => i.code);
const refuses = (r: ReturnType<typeof qualifyDelivery>, code: string) => { assert.equal(r.status, 'refused'); assert.ok(codes(r).includes(code), JSON.stringify(r)); assert.ok(r.issues.every(i => i.path && i.remedy)); };

const order = (extra = {}) => ({ objectIds: ['ent:site:fixture'], eventClasses: ['operational', 'financial', 'regulatory'], triggers: ['excursion', 'posting_window', 'coverage_gap'], cadenceSeconds: 3600, coverageGapAfterSeconds: 7200, postingWindowSeconds: 3600, ...extra });
const capacity = (extra = {}) => ({ maxObjects: 1000, minCadenceSeconds: 3600, evidenceRef: 'fixture:load-test', ...extra });
const register = [{ id: 'ent:site:fixture', objectKind: 'site', resolution: 'resolved', evidenceRef: 'fixture:identity' }];
const valueEvidence = (extra = {}) => ({ kind: 'paid', currency: 'USD', amountMinor: 1_000_000, evidenceRef: 'fixture:payment', scopeRef: 'fixture:scope', termRef: 'fixture:term', ...extra });
const demand = (extra = {}) => ({ nonBuilder: true, unpromptedReturnDays: ['2026-09-20', '2026-09-21', '2026-09-22'], findingRefs: [], addressedMissQueryIds: [], valueEvidence: valueEvidence(), ...extra });

describe('three commercial products, not unverified price or scale claims', () => {
  it('keeps three distinct SKUs and contracts with no published numeric rate', () => {
    assert.deepEqual(COMMERCIAL_SKUS.map(s => s.id), ['seat', 'feed', 'watch']);
    assert.equal(new Set(COMMERCIAL_SKUS.map(s => s.contract)).size, 3);
    assert.ok(COMMERCIAL_SKUS.every(s => !('price' in s)));
    assert.equal(SEAT_VALUE_TEST.status, 'planning-assumption');
  });
});

describe('commercial source-rights preflight is fail-closed', () => {
  it('qualifies an exact, licensed customer/scope/delivery fixture', () => assert.equal(qualifyDelivery(request(), [grant()], AT).status, 'qualified'));
  for (const [name, change, code] of [
    ['research only', { status: 'research_only' }, 'RIGHTS_NOT_APPROVED'],
    ['pending', { status: 'pending' }, 'RIGHTS_NOT_APPROVED'],
    ['revoked', { status: 'revoked' }, 'RIGHTS_NOT_APPROVED'],
    ['mixed subjects', { subjects: 'mixed' }, 'SOURCE_POLICY_REFUSED'],
    ['natural persons', { subjects: 'natural_persons' }, 'SOURCE_POLICY_REFUSED'],
    ['unknown subjects', { subjects: 'unknown' }, 'SOURCE_POLICY_REFUSED'],
    ['unregistered source', { sourceRegistryAccepted: false }, 'SOURCE_POLICY_REFUSED'],
    ['missing terms', { termsRef: '' }, 'MISSING_RIGHTS_EVIDENCE'],
    ['missing review', { reviewRef: '' }, 'MISSING_RIGHTS_EVIDENCE'],
    ['missing vintage', { snapshotRef: '' }, 'MISSING_RIGHTS_EVIDENCE'],
    ['expired', { expiresAt: AT }, 'RIGHTS_OUTSIDE_WINDOW'],
    ['future', { startsAt: '2026-09-29T00:00:00Z' }, 'RIGHTS_OUTSIDE_WINDOW'],
    ['inverted validity', { startsAt: '2027-02-01T00:00:00Z' }, 'RIGHTS_OUTSIDE_WINDOW'],
    ['invalid date', { expiresAt: '2027-02-30T00:00:00Z' }, 'RIGHTS_OUTSIDE_WINDOW'],
    ['invalid instant', { expiresAt: 'never' }, 'RIGHTS_OUTSIDE_WINDOW'],
    ['wrong customer', { customerOrgId: 'org:other' }, 'MISSING_GRANT'],
    ['wrong scope', { scopeKeys: ['corridor:copper'] }, 'RIGHTS_SCOPE_MISMATCH'],
    ['display is not export', { permissions: ['seat_display'] }, 'DELIVERY_NOT_LICENSED'],
    ['unknown permission', { permissions: ['memo_export', 'anything'] }, 'DELIVERY_NOT_LICENSED'],
  ] as const) it(`refuses ${name}`, () => refuses(qualifyDelivery(request(), [grant(change)], AT), code));
  for (const bad of [null, [], {}, 'seat', { ...request(), person: 'fixture' }]) it(`refuses malformed or extra request fields: ${JSON.stringify(bad)}`, () => refuses(qualifyDelivery(bad, [grant()], AT), 'INVALID_REQUEST'));
  it('refuses missing grants', () => refuses(qualifyDelivery(request(), [], AT), 'MISSING_GRANT'));
  it('refuses an invalid grant registry', () => refuses(qualifyDelivery(request(), null, AT), 'INVALID_GRANT_REGISTRY'));
  it('does not select the permissive duplicate grant', () => refuses(qualifyDelivery(request(), [grant(), grant({ status: 'revoked' })], AT), 'AMBIGUOUS_GRANT'));
  it('requires every input source, including derived lineage', () => refuses(qualifyDelivery(request({ sourceIds: ['fixture-source', 'fixture-input'], derived: true }), [grant({ derivedAllowed: true })], AT), 'MISSING_GRANT'));
  it('does not launder rights through a derived label', () => refuses(qualifyDelivery(request({ derived: true }), [grant()], AT), 'DERIVED_NOT_LICENSED'));
  it('accepts explicitly licensed derived use', () => assert.equal(qualifyDelivery(request({ derived: true }), [grant({ derivedAllowed: true })], AT).status, 'qualified'));
  it('rejects an empty source list', () => refuses(qualifyDelivery(request({ sourceIds: [] }), [grant()], AT), 'INVALID_PROVENANCE'));
  it('rejects duplicate sources', () => refuses(qualifyDelivery(request({ sourceIds: ['fixture-source', 'fixture-source'] }), [grant()], AT), 'INVALID_PROVENANCE'));
  it('refuses a missing timezone', () => refuses(qualifyDelivery(request(), [grant()], '2026-09-28T12:00:00'), 'INVALID_TIME'));
  it('accepts a canonical millisecond instant', () => assert.equal(qualifyDelivery(request(), [grant()], '2026-09-28T12:00:00.001Z').status, 'qualified'));
  it('rejects cross-SKU delivery', () => refuses(qualifyDelivery(request({ delivery: 'bulk_feed' }), [grant({ permissions: ['bulk_feed'] })], AT), 'SKU_DELIVERY_MISMATCH'));
  it('rejects unknown SKU', () => refuses(qualifyDelivery(request({ sku: 'enterprise' }), [grant()], AT), 'SKU_DELIVERY_MISMATCH'));
  it('keeps a seat scoped to one commodity or corridor', () => refuses(qualifyDelivery(request({ scope: { kind: 'region', id: 'fixture' } }), [grant()], AT), 'SKU_SCOPE_MISMATCH'));
  it('permits a region feed only with exact bulk rights', () => assert.equal(qualifyDelivery(request({ sku: 'feed', delivery: 'bulk_feed', scope: { kind: 'region', id: 'fixture' } }), [grant({ permissions: ['bulk_feed'], scopeKeys: ['region:fixture'] })], AT).status, 'qualified'));
  it('requires a watch portfolio scope', () => refuses(qualifyDelivery(request({ sku: 'watch', delivery: 'watch_alert' }), [grant()], AT), 'SKU_SCOPE_MISMATCH'));
  it('qualifies a licensed object portfolio watch preflight', () => assert.equal(qualifyDelivery(request({ sku: 'watch', delivery: 'watch_alert', scope: { kind: 'portfolio', id: 'fixture:v1' } }), [grant({ permissions: ['watch_alert'], scopeKeys: ['portfolio:fixture:v1'] })], AT).status, 'qualified'));
  for (const kind of ['person', 'driver', 'device', 'unknown']) it(`refuses ${kind} as a commercial subject`, () => refuses(qualifyDelivery(request({ objectKinds: [kind] }), [grant()], AT), 'SUBJECT_REFUSED'));
  it('refuses an unsupported purpose', () => refuses(qualifyDelivery(request({ purpose: 'person_location' }), [grant()], AT), 'PURPOSE_REFUSED'));
  it('does not extend sanctions to parcels or sites', () => refuses(qualifyDelivery(request({ purpose: 'object_sanctions' }), [grant()], AT), 'SANCTIONS_SUBJECT_REFUSED'));
  it('permits sanctions only for the three named object kinds', () => assert.equal(qualifyDelivery(request({ purpose: 'object_sanctions', objectKinds: ['organisation', 'vessel', 'aircraft'] }), [grant()], AT).status, 'qualified'));
});

describe('watch qualification does not invent identity or capacity', () => {
  it('qualifies the bounded synthetic order', () => assert.equal(qualifyWatch(order(), capacity(), register).status, 'qualified'));
  it('requires the object register', () => refuses(qualifyWatch(order(), capacity(), null), 'MISSING_OBJECT_REGISTER'));
  it('an ent: prefix is not resolution evidence', () => refuses(qualifyWatch(order(), capacity(), []), 'WATCH_OBJECT_UNRESOLVED'));
  it('refuses duplicate identities', () => refuses(qualifyWatch(order({ objectIds: ['ent:site:fixture', 'ent:site:fixture'] }), capacity(), register), 'WATCH_IDENTITIES_REFUSED'));
  it('refuses noncanonical IDs', () => refuses(qualifyWatch(order({ objectIds: ['fixture'] }), capacity(), register), 'WATCH_IDENTITIES_REFUSED'));
  it('does not merge similar candidates', () => refuses(qualifyWatch(order(), capacity(), [{ ...register[0], resolution: 'candidate' }]), 'WATCH_OBJECT_UNRESOLVED'));
  it('refuses ambiguous register entries', () => refuses(qualifyWatch(order(), capacity(), [...register, ...register]), 'WATCH_OBJECT_UNRESOLVED'));
  it('refuses a person hidden behind an ent: ID', () => refuses(qualifyWatch(order(), capacity(), [{ ...register[0], objectKind: 'person' }]), 'WATCH_OBJECT_UNRESOLVED'));
  it('requires identity evidence', () => refuses(qualifyWatch(order(), capacity(), [{ ...register[0], evidenceRef: '' }]), 'WATCH_OBJECT_UNRESOLVED'));
  it('requires coverage gap notices', () => refuses(qualifyWatch(order({ triggers: ['excursion'] }), capacity(), register), 'COVERAGE_GAP_REQUIRED'));
  it('refuses unknown event classes', () => refuses(qualifyWatch(order({ eventClasses: ['financial', 'social'] }), capacity(), register), 'WATCH_CLASS_REFUSED'));
  it('refuses quoted cadence faster than tested', () => refuses(qualifyWatch(order({ cadenceSeconds: 60 }), capacity(), register), 'WATCH_CADENCE_UNQUALIFIED'));
  it('does not claim one million IDs from a one-thousand qualification', () => refuses(qualifyWatch(order({ objectIds: Array.from({ length: 1001 }, (_, i) => `ent:site:${i}`) }), capacity(), []), 'WATCH_CAPACITY_EXCEEDED'));
  it('requires load evidence', () => refuses(qualifyWatch(order(), capacity({ evidenceRef: '' }), register), 'UNQUALIFIED_CAPACITY'));
  it('rejects nonfinite capacity', () => refuses(qualifyWatch(order(), capacity({ maxObjects: Infinity }), register), 'UNQUALIFIED_CAPACITY'));
  it('rejects invalid posting windows', () => refuses(qualifyWatch(order({ postingWindowSeconds: 0 }), capacity(), register), 'WATCH_WINDOW_INVALID'));
  it('rejects a gap window shorter than cadence', () => refuses(qualifyWatch(order({ coverageGapAfterSeconds: 1 }), capacity(), register), 'WATCH_WINDOW_INVALID'));
  it('rejects extra order fields', () => refuses(qualifyWatch(order({ subject: 'fixture' }), capacity(), register), 'INVALID_WATCH'));
});

describe('seat value qualification is separate from the preregistered continue criterion', () => {
  it('qualifies non-builder demand plus documented payment', () => assert.equal(qualifySeatValue(demand(), AT).status, 'qualified'));
  it('also accepts explicitly buyer-validated value', () => assert.equal(qualifySeatValue(demand({ valueEvidence: valueEvidence({ kind: 'buyer_validated_value' }) }), AT).status, 'qualified'));
  it('a builder cannot validate their own demand', () => refuses(qualifySeatValue(demand({ nonBuilder: false }), AT), 'BUILDER_IS_NOT_BUYER'));
  it('three copies of one return day are not three returns', () => refuses(qualifySeatValue(demand({ unpromptedReturnDays: Array(3).fill('2026-09-20') }), AT), 'DEMAND_NOT_OBSERVED'));
  it('future dates are not observed returns', () => refuses(qualifySeatValue(demand({ unpromptedReturnDays: ['2027-01-01', '2027-01-02', '2027-01-03'] }), AT), 'DEMAND_NOT_OBSERVED'));
  it('a finding in an outside work product qualifies the demand limb', () => assert.equal(qualifySeatValue(demand({ unpromptedReturnDays: [], findingRefs: ['fixture:memo'] }), AT).status, 'qualified'));
  it('ten distinct addressed misses qualify the demand limb', () => assert.equal(qualifySeatValue(demand({ unpromptedReturnDays: [], addressedMissQueryIds: Array.from({ length: 10 }, (_, i) => `fixture:miss:${i}`) }), AT).status, 'qualified'));
  it('duplicate misses do not create ten queries', () => refuses(qualifySeatValue(demand({ unpromptedReturnDays: [], addressedMissQueryIds: Array(10).fill('fixture:miss') }), AT), 'DEMAND_NOT_OBSERVED'));
  for (const change of [{ currency: 'CAD' }, { amountMinor: 999_999 }, { amountMinor: Infinity }, { kind: 'builder_estimate' }, { termRef: '' }, { scopeRef: '' }, { evidenceRef: '' }]) it(`refuses unsupported value evidence ${JSON.stringify(change)}`, () => refuses(qualifySeatValue(demand({ valueEvidence: valueEvidence(change) }), AT), 'VALUE_NOT_VALIDATED'));
  it('invalid evidence fails closed', () => refuses(qualifySeatValue(null, AT), 'INVALID_SEAT_EVIDENCE'));
  it('invalid evaluation time fails closed', () => refuses(qualifySeatValue(demand(), 'today'), 'INVALID_TIME'));
});
