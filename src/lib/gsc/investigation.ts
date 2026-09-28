import { dataTree, deepFreeze } from './compat/gsv/validation';
import { attempt, object, requireThat, timeValue, validateIR } from './compiler';
import type { Bindings, RepresentationIR, Result, TimeValue } from './ir';
import { VIEW_KINDS } from './projections';
import type { ViewKind } from './projections';

/** View context only; carrying a cursor does not implement temporal eligibility or replay. */
export interface InvestigationState {
  readonly compilationId: string;
  readonly bindings: Bindings;
  readonly selectedRecordId: string | null;
  readonly view: ViewKind;
  readonly eventCursor: TimeValue | null;
  readonly knowledgeCutoff: TimeValue | null;
}
export function beginInvestigation(input: RepresentationIR): Result<InvestigationState> {
  const checked = validateIR(input);
  if (!checked.ok) return checked;
  return { ...checked, value: deepFreeze({ compilationId: checked.value.compilationId, bindings: checked.value.bindings,
    selectedRecordId: null, view: 'table', eventCursor: null, knowledgeCutoff: null }) };
}
/** Strict commands change local selection only. Failures leave the caller's old state intact. */
export function transitionInvestigation(input: RepresentationIR, state: InvestigationState, command: unknown): Result<InvestigationState> {
  const checked = validateIR(input);
  if (!checked.ok) return checked;
  return attempt('gsc.investigation.transition.v1', () => {
    dataTree(state); dataTree(command);
    const ir = checked.value;
    requireThat(state.compilationId === ir.compilationId &&
      (['datasetId', 'snapshotId', 'releaseId', 'runId', 'modelId'] as const).every((key) => state.bindings[key] === ir.bindings[key]),
      'BINDING_MISMATCH', 'Investigation refers to a different compilation or upstream binding');
    requireThat(VIEW_KINDS.includes(state.view), 'UNSUPPORTED_REPRESENTATION', 'Unknown current view');
    requireThat(state.selectedRecordId === null || ir.records.some((r) => r.id === state.selectedRecordId), 'UNBOUND_IDENTITY', 'Current selection is not in compilation');
    for (const t of [state.eventCursor, state.knowledgeCutoff]) if (t !== null)
      requireThat(timeValue(t.value).precision === t.precision, 'INVALID_TIME', 'Current cursor precision mismatch');
    const c = object(command, 'command');
    requireThat(Object.keys(c).length === 2 && 'type' in c && 'value' in c, 'INVALID_SOURCE_RECORD', 'Expected exactly type and value');
    let next = { ...state };
    if (c.type === 'select') {
      requireThat(c.value === null || (typeof c.value === 'string' && ir.records.some((r) => r.id === c.value)),
        'UNBOUND_IDENTITY', 'Selection is not in compilation');
      next.selectedRecordId = c.value as string | null;
    } else if (c.type === 'view') {
      requireThat(VIEW_KINDS.includes(c.value as ViewKind), 'UNSUPPORTED_REPRESENTATION', 'Unknown view');
      next.view = c.value as ViewKind;
    } else if (c.type === 'eventCursor' || c.type === 'knowledgeCutoff') {
      next = { ...next, [c.type]: c.value === null ? null : timeValue(c.value) };
    } else requireThat(false, 'INVALID_SOURCE_RECORD', 'Unknown investigation command');
    return deepFreeze(structuredClone(next));
  });
}
