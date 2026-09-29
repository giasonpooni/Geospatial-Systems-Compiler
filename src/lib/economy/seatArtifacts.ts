/** Durable extension of sessionTelemetry. No raw text, headers or requester identifiers.
 * Misses share the EXISTING search-misses.jsonl; old rows remain untouched and are
 * counted as legacy on read, never re-published as raw text. This is an operator
 * journal, not evidence that somebody paid, returned unprompted, or is a non-builder.
 */
import { randomUUID } from 'node:crypto';
import { open, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { EconomyState } from './types';
import { SOURCE_REGISTRY } from './sourceRegistry';
import { env } from './envCompat';

export const seatDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
});
const context = {
  sessionId: z.uuid(), // assigned opaque session token, not a name or an email
  commodity: z.enum(['copper', 'aluminium']),
  asOf: seatDate.nullable(),
  knowledge: z.enum(['best_known', 'as_known_then']),
  entityIds: z.array(z.string().max(180).regex(/^ent:(?:mine|smelter|refinery|port|manufacturer|region|country|commodity|infrastructure|company):[a-z0-9:_-]+$/)).max(64),
};
export const seatContext = z.strictObject(context);
const question = z.enum(['inspect', 'production', 'trade', 'stocks', 'price', 'positioning', 'events', 'ownership', 'coverage', 'basis', 'resolution']);
export const seatArtifactInput = z.discriminatedUnion('kind', [
  z.strictObject({ ...context, kind: z.literal('query'), question }),
  z.strictObject({ ...context, kind: z.literal('miss'), question, gapIds: z.array(z.string().regex(/^[a-z0-9-]+$/)).max(16) }),
  z.strictObject({ ...context, kind: z.literal('refusal'), question,
    reason: z.enum(['policy', 'unresolved_identifier', 'basis_refused', 'coverage_gap']) }),
]);
export type SeatArtifactInput = z.infer<typeof seatArtifactInput>;
const envelope = z.object({ schema: z.literal('seat-artifact.v1'), id: z.uuid(), ts: z.iso.datetime(),
  origin: z.enum(['operator_recorded', 'served_projection']) });
export type SeatArtifact = SeatArtifactInput & z.infer<typeof envelope>;
const files = { query: 'session-inspections.jsonl', miss: 'search-misses.jsonl', refusal: 'refusal-records.jsonl' } as const;
const directory = () => env('PAYLOAD_MISS_LOG_DIR') ?? join(process.cwd(), 'data-archive');
const REFUSAL_REMEDIES = {
  policy: 'Keep the request on industrial objects and permitted ledgers.',
  unresolved_identifier: 'Supply authoritative industrial identifiers; similarity never establishes a merge.',
  basis_refused: 'Supply compatible units and a supported quantity basis or an evidenced conversion.',
  coverage_gap: 'Name a registered source or a knowable vintage that covers the missing scope.',
} as const;
export function artifactRemedy(record: SeatArtifact): string | null {
  return record.kind === 'refusal' ? REFUSAL_REMEDIES[record.reason] : null;
}
export function validateSeatArtifact(input: unknown, state: EconomyState): SeatArtifactInput {
  const parsed = seatArtifactInput.safeParse(input);
  if (!parsed.success) throw new Error('seat_artifact_invalid');
  const value = parsed.data;
  if (state.commodity !== value.commodity || (value.knowledge === 'as_known_then' && !value.asOf)) throw new Error('seat_frame_invalid');
  const ids = new Set(state.entities.map(e => e.id));
  if (new Set(value.entityIds).size !== value.entityIds.length || value.entityIds.some(id => !ids.has(id))) throw new Error('unresolved_identifier');
  if (value.kind === 'miss' && (new Set(value.gapIds).size !== value.gapIds.length || value.gapIds.some(id => !SOURCE_REGISTRY.some(s => s.sourceId === id)))) throw new Error('unregistered_source');
  return value;
}
export async function appendSeatArtifact(input: unknown, state: EconomyState, origin: SeatArtifact['origin'] = 'operator_recorded'): Promise<SeatArtifact> {
  const value = validateSeatArtifact(input, state);
  // Synthetic sessions never enter demand archives by accident.
  if ((process.env.VITEST || process.env.NODE_ENV === 'test') && env('PAYLOAD_FORCE_MISS_LOG') !== '1') throw new Error('seat_recording_disabled_under_test');
  const record: SeatArtifact = { ...value, schema: 'seat-artifact.v1', id: randomUUID(), ts: new Date().toISOString(), origin };
  await mkdir(directory(), { recursive: true });
  const handle = await open(join(directory(), files[value.kind]), 'a', 0o600);
  try {
    await handle.writeFile(JSON.stringify(record) + '\n');
    await handle.sync(); // a 201 means the write actually completed, not best-effort
  } finally { await handle.close(); }
  return record;
}
function parseStored(value: unknown): SeatArtifact | null {
  if (!value || typeof value !== 'object') return null;
  const { schema, id, ts, origin, ...body } = value as Record<string, unknown>;
  const head = envelope.safeParse({ schema, id, ts, origin });
  const payload = seatArtifactInput.safeParse(body);
  if (!head.success || !payload.success) return null;
  return { ...head.data, ...payload.data };
}
export interface SeatArtifactPage {
  records: SeatArtifact[];
  accounting: { fetchedRows: number; accepted: number; filtered: Record<string, number>; rejected: number };
  nextOffset: number | null;
  /** A bounded physical-line cursor, not the misleading count of returned rows. */
  scannedThrough: number;
}
export async function readSeatArtifacts(kind: SeatArtifactInput['kind'], sessionId: string, offset = 0, limit = 100): Promise<SeatArtifactPage> {
  if (!Object.hasOwn(files, kind) || !z.uuid().safeParse(sessionId).success || !Number.isSafeInteger(offset) || offset < 0 || offset > 100_000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('seat_cursor_invalid');
  const page: SeatArtifactPage = { records: [], accounting: { fetchedRows: 0, accepted: 0, filtered: { legacy: 0, other_session: 0, wrong_kind: 0 }, rejected: 0 }, nextOffset: null, scannedThrough: offset };
  // Refuse unbounded journals rather than silently read an arbitrarily large line/file.
  let handle;
  try { handle = await open(join(directory(), files[kind]), 'r'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return page; throw error; }
  const stat = await handle.stat();
  if (stat.size > 16 * 1024 * 1024) { await handle.close(); throw new Error('seat_journal_rotation_required'); }
  // Bounded snapshot of bytes observed at open; appends are read next time.
  const buffer = Buffer.alloc(stat.size);
  let bytes = 0;
  try {
    while (bytes < stat.size) {
      const { bytesRead } = await handle.read(buffer, bytes, stat.size - bytes, bytes);
      if (!bytesRead) break;
      bytes += bytesRead;
    }
  } finally { await handle.close(); }
  const text = buffer.subarray(0, bytes).toString('utf8');
  const lastNewline = text.lastIndexOf('\n');
  const complete = lastNewline < 0 ? [] : text.slice(0, lastNewline).split('\n');
  for (let index = offset; index < complete.length; index++) {
    const line = complete[index];
    page.scannedThrough = index + 1;
    page.accounting.fetchedRows++;
    if (line.length > 16_384) page.accounting.rejected++;
    else {
      try {
        const value: unknown = JSON.parse(line);
        if (value && typeof value === 'object' && !Object.hasOwn(value, 'schema')) page.accounting.filtered.legacy++;
        else {
          const record = parseStored(value);
          if (!record) page.accounting.rejected++;
          else if (record.kind !== kind) page.accounting.filtered.wrong_kind++;
          else if (record.sessionId !== sessionId) page.accounting.filtered.other_session++;
          else { page.records.push(record); page.accounting.accepted++; }
        }
      } catch { page.accounting.rejected++; }
    }
    if (page.records.length >= limit || page.accounting.fetchedRows >= 1000) { page.nextOffset = index + 1; break; }
  }
  if (lastNewline < text.length - 1 && page.nextOffset === null) {
    // A partial trailing append has not become a complete row. Do not advance past it.
    page.accounting.filtered.partial_tail = 1;
    page.accounting.fetchedRows++;
    page.nextOffset = complete.length;
  }
  return page;
}
