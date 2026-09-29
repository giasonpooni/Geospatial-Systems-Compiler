import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getEconomyState } from '@/lib/economy/store';
import { SOURCE_REGISTRY } from '@/lib/economy/sourceRegistry';
import { seatProjection, SeatRefusal } from '@/lib/economy/seatProjection';
import { appendSeatArtifact, readSeatArtifacts } from '@/lib/economy/sessionTelemetry';
import { seatArtifactInput, seatDate, artifactRemedy } from '@/lib/economy/seatArtifacts';
import { authorizeOperationsSurface } from '@/lib/economy/operationsHttpAuth';
import { isMachineClient } from '@/lib/economy/machineClient';

/** Pipe 1, industrial-object seat. No raw query field is accepted or retained.
 * Sensor cards and record counts are read projections, not a new intel application.
 * Journals use the EXISTING operator Bearer authority, not a new authentication product.
 */
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers });
const querySchema = z.strictObject({
  view: z.enum(['projection', 'sensors', 'artifacts']).default('projection'),
  commodity: z.enum(['copper', 'aluminium']).default('copper'),
  asOf: seatDate.optional(), knowledge: z.enum(['best_known', 'as_known_then']).default('best_known'),
  corridorId: z.string().regex(/^flow:[a-z0-9:_-]+$/).max(200).optional(),
  sessionId: z.uuid().optional(), kind: z.enum(['query', 'miss', 'refusal']).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => params.getAll(key).length !== 1)) return json({ error: 'seat_parameters_invalid' }, 400);
  const parsed = querySchema.safeParse(Object.fromEntries(params));
  if (!parsed.success) return json({ error: 'seat_parameters_invalid' }, 400);
  const q = parsed.data;
  if (q.knowledge === 'as_known_then' && !q.asOf) return json({ error: 'seat_knowledge_cutoff_required' }, 400);
  if (q.view === 'sensors') return json({ schema: 'sensor-ledger.v1', sources: SOURCE_REGISTRY.map(s => ({ sourceId: s.sourceId, adapter: s.adapter, additionalAdapters: s.additionalAdapters ?? [], sensor: s.sensor })) });
  if (q.view === 'artifacts' || q.sessionId) {
    const denied = authorizeOperationsSurface(request);
    if (denied) { denied.headers.set('Cache-Control', 'no-store'); return denied; }
  }
  if (q.view === 'artifacts') {
    if (!q.sessionId || !q.kind) return json({ error: 'seat_session_and_kind_required' }, 400);
    try {
      const page = await readSeatArtifacts(q.kind, q.sessionId, q.offset, q.limit);
      return json({ ...page, remedies: page.records.map(r => ({ id: r.id, remedy: artifactRemedy(r) })), note: 'Operator journal, not verified non-builder demand. Legacy raw text is never served.' });
    } catch { return json({ error: 'seat_journal_unavailable', remedy: 'Check the private archive and rotate oversized journals; no records were silently dropped.' }, 503); }
  }
  try {
    const assembled = await getEconomyState(q.commodity);
    const projection = seatProjection(assembled, { commodity: q.commodity, asOf: q.asOf ?? null, knowledge: q.knowledge, corridorId: q.corridorId });
    // Optional operator session recording. Anonymous research reads create no durable identity.
    let recording: { status: string; id?: string } = { status: 'not_requested' };
    if (q.sessionId && !isMachineClient(request)) {
      const entityIds = q.corridorId ? assembled.state.flows.filter(f => f.id === q.corridorId).flatMap(f => [f.fromEntityId, f.toEntityId]) : [];
      try {
        const record = await appendSeatArtifact({ kind: 'query', question: 'inspect', sessionId: q.sessionId, commodity: q.commodity, asOf: q.asOf ?? null, knowledge: q.knowledge, entityIds: [...new Set(entityIds)] }, assembled.state, 'served_projection');
        recording = { status: 'persisted', id: record.id };
      } catch { recording = { status: 'failed' }; }
    } else if (q.sessionId) recording = { status: 'machine_excluded' };
    return json({ ...projection, recording });
  } catch (error) {
    if (error instanceof SeatRefusal) return json({ error: error.code, remedy: error.remedy }, 422);
    return json({ error: 'seat_assembly_unavailable' }, 503);
  }
}
async function boundedBody(request: Request): Promise<unknown> {
  if (!request.body) throw new Error('empty_body');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) { await reader.cancel(); throw new Error('body_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function POST(request: Request) {
  const denied = authorizeOperationsSurface(request);
  if (denied) { denied.headers.set('Cache-Control', 'no-store'); return denied; }
  if (isMachineClient(request)) return json({ error: 'machine_demand_recording_refused' }, 403);
  if (new URL(request.url).search) return json({ error: 'seat_parameters_invalid' }, 400);
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return json({ error: 'json_required' }, 415);
  let input;
  try {
    const parsed = seatArtifactInput.safeParse(await boundedBody(request));
    if (!parsed.success) return json({ error: 'seat_artifact_invalid' }, 400);
    input = parsed.data;
  } catch { return json({ error: 'seat_body_invalid_or_too_large' }, 400); }
  try {
    const assembled = await getEconomyState(input.commodity);
    const record = await appendSeatArtifact(input, assembled.state);
    return json({ record, remedy: artifactRemedy(record), durability: 'fsynced_append', demandStatus: 'operator_recorded_not_independently_verified' }, 201);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (['seat_artifact_invalid', 'seat_frame_invalid', 'unresolved_identifier', 'unregistered_source'].includes(code)) return json({ error: code }, 422);
    return json({ error: 'seat_record_not_persisted' }, 503);
  }
}
