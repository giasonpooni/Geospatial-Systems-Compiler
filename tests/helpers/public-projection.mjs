/** Hand-authored contract fixture; no ESM source records or private corpus bytes. */
import { projectionDigest } from '../../src/lib/explorer/esmProjection.ts';
export async function seal(p) {
  p.provenance.specDigest = await projectionDigest(p.spec);
  p.provenance.sourceSelectionDigest = await projectionDigest(p.records);
  const { digest, ...body } = p;
  p.digest = await projectionDigest(body);
  return p;
}
export const pin = p => ({ spec: structuredClone(p.spec), digest: p.digest });
export async function fixture() {
  const validity = { validFrom: '2026-01-01T00:00:00Z', validTo: '2027-01-01T00:00:00Z' };
  const subject = { subjectId: 'fixture-subject:one', canonicalId: 'notation://fixture/subject/one', subjectType: 'TEST_OBJECT' };
  const record = { recordId: 'fixture:one', canonicalId: 'notation://fixture/record/one', subject,
    title: 'Synthetic contract record', predicate: 'fixture.value', value: 0, unit: null, basis: 'Contract test only',
    validity, knownAt: '2026-01-01T00:00:00Z', evidenceClass: 'SYNTHETIC', visibility: 'PUBLIC_RULING',
    provenance: { sourceId: 'synthetic:contract-test' }, statusAtKnownAt: 'CURRENT', uncertainty: null,
    rights: { redistribution: 'public', attribution: 'Hand-authored integration test fixture' } };
  const second = structuredClone(record); second.recordId = 'fixture:two'; second.canonicalId = 'notation://fixture/record/two';
  second.title = 'Synthetic unplaced record';
  const p = { schema: 'payload.projection.v1', fixture_only: true,
    spec: { schema: 'payload.projection-spec.v1', source: { kind: 'CORPUS_RELEASE', corpusId: 'fixture:corpus',
      releaseId: 'fixture:release', releaseDigest: '1'.repeat(64), manifestCommitment: '2'.repeat(64), snapshotDigest: 'sha256:' + '3'.repeat(64) },
      selection: { recordIds: ['fixture:one', 'fixture:two'], knownAt: '2026-06-01T00:00:00.000Z', validAt: '2026-05-01T00:00:00.000Z' },
      view: { mode: 'GLOBE', coordinateSemantics: 'GEODETIC', representation: 'GLOBAL_3D' }, viewer: 'PUBLIC_RULING' },
    engine: 'CesiumJS', authority: 'REPLACEABLE_PROJECTION', status: 'READY', error: null,
    records: [record, second], graph: null,
    geometry: { datum: 'WGS84', positions: [{ recordId: record.recordId, positionRecordId: 'fixture:position',
      canonicalId: 'notation://fixture/position/one', subject: structuredClone(subject),
      shape: { kind: 'POINT', datum: 'WGS84', longitude: 12, latitude: 34 },
      point: { datum: 'WGS84', longitude: 12, latitude: 34, horizontalUncertaintyM: null },
      value: 'declared test position', basis: null, validity: structuredClone(validity), knownAt: record.knownAt,
      evidenceClass: 'SYNTHETIC', source: { sourceId: 'synthetic:contract-test', sourceName: 'Contract fixture' }, statusAtKnownAt: 'CURRENT' }], unplaced: ['fixture:two'] },
    provenance: { compilerId: 'payload.fixture-projection', compilerVersion: '1.1.0', transformIdentity: 'payload.projection/GLOBAL_3D/v1', specDigest: '', sourceSelectionDigest: '' },
    nonclaims: { sourceMutated: false, canonicalAdmission: false, relationInferred: false, positionInferred: false,
      sourceTruthClaimed: false, independentlyVerified: false, rendererExecuted: false }, digest: '' };
  return seal(p);
}
