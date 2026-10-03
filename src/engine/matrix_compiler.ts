import { createHash, randomUUID } from 'node:crypto';
import type {
  AsynchronousStateVector,
  GeospatialFrameMatrix,
  StateSpaceAdmission,
  StateSpaceRefusalReason,
  StateSpaceTransition,
  StateSpaceValueKind,
} from '../types/state_space';

export const SYNTHETIC_STATE_SPACE_SOURCE = 'synthetic:state-space-demo';
const ALGORITHM = 'gsc:state-space:weighted-sum:v1';
const VECTOR_DOMAIN = 'gsc:state-space-vector:v1';
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const VALUE_KINDS: readonly StateSpaceValueKind[] = [
  'official_record', 'curated_representative', 'synthetic', 'research_only',
];
const FORBIDDEN_KEYS = new Set([
  'phone', 'phonenumber', 'email', 'emailaddress', 'name', 'fullname',
  'firstname', 'lastname', 'handle', 'username', 'personid', 'deviceid',
  'subscriberid', 'householdid', 'maid', 'advertisingid',
]);
const VECTOR_KEYS = new Set([
  'provenance', 'valueKind', 'knownAt', 'rowHash', 'entityToken', 'stateTensor',
]);
const PROVENANCE_KEYS = new Set([
  'sourceId', 'sourceName', 'sourceUrl', 'retrievedAt', 'sourceRef', 'artifactId', 'note',
]);
const FRAME_KEYS = new Set(['arrayNodeId', 'spatialBoundingBox', 'nodeCapacityWeight']);

type VectorDraft = Omit<AsynchronousStateVector, 'rowHash'> & { rowHash?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Accept ISO instants with Z or an explicit offset; reject rolled-over dates. */
function isInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return false;
  const zone = match[4];
  const offset = zone === 'Z' ? 0 :
    (zone[0] === '+' ? 1 : -1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
  const local = new Date(milliseconds + offset * 60_000).toISOString();
  return local === `${match[1]}T${match[2]}.${(match[3] ?? '').padEnd(3, '0')}Z`;
}

/** Defensive field/shape scan. It cannot establish what anonymous numbers mean. */
function hasForbiddenFields(root: unknown): boolean {
  const seen = new WeakSet<object>();
  const stack: unknown[] = [root];
  let visited = 0;
  while (stack.length > 0) {
    if (++visited > 100_000) return true;
    const value = stack.pop();
    if (value === null || typeof value !== 'object') continue;
    if (seen.has(value)) return true;
    seen.add(value);
    if (!Array.isArray(value) && !isRecord(value)) return true;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return true;
      const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
      if (FORBIDDEN_KEYS.has(normalized)) return true;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) return true;
      stack.push(descriptor.value);
    }
  }
  return false;
}

function finiteArray(value: unknown): value is number[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  // Sparse arrays and named/symbol properties cannot silently disappear in JSON.
  if (Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let i = 0; i < value.length; i += 1) {
    if (!Object.hasOwn(value, i) || typeof value[i] !== 'number' || !Number.isFinite(value[i])) return false;
  }
  return true;
}

function isVector(value: unknown, requireHash: boolean): value is AsynchronousStateVector {
  if (!isRecord(value) || Object.keys(value).some(key => !VECTOR_KEYS.has(key))) return false;
  if (!text(value.entityToken) || !finiteArray(value.stateTensor) || !isInstant(value.knownAt)) return false;
  if (!VALUE_KINDS.includes(value.valueKind as StateSpaceValueKind)) return false;
  if (requireHash && (typeof value.rowHash !== 'string' || !HASH_PATTERN.test(value.rowHash))) return false;
  const provenance = value.provenance;
  if (!isRecord(provenance) || Object.keys(provenance).some(key => !PROVENANCE_KEYS.has(key))) return false;
  if (!text(provenance.sourceId) || !text(provenance.sourceName) || !isInstant(provenance.retrievedAt)) return false;
  return Object.values(provenance).every(item => typeof item === 'string');
}

function isFrame(value: unknown): value is GeospatialFrameMatrix {
  if (!isRecord(value) || Object.keys(value).some(key => !FRAME_KEYS.has(key))) return false;
  if (!text(value.arrayNodeId) || !finiteArray(value.spatialBoundingBox) || value.spatialBoundingBox.length !== 4) return false;
  const [minX, minY, maxX, maxY] = value.spatialBoundingBox;
  return minX <= maxX && minY <= maxY &&
    typeof value.nodeCapacityWeight === 'number' &&
    Number.isFinite(value.nodeCapacityWeight) && value.nodeCapacityWeight >= 0;
}

/** Called only on validated plain JSON data; recursive object order is stable. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  const result = JSON.stringify(value);
  if (result === undefined) throw new TypeError('Expected a JSON value.');
  return result;
}

function digest(domain: string, value: unknown): string {
  return createHash('sha256').update(`${domain}\0${canonicalJson(value)}`, 'utf8').digest('hex');
}

/** Content hash for this vector contract, not a migration of existing GSC hashes. */
export function hashStateVector(vector: VectorDraft): string {
  if (hasForbiddenFields(vector) || !isVector(vector, false)) {
    throw new TypeError('A state vector must be finite, plain industrial/synthetic JSON.');
  }
  return digest(VECTOR_DOMAIN, {
    provenance: vector.provenance,
    valueKind: vector.valueKind,
    knownAt: vector.knownAt,
    entityToken: vector.entityToken,
    stateTensor: vector.stateTensor,
  });
}

/**
 * Server-side, deterministic scalar-weighted simulation; no database lookup,
 * occupancy inference, geometric intersection, temporal fusion, or ESM writes.
 * Non-synthetic rows need exact, trusted upstream admission. Synthetic fixtures
 * are explicitly marked and do not establish source authenticity or anonymity.
 */
export class StateSpaceMatrixCompiler {
  private refusalCount = 0;
  private readonly admittedRows: ReadonlySet<string>;

  public constructor(admissions: readonly StateSpaceAdmission[] = []) {
    const keys = new Set<string>();
    for (const admission of admissions) {
      if (!text(admission.sourceId) || !HASH_PATTERN.test(admission.rowHash)) {
        throw new TypeError('Admission requires a source ID and lowercase SHA-256 row hash.');
      }
      keys.add(JSON.stringify([admission.sourceId, admission.rowHash]));
    }
    this.admittedRows = keys;
  }

  public getRefusalCount(): number {
    return this.refusalCount;
  }

  private violatesDataFence(vector: AsynchronousStateVector): boolean {
    return hasForbiddenFields(vector);
  }

  private refuse(reason: StateSpaceRefusalReason): StateSpaceTransition {
    this.refusalCount += 1;
    // Do not retain or echo rejected identifiers, hashes, values, or provenance.
    return {
      transitionId: `state-space:refused:${randomUUID()}`,
      compiledDensityIndex: 0,
      confidenceWeight: 0,
      verdict: 'refused',
      mode: 'simulation',
      confidenceBasis: 'not_estimated',
      inputRowHash: null,
      inputValueKind: null,
      refusalReason: reason,
    };
  }

  public compileStateIntersection(
    vector: AsynchronousStateVector,
    frame: GeospatialFrameMatrix,
  ): StateSpaceTransition {
    try {
      if (this.violatesDataFence(vector) || hasForbiddenFields(frame)) {
        return this.refuse('data_fence_violation');
      }
      if (!isVector(vector, true) || !isFrame(frame)) return this.refuse('invalid_input');
      if (hashStateVector(vector) !== vector.rowHash) return this.refuse('row_hash_mismatch');
      const isSyntheticFixture = vector.valueKind === 'synthetic' &&
        vector.provenance.sourceId === SYNTHETIC_STATE_SPACE_SOURCE;
      if (!isSyntheticFixture && !this.admittedRows.has(JSON.stringify([vector.provenance.sourceId, vector.rowHash]))) {
        return this.refuse('source_not_admitted');
      }

      // Neumaier summation limits cancellation error; raw products are not clamped.
      let sum = 0;
      let correction = 0;
      for (const component of vector.stateTensor) {
        const term = component * frame.nodeCapacityWeight;
        const next = sum + term;
        if (!Number.isFinite(term) || !Number.isFinite(next)) return this.refuse('numeric_overflow');
        correction += Math.abs(sum) >= Math.abs(term) ? (sum - next) + term : (term - next) + sum;
        if (!Number.isFinite(correction)) return this.refuse('numeric_overflow');
        sum = next;
      }
      const total = sum + correction;
      if (!Number.isFinite(total)) return this.refuse('numeric_overflow');
      const compiledDensityIndex = Object.is(total, -0) ? 0 : total;
      return {
        transitionId: `state-space:${digest(ALGORITHM, { inputRowHash: vector.rowHash, frame })}`,
        compiledDensityIndex,
        confidenceWeight: 0,
        verdict: compiledDensityIndex > 0.75 ? 'held' : compiledDensityIndex > 0.35 ? 'strained' : 'unproven',
        mode: 'simulation',
        confidenceBasis: 'not_estimated',
        inputRowHash: vector.rowHash,
        inputValueKind: vector.valueKind,
        refusalReason: null,
      };
    } catch {
      return this.refuse('invalid_input');
    }
  }
}
