/** Two-clock, read-only record eligibility. No interpolation, unit conversion or admission. */
import { dataTree, deepFreeze } from './compat/gsv/validation';
import { attempt, object, requireThat, timeOrder, timeValue, validateIR } from './compiler';
import type { IRRecord, Interval, RepresentationIR, Result, TimeValue } from './ir';

export interface ReplayQuery {
  readonly at: TimeValue;
  readonly knownAt: TimeValue;
  /** Observation history is [from, at); applicability is evaluated at at. */
  readonly from: TimeValue;
}
export type ExclusionReason = 'not-known' | 'knowledge-time-missing' | 'outside-history' |
  'outside-applicability' | 'event-time-missing';
export interface TemporalSlice {
  readonly ir: RepresentationIR;
  readonly query: ReplayQuery;
  readonly excluded: readonly { recordId: string; reason: ExclusionReason }[];
  /** Known structure without declared applicability; not a claim of active physical state. */
  readonly contextOnly: readonly string[];
  readonly omittedLinks: number;
}

function checkedQuery(value: unknown): ReplayQuery {
  dataTree(value);
  const q = object(value, 'replay query');
  requireThat(Object.keys(q).length === 3 && ['at', 'knownAt', 'from'].every((k) => k in q),
    'INVALID_TIME', 'Replay requires exactly at, knownAt and from');
  for (const key of ['at', 'knownAt', 'from']) {
    const t = object(q[key], key);
    requireThat(Object.keys(t).length === 2 && timeValue(t.value).precision === t.precision,
      'INVALID_TIME', 'Replay cursor precision must match its value');
  }
  const result = q as unknown as ReplayQuery;
  requireThat(result.from.precision === result.at.precision && result.at.precision === result.knownAt.precision,
    'UNAVAILABLE_TIME', 'Mixed date/instant replay requires an explicit precision policy');
  requireThat(timeOrder(result.from, result.at) <= 0, 'INVALID_TIME', 'History start is after the event cursor');
  return result;
}
function contains(interval: Interval, time: TimeValue): boolean {
  if (interval.from !== null && timeOrder(time, interval.from) < 0) return false;
  if (interval.to !== null) {
    const order = timeOrder(time, interval.to);
    if (order > 0 || (order === 0 && interval.end === 'exclusive')) return false;
  }
  return true;
}
function overlapsHistory(interval: Interval, query: ReplayQuery): boolean {
  if (timeOrder(query.from, query.at) === 0) return false;
  if (interval.from !== null && timeOrder(interval.from, query.at) >= 0) return false;
  if (interval.to !== null) {
    const order = timeOrder(interval.to, query.from);
    if (order < 0 || (order === 0 && interval.end === 'exclusive')) return false;
  }
  return true;
}
function known(record: IRRecord, cutoff: TimeValue): ExclusionReason | null {
  if (record.knownAt === null) return 'knowledge-time-missing';
  if (timeOrder(record.knownAt, cutoff) > 0) return 'not-known';
  // A conflicting attached source-known time must not bypass the record cutoff.
  for (const p of record.provenance)
    if (p.knownAt !== null && timeOrder(p.knownAt, cutoff) > 0) return 'not-known';
  return null;
}

/**
 * Result records retain their original identities and normalized provenance. Raw
 * compatibility detail is intentionally not emitted: it may contain future
 * histories, revision payloads or unnormalized nested evidence. Inspecting the
 * full source is a different, explicitly unfiltered operation.
 */
export function selectTemporal(input: RepresentationIR, query: unknown): Result<TemporalSlice> {
  const checked = validateIR(input);
  if (!checked.ok) return checked;
  const selected = attempt('gsc.temporal-selection.v1', () => {
    const q = checkedQuery(query);
    const excluded: { recordId: string; reason: ExclusionReason }[] = [];
    const contextOnly: string[] = [];
    const eligible: IRRecord[] = [];
    for (const r of checked.value.records) {
      let reason = known(r, q.knownAt);
      let context = false;
      if (!reason && r.role === 'observation') {
        if (r.eventTime !== null) {
          if (timeOrder(r.eventTime, q.from) < 0 || timeOrder(r.eventTime, q.at) >= 0) reason = 'outside-history';
          else if (r.validity !== null && !contains(r.validity, r.eventTime)) reason = 'outside-applicability';
        } else if (r.period !== null) {
          if (!overlapsHistory(r.period, q)) reason = 'outside-history';
        } else reason = 'event-time-missing';
      } else if (!reason) {
        if (r.role === 'assertion' && r.eventTime !== null && timeOrder(r.eventTime, q.at) > 0)
          reason = 'outside-applicability';
        const applicability = r.role === 'event' ? r.period : r.applicability ?? null;
        if (applicability !== null && !contains(applicability, q.at)) reason = 'outside-applicability';
        if (r.validity !== null && !contains(r.validity, q.at)) reason = 'outside-applicability';
        context = applicability === null && r.validity === null;
      }
      if (reason) excluded.push({ recordId: r.id, reason });
      else {
        eligible.push(r);
        if (context) contextOnly.push(r.id);
      }
    }
    const ids = new Set(eligible.map((r) => r.id));
    let omittedLinks = 0;
    const records = eligible.map((r): IRRecord => {
      const links = r.links.filter((link) => ids.has(link.targetId));
      omittedLinks += r.links.length - links.length;
      return { ...r, links, sourceRecord: { id: r.source.recordId, detail: 'omitted-from-temporal-projection' } };
    });
    const ir = { ...checked.value, records };
    return deepFreeze({ ir, query: structuredClone(q), excluded, contextOnly, omittedLinks });
  });
  return { ...selected, diagnostics: [...checked.diagnostics, ...selected.diagnostics],
    passes: [...checked.passes, ...selected.passes] };
}
