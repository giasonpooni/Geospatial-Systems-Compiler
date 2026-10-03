/** Synthetic-source view contract. No source engine, estimator or reference runtime. */
import {
  bind, dataContract, digest, ensure, freeze, identity, matrix, number, object,
  parse as parseFsrtJson, strings, text, timestamp, vector,
  type FsrtData, type CovarianceStage,
} from './fsrt-view';

type Obj = Record<string, unknown>;
export const SIMULATED_ENVELOPE = 'ciw.simulated-fsrt-view-envelope.v1';
const OP = 'ciw.simulated-fsrt.v1';
const NATIVE = 'fsrt.tank-reconstruct.v2';
const FRAME = 'reservoir2.mass';
const STATE = ['tank-1.mass', 'tank-2.mass'];
const FLAGS = ['prior_independent_of_observations', 'declared_total_independent_of_observations', 'prior_independent_of_declared_total'];
export const SYNTHETIC_NOTICE = 'Native FSRT calibrated_observation is its historical unit-normalized input label; these readings are simulated, not physically measured or calibrated.';
export type SimulatedMassSource = Readonly<{
  schema: 'ciw.simulated-mass-observation.v1'; source_class: 'simulated_observation';
  producer: { engine: string; version: string; source_revision: string; executable_sha256: string;
    execution_id: string; simulation_id: string; state_owner: string; clock_owner: string;
    scenario_id: string; model_id: string; asset_ids: string[] };
  clock: { tick: number; ticks_per_second: number; phase: 'post_step' };
  entity_ids: string[]; source_ids: string[]; unit: 'kg'; frame: 'reservoir2.mass';
  values: (number | null)[]; mask: boolean[]; covariance: number[][];
  reference_values: number[]; sensor_model_id: string;
}>;
export type SimulatedFsrtInspection = Readonly<{
  integrity: 'matched-external-digest'; authority: 'none'; representationId: string;
  view: { schema: 'ciw.simulated-fsrt-view.v1'; workspace_sha256: string;
    source: { run_id: string; evidence_id: string; source_sha256: string; payload: string; channel_evidence_ids: string[] };
    execution: { execution_id: string; operation_id: string; status: 'completed' | 'refused';
      refusal?: { code: string; message: string }; [key: string]: unknown };
    result: Obj | null; authority: Obj };
  source: SimulatedMassSource; data: FsrtData | null; held: boolean; stages: readonly CovarianceStage[];
}>;

async function checkBytes(value: unknown, expected: string, limit: number): Promise<string> {
  ensure(typeof value === 'string' && value.length <= limit, 'Payload exceeds byte budget');
  const bytes = new TextEncoder().encode(value);
  ensure(bytes.length <= limit, 'Payload exceeds byte budget');
  const result = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const actual = 'sha256:' + Array.from(result, x => x.toString(16).padStart(2, '0')).join('');
  ensure(actual === expected, 'Retained payload bytes differ from digest');
  return value;
}

function sourceContract(value: unknown): SimulatedMassSource {
  const s = object(value, ['schema','source_class','producer','clock','entity_ids','source_ids','unit','frame',
    'values','mask','covariance','reference_values','sensor_model_id']);
  ensure(s.schema === 'ciw.simulated-mass-observation.v1' && s.source_class === 'simulated_observation', 'Not a simulated observation');
  ensure(s.unit === 'kg' && s.frame === FRAME, 'Unsupported simulated mass unit/frame');
  const p = object(s.producer, ['engine','version','source_revision','executable_sha256','execution_id','simulation_id',
    'state_owner','clock_owner','scenario_id','model_id','asset_ids']);
  for (const key of ['engine','version','state_owner','clock_owner']) text(p[key]);
  ensure(p.engine === p.state_owner && p.engine === p.clock_owner, 'State/clock owner differs');
  ensure(typeof p.source_revision === 'string' && /^[0-9a-f]{40}$/.test(p.source_revision), 'Exact source revision required');
  for (const key of ['executable_sha256','scenario_id','model_id']) digest(p[key]);
  identity(p.execution_id, 'execution'); identity(p.simulation_id, 'simulation');
  const assets = strings(p.asset_ids); ensure(assets.length <= 32 && new Set(assets).size === assets.length, 'Invalid asset identities'); assets.forEach(digest);
  const clock = object(s.clock, ['tick','ticks_per_second','phase']);
  ensure(Number.isSafeInteger(clock.tick) && (clock.tick as number) >= 0 && (clock.tick as number) <= 2**31-1, 'Invalid simulation tick');
  ensure(Number.isSafeInteger(clock.ticks_per_second) && (clock.ticks_per_second as number) >= 1 && (clock.ticks_per_second as number) <= 1000000, 'Invalid tick rate');
  ensure(clock.phase === 'post_step', 'Unsupported observation phase');
  for (const key of ['source_ids','entity_ids']) { const ids = strings(s[key], 2); ensure(new Set(ids).size === 2, 'Duplicate source/entity'); }
  vector(s.values, 2, true); vector(s.reference_values, 2); matrix(s.covariance, 2); digest(s.sensor_model_id);
  ensure(Array.isArray(s.mask) && s.mask.length === 2 && s.mask.every(x => typeof x === 'boolean'), 'Invalid mask');
  (s.values as (number | null)[]).forEach((v, i) => {
    if ((s.mask as boolean[])[i]) { ensure(v !== null && v >= 0, 'Invalid present mass'); bind(v, (s.reference_values as number[])[i], 'Observation reference'); }
    else ensure(v === null, 'Missing observation must be null');
  });
  return s as unknown as SimulatedMassSource;
}

/** Validate the synthetic provenance and record bindings before sharing the numerical renderer. */
export async function inspectSimulatedFsrtView(envelope: unknown, expected: string): Promise<SimulatedFsrtInspection> {
  digest(expected);
  const e = object(envelope, ['schema','payload','sha256']);
  ensure(e.schema === SIMULATED_ENVELOPE, 'Unsupported synthetic FSRT envelope');
  // Capture all caller-owned fields before the asynchronous hash boundary.
  const payload = e.payload, selected = e.sha256;
  digest(selected); ensure(selected === expected, 'External artifact selection differs');
  const raw = await checkBytes(payload, expected, 256 * 1024);
  const v = object(parseFsrtJson(raw), ['schema','workspace_sha256','source','execution','result','authority']);
  ensure(v.schema === 'ciw.simulated-fsrt-view.v1', 'Unsupported synthetic view'); digest(v.workspace_sha256);
  bind(v.authority, {read_only:true,numerical_replay:'not_performed_by_inspection',state_admission:'not_performed',reference_truth_included:false}, 'View authority');
  const src = object(v.source, ['run_id','evidence_id','source_sha256','payload','channel_evidence_ids']);
  identity(src.run_id, 'run'); digest(src.evidence_id); digest(src.source_sha256);
  const channelEvidence = strings(src.channel_evidence_ids, 2); channelEvidence.forEach(digest);
  ensure(new Set(channelEvidence).size === 2, 'Duplicate channel evidence');
  const source = sourceContract(parseFsrtJson(await checkBytes(src.payload, src.source_sha256, 65536)));
  const execution = object(v.execution), refused = execution.status === 'refused';
  object(execution, ['schema','execution_id','operation_id','evidence_id','run_id','selection_revision','channel','interval_s',
    'parameters','created_at','runtime','status','result_id','record_digest', ...(refused ? ['refusal'] : [])]);
  ensure(execution.schema === 'ciw.execution.v1' && execution.operation_id === OP, 'Unsupported estimator occurrence');
  identity(execution.execution_id, 'execution'); digest(execution.record_digest); timestamp(execution.created_at);
  ensure(execution.execution_id !== source.producer.execution_id, 'Source and estimator occurrences collide');
  bind(execution.run_id, src.run_id, 'Source run'); bind(execution.evidence_id, src.evidence_id, 'Source evidence');
  ensure(Number.isSafeInteger(execution.selection_revision) && (execution.selection_revision as number) >= 0, 'Invalid selection revision');
  ensure(source.source_ids.includes(execution.channel as string), 'Unknown selected channel');
  vector(execution.interval_s, 2); const interval = execution.interval_s as number[];
  ensure(interval[0] === 0 && interval[1] > 0 && interval[1] <= 1, 'Invalid local selection support');
  const parameters = object(execution.parameters, ['model','independence','state_bindings']);
  const flags = object(parameters.independence, FLAGS); FLAGS.forEach(k => ensure(flags[k] === true, 'Unsupported independence declaration'));
  bind(parameters.state_bindings, source.entity_ids.map((id,i) => ({entity_id:id,state_quantity:STATE[i]})), 'Entity/state mapping');
  const model = object(parameters.model, ['kind','prior_mean','prior_std','total_mass_kg','total_mass_variance_kg2']);
  ensure(model.kind === 'reservoir2-linear-v1', 'Unsupported model'); vector(model.prior_mean, 2);
  for (const k of ['prior_std','total_mass_kg','total_mass_variance_kg2']) number(model[k]);
  // A refused model may have invalid physical bounds; do not erase its refusal.
  if (refused) {
    ensure(execution.result_id === null && v.result === null, 'Refused occurrence cannot have an estimate');
    const r = object(execution.refusal); text(r.code); text(r.message);
    ensure(Object.keys(r).every(k => ['code','message','reason_code'].includes(k)), 'Invalid refusal fields');
    if ('reason_code' in r) text(r.reason_code);
    if (execution.runtime !== null) object(execution.runtime);
    return freeze({integrity:'matched-external-digest',authority:'none',representationId:expected,
      view:v as unknown as SimulatedFsrtInspection['view'],source,data:null,held:false,stages:[]});
  }
  ensure(execution.status === 'completed', 'Unsupported execution status'); object(execution.runtime); identity(execution.result_id, 'result');
  const r = object(v.result, ['schema','result_id','execution_id','operation_id','evidence_id','run_id','selection_revision','channel','interval_s',
    'created_at','recording_file','verification_id','verification_status','role','runtime','parameters','data','record_digest']);
  ensure(r.schema === 'ciw.operation-result.v1' && r.role === 'state_estimator' && r.verification_id === null && r.verification_status === 'not_verified', 'Unsupported result or verification claim');
  digest(r.record_digest); text(r.recording_file);
  for (const key of ['result_id','execution_id','operation_id','evidence_id','run_id','selection_revision','channel','interval_s','created_at','runtime','parameters']) bind(r[key], execution[key], key);
  const wrapper = object(r.data, ['schema','source_class','source_sha256','native_operation_id','native_input_digest','native_label_notice','reference_truth_supplied','data']);
  ensure(wrapper.schema === 'ciw.simulated-fsrt-result.v1' && wrapper.source_class === 'simulated_observation', 'Synthetic result class differs');
  bind(wrapper.source_sha256, src.source_sha256, 'Observation bytes'); bind(wrapper.native_operation_id, NATIVE, 'Native operation');
  digest(wrapper.native_input_digest); bind(wrapper.native_label_notice, SYNTHETIC_NOTICE, 'Synthetic label');
  ensure(wrapper.reference_truth_supplied === false, 'Reference truth cannot be an estimator input');
  const t = source.clock.tick / source.clock.ticks_per_second;
  const checked = dataContract(wrapper.data, NATIVE, {source_order:source.source_ids}, t);
  const data = object(wrapper.data), obs = object(data.calibrated_observation);
  bind(data.model, parameters.model, 'Model parameters');
  for (const key of ['values','mask','covariance','source_ids','unit']) bind(obs[key], source[key as keyof SimulatedMassSource], 'Observation ' + key);
  bind(obs.evidence_ids, channelEvidence, 'Channel evidence');
  const artifacts = object(data.covariance_artifacts), input = object(artifacts.observation);
  bind(input.reference_values, source.reference_values, 'Declared observation references');
  bind(object(input.basis).id, src.source_sha256, 'Observation basis');
  bind(input.method, 'identity_simulated_mass_units_no_physical_calibration', 'Observation method');
  const provenance = object(input.provenance); bind(provenance.provider, OP, 'Observation provider'); bind(provenance.source_covariance_ids, [], 'Observation covariance ancestors');
  const metadata = object(provenance.metadata, [...FLAGS,'shared_dependencies','source_class','calibration_status','native_label_notice','clock','producer_execution_id']);
  bind(metadata, {...flags,shared_dependencies:[source.sensor_model_id],source_class:'simulated_observation',
    calibration_status:'not_applicable_simulated_reading',native_label_notice:SYNTHETIC_NOTICE,
    clock:source.clock,producer_execution_id:source.producer.execution_id}, 'Synthetic covariance provenance');
  for (const name of ['prior','declared_total','innovation','posterior','reconciled']) {
    const m = object(object(object(artifacts[name]).provenance).metadata);
    bind(m.upstream_covariance_metadata, metadata, 'Upstream synthetic context');
    bind(m.shared_dependencies, [source.sensor_model_id], 'Shared sensor model');
  }
  return freeze({integrity:'matched-external-digest',authority:'none',representationId:expected,
    view:v as unknown as SimulatedFsrtInspection['view'],source,...checked});
}

/** Browser entry point also rejects duplicates in the outer envelope, before dispatch. */
export function inspectSimulatedFsrtText(raw: string, expected: string): Promise<SimulatedFsrtInspection> {
  ensure(raw.length <= 262144 && new TextEncoder().encode(raw).length <= 262144, 'File exceeds the 256 KiB limit');
  return inspectSimulatedFsrtView(parseFsrtJson(raw), expected);
}
