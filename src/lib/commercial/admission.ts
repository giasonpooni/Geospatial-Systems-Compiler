import {
  COMMERCIAL_SKUS, DELIVERY_BY_SKU, OBJECT_KINDS, PURPOSES,
  SEAT_VALUE_TEST, WATCH_EVENT_CLASSES, WATCH_TRIGGERS,
} from './catalog';
import type { Delivery, Scope, Sku } from './catalog';

export interface Issue { code: string; path: string; remedy: string }
export interface Admission { status: 'qualified' | 'refused'; issues: Issue[] }
type RecordValue = Record<string, unknown>;
const record = (v: unknown): v is RecordValue => v !== null && typeof v === 'object' && !Array.isArray(v);
const token = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,199}$/.test(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.length <= 10_000 && v.every(token) && new Set(v).size === v.length;
const exact = (v: RecordValue, keys: string[]) => Object.keys(v).every(k => keys.includes(k)) && keys.every(k => Object.hasOwn(v, k));
const scope = (v: unknown): v is Scope => record(v) && exact(v, ['kind', 'id']) && ['commodity', 'corridor', 'region', 'portfolio'].includes(String(v.kind)) && token(v.id);
const result = (issues: Issue[]): Admission => ({ status: issues.length ? 'refused' : 'qualified', issues });
const issue = (code: string, path: string, remedy: string): Issue => ({ code, path, remedy });

/** UTC only; reject rolled-over dates, missing zones, Infinity and invalid instants. */
function instant(v: unknown): number | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v)) return null;
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString() === v.replace(/(?<!\.\d{3})Z$/, '.000Z') ? ms : null;
}

export interface CommercialRequest {
  sku: Sku; delivery: Delivery; customerOrgId: string; scope: Scope;
  purpose: typeof PURPOSES[number]; objectKinds: string[]; sourceIds: string[];
  derived: boolean;
}

/** Server/operator-held evidence. Never accept these grants from a customer's request body.
 * Scope is exact; no wildcard, inherited permission or implied public-data exemption.
 * The active registry must select one current record per source/customer (including revocations).
 */
export interface SourceGrant {
  sourceId: string; customerOrgId: string;
  status: 'approved' | 'pending' | 'research_only' | 'revoked';
  subjects: 'industrial_objects' | 'natural_persons' | 'mixed' | 'unknown';
  sourceRegistryAccepted: boolean;
  scopeKeys: string[]; permissions: Delivery[]; derivedAllowed: boolean;
  termsRef: string; reviewRef: string; snapshotRef: string;
  startsAt: string; expiresAt: string;
}

/** Pure preflight only: does not authenticate, grant rights, deliver data or verify legal documents.
 * sourceIds must come from the producer's complete transitive provenance, not a user-selected subset.
 * Existing collection/source/route gates remain mandatory independent gates.
 */
export function qualifyDelivery(request: unknown, grants: unknown, at: string): Admission {
  const issues: Issue[] = [];
  const now = instant(at);
  if (now === null) return result([issue('INVALID_TIME', 'at', 'Supply a valid UTC evaluation instant.')]);
  if (!record(request) || !exact(request, ['sku', 'delivery', 'customerOrgId', 'scope', 'purpose', 'objectKinds', 'sourceIds', 'derived'])) {
    return result([issue('INVALID_REQUEST', 'request', 'Supply only the typed commercial request fields; no additional subject or query fields.')]);
  }
  const sku = COMMERCIAL_SKUS.find(s => s.id === request.sku)?.id;
  if (!sku || !DELIVERY_BY_SKU[sku].includes(request.delivery as Delivery)) issues.push(issue('SKU_DELIVERY_MISMATCH', 'delivery', 'Use the separate seat, feed or watch contract for this delivery.'));
  if (!token(request.customerOrgId) || !scope(request.scope)) issues.push(issue('INVALID_SCOPE', 'scope', 'Name one customer organisation and one typed, retained scope.'));
  else if (sku && !(sku === 'seat' ? ['commodity', 'corridor'] : sku === 'feed' ? ['commodity', 'corridor', 'region'] : ['portfolio']).includes(request.scope.kind)) issues.push(issue('SKU_SCOPE_MISMATCH', 'scope', 'Seat: one commodity/corridor. Feed: commodity/corridor/region. Watch: retained customer-object portfolio.'));
  if (!PURPOSES.includes(request.purpose as typeof PURPOSES[number])) issues.push(issue('PURPOSE_REFUSED', 'purpose', 'Use a supported industrial-object purpose.'));
  if (!strings(request.objectKinds) || !request.objectKinds.every(k => OBJECT_KINDS.includes(k as typeof OBJECT_KINDS[number]))) {
    issues.push(issue('SUBJECT_REFUSED', 'objectKinds', 'Declare only permitted industrial-object kinds; unknown, mixed or natural-person requests are refused.'));
  } else if (request.purpose === 'object_sanctions' && request.objectKinds.some(k => !['organisation', 'vessel', 'aircraft'].includes(k))) {
    issues.push(issue('SANCTIONS_SUBJECT_REFUSED', 'objectKinds', 'Sanctions screening is restricted to organisations, vessels and aircraft.'));
  }
  if (!strings(request.sourceIds) || typeof request.derived !== 'boolean') issues.push(issue('INVALID_PROVENANCE', 'sourceIds', 'Supply unique source IDs from complete retained lineage and an explicit derived flag.'));
  if (!Array.isArray(grants)) issues.push(issue('INVALID_GRANT_REGISTRY', 'grants', 'Load the reviewed, server-held grant registry.'));
  if (issues.length) return result(issues);
  const r = request as unknown as CommercialRequest;
  for (const sourceId of r.sourceIds) {
    const matches = (grants as unknown[]).filter(g => record(g) && g.sourceId === sourceId && g.customerOrgId === r.customerOrgId) as RecordValue[];
    if (matches.length !== 1) {
      issues.push(issue(matches.length ? 'AMBIGUOUS_GRANT' : 'MISSING_GRANT', sourceId, 'Retain exactly one reviewed current source/customer grant; absence is not permission.'));
      continue;
    }
    const g = matches[0];
    if (g.sourceRegistryAccepted !== true || g.subjects !== 'industrial_objects') issues.push(issue('SOURCE_POLICY_REFUSED', sourceId, 'A source must pass the existing registry and yield industrial-object data only.'));
    if (g.status !== 'approved') issues.push(issue('RIGHTS_NOT_APPROVED', sourceId, 'Research-only, pending and revoked rights cannot qualify a paid delivery.'));
    if (![g.termsRef, g.reviewRef, g.snapshotRef].every(token)) issues.push(issue('MISSING_RIGHTS_EVIDENCE', sourceId, 'Retain terms, a review decision and the exact source vintage; use opaque references, not private contract text.'));
    const start = instant(g.startsAt), end = instant(g.expiresAt);
    if (start === null || end === null || start >= end || now < start || now >= end) issues.push(issue('RIGHTS_OUTSIDE_WINDOW', sourceId, 'Use an effective, unexpired reviewed grant; expiry is exclusive.'));
    if (!strings(g.scopeKeys) || !g.scopeKeys.includes(`${r.scope.kind}:${r.scope.id}`)) issues.push(issue('RIGHTS_SCOPE_MISMATCH', sourceId, 'Obtain rights for this exact contracted scope.'));
    if (!strings(g.permissions) || !g.permissions.every(p => ['seat_display', 'memo_export', 'bulk_feed', 'watch_alert'].includes(p)) || !g.permissions.includes(r.delivery)) issues.push(issue('DELIVERY_NOT_LICENSED', sourceId, 'Record explicit rights for the requested display, export, feed or alert use.'));
    if (r.derived && g.derivedAllowed !== true) issues.push(issue('DERIVED_NOT_LICENSED', sourceId, 'A derived label does not remove upstream restrictions.'));
  }
  return result(issues);
}

/** Additional bounded watch-order qualification, not a scheduler or a scale claim. */
export function qualifyWatch(order: unknown, measuredCapacity: unknown, objectRegister: unknown): Admission {
  const issues: Issue[] = [];
  if (!record(order) || !exact(order, ['objectIds', 'eventClasses', 'triggers', 'cadenceSeconds', 'coverageGapAfterSeconds', 'postingWindowSeconds']) || !record(measuredCapacity) || !exact(measuredCapacity, ['maxObjects', 'minCadenceSeconds', 'evidenceRef'])) {
    return result([issue('INVALID_WATCH', 'watch', 'Provide the bounded order and an independently retained capacity qualification.')]);
  }
  if (!strings(order.objectIds) || !order.objectIds.every(id => id.startsWith('ent:'))) issues.push(issue('WATCH_IDENTITIES_REFUSED', 'objectIds', 'Use unique, already-resolved industrial ent: IDs. Resolve candidates separately; do not manufacture merges.'));
  if (!Array.isArray(objectRegister)) issues.push(issue('MISSING_OBJECT_REGISTER', 'objects', 'Supply a trusted register of resolved industrial objects; an ent: prefix is not resolution evidence.'));
  else if (Array.isArray(order.objectIds)) {
    for (const id of order.objectIds) {
      const matches = objectRegister.filter(o => record(o) && o.id === id);
      if (matches.length !== 1 || !record(matches[0]) || matches[0].resolution !== 'resolved' || !OBJECT_KINDS.includes(matches[0].objectKind as typeof OBJECT_KINDS[number]) || !token(matches[0].evidenceRef)) issues.push(issue('WATCH_OBJECT_UNRESOLVED', 'objectIds', 'Every watched ID needs one resolved object-only register entry and retained identity evidence. Candidates and ambiguous mappings remain unresolved.'));
    }
  }
  for (const [key, allowed] of [['eventClasses', WATCH_EVENT_CLASSES], ['triggers', WATCH_TRIGGERS]] as const) {
    const value = order[key];
    if (!strings(value) || !value.every(v => (allowed as readonly string[]).includes(v))) issues.push(issue('WATCH_CLASS_REFUSED', key, 'Use the explicit event-class and trigger vocabulary.'));
  }
  if (!Array.isArray(order.triggers) || !order.triggers.includes('coverage_gap')) issues.push(issue('COVERAGE_GAP_REQUIRED', 'triggers', 'Coverage gaps must remain visible even when no excursion is detected.'));
  const positive = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
  if (!positive(measuredCapacity.maxObjects) || !positive(measuredCapacity.minCadenceSeconds) || !token(measuredCapacity.evidenceRef)) issues.push(issue('UNQUALIFIED_CAPACITY', 'capacity', 'Retain a load-test reference and positive qualified object/cadence limits.'));
  else {
    if (Array.isArray(order.objectIds) && order.objectIds.length > measuredCapacity.maxObjects) issues.push(issue('WATCH_CAPACITY_EXCEEDED', 'objectIds', 'Reduce the set or qualify higher capacity before quoting it.'));
    if (!positive(order.cadenceSeconds) || order.cadenceSeconds < measuredCapacity.minCadenceSeconds) issues.push(issue('WATCH_CADENCE_UNQUALIFIED', 'cadenceSeconds', 'Use a positive cadence no faster than the measured capacity supports.'));
  }
  if (!positive(order.coverageGapAfterSeconds) || !positive(order.postingWindowSeconds) || !positive(order.cadenceSeconds) || order.coverageGapAfterSeconds < order.cadenceSeconds) issues.push(issue('WATCH_WINDOW_INVALID', 'windows', 'Declare positive posting and gap windows; a gap window cannot be shorter than the polling cadence.'));
  return result(issues);
}

/** Evidence summaries are supplied by a trusted operator from private demand logs.
 * This is NOT a reimplementation or amendment of CONTINUE_CRITERION.md.
 */
export function qualifySeatValue(evidence: unknown, at: string): Admission {
  const now = instant(at);
  if (now === null) return result([issue('INVALID_TIME', 'at', 'Supply a valid UTC evaluation instant.')]);
  if (!record(evidence) || !exact(evidence, ['nonBuilder', 'unpromptedReturnDays', 'findingRefs', 'addressedMissQueryIds', 'valueEvidence'])) return result([issue('INVALID_SEAT_EVIDENCE', 'evidence', 'Supply the separate commercial evidence summary.')]);
  const issues: Issue[] = [];
  if (evidence.nonBuilder !== true) issues.push(issue('BUILDER_IS_NOT_BUYER', 'nonBuilder', 'Obtain non-builder evidence.'));
  const unique = (v: unknown) => Array.isArray(v) && v.every(token) ? new Set(v).size : 0;
  const days = evidence.unpromptedReturnDays;
  const returnCount = Array.isArray(days) && days.every(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && instant(`${d}T00:00:00Z`) !== null && instant(`${d}T00:00:00Z`)! <= now) ? new Set(days).size : 0;
  if (returnCount < 3 && unique(evidence.findingRefs) < 1 && unique(evidence.addressedMissQueryIds) < 10) issues.push(issue('DEMAND_NOT_OBSERVED', 'demand', 'Record three distinct unprompted return days, a finding used in outside work, or ten distinct non-builder misses naming registered sources.'));
  const v = evidence.valueEvidence;
  if (!record(v) || !exact(v, ['kind', 'currency', 'amountMinor', 'evidenceRef', 'scopeRef', 'termRef']) || !['paid', 'buyer_validated_value'].includes(String(v.kind)) || v.currency !== SEAT_VALUE_TEST.currency || typeof v.amountMinor !== 'number' || !Number.isSafeInteger(v.amountMinor) || v.amountMinor < SEAT_VALUE_TEST.amountMinor || ![v.evidenceRef, v.scopeRef, v.termRef].every(token)) {
    issues.push(issue('VALUE_NOT_VALIDATED', 'valueEvidence', 'Record payment or buyer-validated value near the USD 10,000 planning target, with explicit scope and term; no implicit currency conversion or annualisation.'));
  }
  return result(issues);
}
