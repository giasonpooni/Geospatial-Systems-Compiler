/** Read-only projection of a retained NET/FSRT occurrence. No scientific executor. */
type Obj = Record<string, unknown>;
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type CovarianceStage = Readonly<{
  name: string; quantityIds: readonly string[]; units: readonly string[];
  matrix: readonly (readonly number[])[]; covarianceId: string | null;
}>;
export type FsrtData = Readonly<{
  calibrated_observation: { values: (number | null)[]; mask: boolean[]; source_ids: string[]; unit: 'kg'; t: number; arrival_t: number };
  unprojected_estimate: { values: number[]; covariance: number[][]; unit: 'kg' };
  estimate: { values: number[]; covariance: number[][]; unit: 'kg'; kind: 'estimated_state'; t: number };
  residuals: { innovation: (number | null)[]; innovation_variance: (number | null)[]; balance_before: number[];
    balance_after: number[] | null; correction: number[] | null; unit: 'kg' };
  diagnostics: { physical_model_status: string; reconciliation_status: string; fault_attribution: string;
    consistency_statistic: number; consistency_threshold: number; confidence: number; physical_truth_verified: false; scope: string };
}>;
export type FsrtInspection = Readonly<{
  integrity: 'matched-external-digest'; authority: 'none';
  view: Readonly<{ schema: 'ciw.fsrt-view.v1'; workspace_sha256: string;
    source: { run_id: string; evidence_id: string; coordinate_frame: string; description: string;
      time_reference: string; observed_at: string[]; source_order: string[] };
    execution: { execution_id: string; operation_id: string; status: 'completed' | 'refused';
      refusal?: { code: string; message: string }; [key: string]: unknown };
    result: Obj | null; authority: Obj }>;
  data: FsrtData | null; held: boolean; stages: readonly CovarianceStage[];
}>;
const STATE = ['tank-1.mass', 'tank-2.mass'];
const STAGES = ['observation', 'prior', 'declared_total', 'innovation', 'posterior', 'reconciled'];
const OPS = ['fsrt.tank-reconstruct.v1', 'fsrt.tank-reconstruct.v2'];
const INDEPENDENCE = ['prior_independent_of_observations', 'declared_total_independent_of_observations', 'prior_independent_of_declared_total'];
const LIMIT = 256 * 1024;
function ensure(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function object(value: unknown, keys?: readonly string[]): Obj {
  ensure(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected an object');
  const record = value as Obj;
  if (keys) ensure(Object.keys(record).length === keys.length && Object.keys(record).every(k => keys.includes(k)), 'Unexpected or missing fields');
  return record;
}
function text(value: unknown): asserts value is string { ensure(typeof value === 'string' && value.length > 0 && value.length <= 16384, 'Invalid text'); }
function digest(value: unknown): asserts value is string { ensure(typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value), 'Invalid complete digest'); }
function number(value: unknown): asserts value is number { ensure(typeof value === 'number' && Number.isFinite(value), 'Nonfinite or coerced number'); }
function strings(value: unknown, length?: number): string[] {
  ensure(Array.isArray(value) && (length === undefined || value.length === length), 'Invalid string order');
  value.forEach(text); return value as string[];
}
function vector(value: unknown, length: number, nullable = false): (number | null)[] {
  ensure(Array.isArray(value) && value.length === length, 'Invalid quantity dimension');
  value.forEach(v => { if (v !== null || !nullable) number(v); }); return value;
}
function matrix(value: unknown, size: number): number[][] {
  ensure(Array.isArray(value) && value.length === size, 'Invalid covariance dimension');
  value.forEach((row, i) => { vector(row, size); ensure(row[i] >= 0, 'Negative variance'); });
  return value as number[][];
}
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const x = a as Obj, y = b as Obj, keys = Object.keys(x);
  return keys.length === Object.keys(y).length && keys.every(k => Object.hasOwn(y, k) && equal(x[k], y[k]));
}
function bind(actual: unknown, expected: unknown, name: string) { ensure(equal(actual, expected), name + ' binding differs'); }
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function identity(value: unknown, prefix: string) { ensure(typeof value === 'string' && new RegExp('^' + prefix + '-[0-9a-f]{32}$').test(value), 'Invalid occurrence identity'); }
function timestamp(value: unknown) {
  text(value); ensure(/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)), 'Explicit timestamp required');
}

/** Bounded JSON parser: reject duplicate keys before JSON.parse could erase them. */
function parse(text: string): Json {
  let i = 0, nodes = 0;
  const whitespace = () => { while (/[\x20\t\r\n]/.test(text[i] ?? '\0')) i++; };
  function string(): string {
    const start = i++; let closed = false;
    while (i < text.length) { const c = text[i++]; if (c === '\\') i++; else if (c === '"') { closed = true; break; } }
    ensure(closed, 'Unterminated JSON string'); return JSON.parse(text.slice(start, i)) as string;
  }
  function value(depth: number): Json {
    ensure(depth <= 48 && ++nodes <= 32768, 'JSON structure exceeds budget'); whitespace();
    const c = text[i];
    if (c === '"') return string();
    if (c === '{') {
      i++; whitespace(); const result: { [key: string]: Json } = Object.create(null);
      if (text[i] === '}') { i++; return result; }
      while (true) {
        whitespace(); ensure(text[i] === '"', 'Expected JSON key'); const key = string();
        ensure(!Object.hasOwn(result, key), 'Duplicate JSON key'); whitespace(); ensure(text[i++] === ':', 'Expected colon');
        result[key] = value(depth + 1); whitespace(); const end = text[i++]; if (end === '}') return result;
        ensure(end === ',', 'Expected object delimiter');
      }
    }
    if (c === '[') {
      i++; whitespace(); const result: Json[] = [];
      if (text[i] === ']') { i++; return result; }
      while (true) { result.push(value(depth + 1)); whitespace(); const end = text[i++]; if (end === ']') return result; ensure(end === ',', 'Expected array delimiter'); }
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
    ensure(token, 'Invalid JSON value'); i += token[0].length;
    const result = JSON.parse(token[0]) as Json;
    if (typeof result === 'number') {
      number(result);
      if (!/[.eE]/.test(token[0])) ensure(Number.isSafeInteger(result), 'Integer cannot be represented exactly');
    }
    return result;
  }
  const result = value(0); whitespace(); ensure(i === text.length, 'Trailing JSON'); return result;
}

function dataContract(value: unknown, operation: string, source: Obj): { data: FsrtData; stages: CovarianceStage[]; held: boolean } {
  const v2 = operation === OPS[1];
  const d = object(value, ['model','calibrated_observation','estimate','unprojected_estimate','residuals','diagnostics','assumptions','observation_evidence_ids', ...(v2 ? ['state_order','covariance_artifacts'] : [])]);
  const model = object(d.model, ['kind','prior_mean','prior_std','total_mass_kg','total_mass_variance_kg2']);
  ensure(model.kind === 'reservoir2-linear-v1', 'Unsupported fluid model');
  ensure(vector(model.prior_mean, 2).every(v => v !== null && v >= 0), 'Invalid prior mass');
  for (const key of ['prior_std','total_mass_kg','total_mass_variance_kg2']) number(model[key]);
  ensure((model.prior_std as number) > 0 && (model.total_mass_kg as number) >= 0 && (model.total_mass_variance_kg2 as number) >= 0, 'Invalid model bounds');
  const o = object(d.calibrated_observation, ['t','arrival_t','values','covariance','mask','source_ids','evidence_ids','unit']);
  ensure(o.unit === 'kg', 'Unsupported observation unit'); number(o.t); number(o.arrival_t);
  ensure(o.t === 0 && o.arrival_t === 0, 'Unsupported snapshot clock');
  bind(o.source_ids, source.source_order, 'Source order'); strings(o.evidence_ids, 2).forEach(digest);
  ensure(new Set(o.evidence_ids as string[]).size === 2, 'Duplicate observation evidence');
  bind(d.observation_evidence_ids, o.evidence_ids, 'Evidence order');
  vector(o.values, 2, true); matrix(o.covariance, 2);
  ensure(Array.isArray(o.mask) && o.mask.length === 2 && o.mask.every(v => typeof v === 'boolean'), 'Invalid observation mask');
  ensure(o.mask.some(Boolean), 'No observations');
  (o.values as (number | null)[]).forEach((v, i) => ensure(o.mask instanceof Array && (o.mask[i] ? v !== null && v >= 0 : v === null), 'Observation missingness differs'));
  const pre = object(d.unprojected_estimate, ['values','covariance','unit']);
  const post = object(d.estimate, ['values','covariance','unit','kind','t']);
  for (const s of [pre,post]) {
    ensure(s.unit === 'kg', 'Unsupported state unit'); ensure(vector(s.values,2).every(v => v !== null && v >= 0), 'Negative mass'); matrix(s.covariance,2);
  }
  ensure(post.kind === 'estimated_state' && post.t === o.t, 'State/time meaning differs');
  const r = object(d.residuals, ['innovation','innovation_variance','balance_before','balance_after','correction','unit']);
  ensure(r.unit === 'kg', 'Unsupported residual unit'); vector(r.balance_before,1);
  for (const key of ['innovation','innovation_variance']) vector(r[key],2,true).forEach((v,i) => {
    ensure((o.mask as boolean[])[i] ? v !== null : v === null, 'Innovation missingness differs');
    if (key === 'innovation_variance' && v !== null) ensure(v > 0, 'Invalid innovation variance');
  });
  const diag = object(d.diagnostics, ['physical_model_status','reconciliation_status','fault_attribution','consistency_statistic','consistency_threshold','confidence','missing_sources','physical_truth_verified','state_domain_status','scope']);
  number(diag.consistency_statistic); number(diag.consistency_threshold);
  ensure(diag.consistency_statistic >= 0 && diag.consistency_threshold > 0 && diag.confidence === 0.999, 'Invalid diagnostic bounds');
  ensure(diag.physical_truth_verified === false && diag.state_domain_status === 'nonnegative_masses', 'Unsupported physical claim'); text(diag.scope);
  const held = diag.physical_model_status === 'physical_model_disagreement';
  ensure(held || diag.physical_model_status === 'consistent', 'Unsupported model status');
  ensure(held === (diag.consistency_statistic > diag.consistency_threshold), 'Diagnostic status contradicts retained statistic');
  ensure(diag.reconciliation_status === (held ? 'model_inconsistent' : 'ok'), 'Correction status differs');
  bind(diag.missing_sources, (o.source_ids as string[]).filter((_,i) => !(o.mask as boolean[])[i]), 'Missing sources');
  ensure(diag.fault_attribution === (held || !(o.mask as boolean[]).every(Boolean) ? 'confounded_or_unidentifiable' : 'not_tested'), 'Fault attribution exceeds scope');
  if (held) { ensure(r.correction === null && r.balance_after === null, 'Held correction must stay absent'); bind(post.values,pre.values,'Held state'); bind(post.covariance,pre.covariance,'Held covariance'); }
  else { vector(r.balance_after,1); vector(r.correction,2); }
  const assumptions = object(d.assumptions, ['prior_independent_of_observations','declared_total_independent_of_observations','topology','temporal_covariance']);
  ensure(assumptions.prior_independent_of_observations === true && assumptions.declared_total_independent_of_observations === true && assumptions.temporal_covariance === 'not_applicable_single_snapshot', 'Unsupported dependence');
  bind(assumptions.topology, { reservoirs: o.source_ids, balance_coefficients:[1,1] }, 'Topology');
  const stages: CovarianceStage[] = [];
  if (v2) {
    bind(d.state_order, STATE, 'State order');
    const artifacts = object(d.covariance_artifacts, STAGES);
    const present = (o.mask as boolean[]).flatMap((x,i) => x ? [i] : []);
    for (const name of STAGES) {
      const a = object(artifacts[name], ['schema','covariance_id','quantity_ids','units','frame','reference_values','matrix','method','basis','provenance','assumptions']);
      ensure(a.schema === 'covariance-artifact.v1' && a.frame === 'reservoir2.mass', 'Unsupported covariance schema/frame'); digest(a.covariance_id); text(a.method);
      const axes = name === 'observation' ? o.source_ids as string[] : name === 'innovation' ? present.map(i => (o.source_ids as string[])[i]) : name === 'declared_total' ? ['total_mass'] : STATE;
      bind(a.quantity_ids, axes, 'Covariance axes'); bind(a.units,axes.map(()=>'kg'),'Covariance units');
      vector(a.reference_values, axes.length); const values = matrix(a.matrix,axes.length);
      const provenance = object(a.provenance); text(provenance.provider);
      strings(provenance.source_evidence_ids).forEach(digest); strings(provenance.source_covariance_ids).forEach(digest);
      strings(a.assumptions); const basis = object(a.basis,['kind','id']); text(basis.kind); text(basis.id);
      const metadata = object(provenance.metadata);
      INDEPENDENCE.forEach(k => ensure(metadata[k] === true, 'Unsupported covariance dependence')); strings(metadata.shared_dependencies);
      if (name === 'observation') {
        ensure(basis.kind === 'calibrated_observation', 'Observation basis differs'); bind(a.matrix,o.covariance,'Observation covariance'); bind(provenance.source_evidence_ids,o.evidence_ids,'Observation covariance evidence');
        present.forEach(i=>bind((a.reference_values as number[])[i],(o.values as unknown[])[i],'Observation reference'));
      } else {
        bind(basis.id,operation+':'+name,'Covariance stage'); bind(metadata.stage,name,'Stage metadata');
        bind(metadata.state_order,STATE,'Metadata state order'); bind(metadata.source_order,o.source_ids,'Metadata source order'); bind(metadata.observed_mask,o.mask,'Metadata mask');
        const expectedKind = ['prior','declared_total'].includes(name) ? 'parameter' : name === 'innovation' ? 'residual' : 'estimated_state'; bind(basis.kind,expectedKind,'Stage kind');
        const references = name === 'prior' ? model.prior_mean : name === 'declared_total' ? [model.total_mass_kg] : name === 'innovation' ? present.map(i=>(r.innovation as unknown[])[i]) : name === 'posterior' ? pre.values : post.values;
        bind(a.reference_values,references,'Stage reference');
        const ancestors = ['prior','declared_total'].includes(name) ? [] : name === 'reconciled' ? [object(artifacts.posterior).covariance_id,object(artifacts.declared_total).covariance_id] : [object(artifacts.observation).covariance_id,object(artifacts.prior).covariance_id];
        bind(provenance.source_covariance_ids,ancestors,'Covariance ancestry');
        bind(provenance.source_evidence_ids,['prior','declared_total'].includes(name) ? [] : o.evidence_ids,'Stage evidence');
        if (name === 'posterior') bind(a.matrix,pre.covariance,'Posterior covariance');
        if (name === 'reconciled') { bind(a.matrix,post.covariance,'Final covariance'); bind(metadata.reconciliation_status,diag.reconciliation_status,'Final stage status'); }
        if (name === 'declared_total') bind(a.matrix,[[model.total_mass_variance_kg2]],'Total variance');
        if (name === 'innovation') present.forEach((original,i)=>bind(values[i][i],(r.innovation_variance as unknown[])[original],'Innovation variance'));
      }
      stages.push({name,quantityIds:axes,units:axes.map(()=>'kg'),matrix:values,covarianceId:a.covariance_id});
    }
    ensure(new Set(stages.map(s=>s.covarianceId)).size===6,'Covariance stage identities collide');
  } else {
    for (const [name, axes, covariance] of [['observation',o.source_ids,o.covariance],['posterior',STATE,pre.covariance],['reconciled',STATE,post.covariance]] as const) {
      stages.push({name,quantityIds:axes as string[],units:['kg','kg'],matrix:covariance as number[][],covarianceId:null});
    }
  }
  return {data:d as unknown as FsrtData,stages,held};
}

/** Hash the captured Python UTF-8 bytes against a separately selected digest. */
export async function inspectFsrtView(envelope: unknown, expectedSha256: string): Promise<FsrtInspection> {
  digest(expectedSha256);
  const {schema,payload,sha256} = object(envelope,['schema','payload','sha256']);
  ensure(schema === 'ciw.fsrt-view-envelope.v1' && typeof payload === 'string','Unsupported FSRT envelope');
  digest(sha256); ensure(sha256 === expectedSha256,'External artifact selection differs');
  ensure(payload.length <= LIMIT,'View exceeds byte budget');
  const bytes = new TextEncoder().encode(payload); ensure(bytes.byteLength <= LIMIT,'View exceeds byte budget');
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes));
  ensure('sha256:'+Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('') === expectedSha256,'View bytes differ from retained digest');
  const v = object(parse(payload),['schema','workspace_sha256','source','execution','result','authority']);
  ensure(v.schema === 'ciw.fsrt-view.v1','Unsupported FSRT view'); digest(v.workspace_sha256);
  bind(v.authority,{read_only:true,numerical_replay:'not_performed_by_inspection',state_admission:'not_performed'},'Authority');
  const source = object(v.source,['run_id','evidence_id','coordinate_frame','description','time_reference','source_order','observed_at']);
  identity(source.run_id,'run'); digest(source.evidence_id);
  ensure(source.coordinate_frame === 'two-reservoir-mass','Unsupported source frame'); text(source.description); text(source.time_reference);
  const order = strings(source.source_order,2); ensure(new Set(order).size===2,'Duplicate sources');
  strings(source.observed_at,2).forEach(timestamp); ensure((source.observed_at as string[])[0]===(source.observed_at as string[])[1],'Non-simultaneous acquisition');
  const e = object(v.execution); const refused = e.status === 'refused';
  object(e,['schema','execution_id','operation_id','evidence_id','run_id','selection_revision','channel','interval_s','parameters','created_at','runtime','status','result_id','record_digest',...(refused?['refusal']:[])]);
  ensure(e.schema === 'ciw.execution.v1' && OPS.includes(e.operation_id as string),'Unsupported execution'); identity(e.execution_id,'execution'); digest(e.record_digest);
  bind(e.run_id,source.run_id,'Run'); bind(e.evidence_id,source.evidence_id,'Evidence'); timestamp(e.created_at);
  ensure(Number.isSafeInteger(e.selection_revision) && (e.selection_revision as number)>=0,'Invalid revision'); text(e.channel); vector(e.interval_s,2); object(e.parameters);
  const interval = e.interval_s as number[]; ensure(interval[0] === 0 && interval[1]>0 && interval[1]<=1,'Invalid selection support');
  if (refused) {
    ensure(e.result_id === null && v.result === null,'Refusal cannot carry a result');
    const refusal = object(e.refusal); ensure(Object.keys(refusal).every(k=>['code','message','reason_code'].includes(k)),'Unknown refusal field'); text(refusal.code); text(refusal.message);
    if ('reason_code' in refusal) text(refusal.reason_code);
    if (e.runtime !== null) object(e.runtime);
    return freeze({integrity:'matched-external-digest',authority:'none',view:v as unknown as FsrtInspection['view'],data:null,held:false,stages:[]});
  }
  ensure(e.status === 'completed','Unsupported execution status'); object(e.runtime); identity(e.result_id,'result');
  const r = object(v.result,['schema','result_id','execution_id','operation_id','evidence_id','run_id','selection_revision','channel','interval_s','created_at','recording_file','verification_id','verification_status','role','runtime','parameters','data','record_digest']);
  ensure(r.schema === 'ciw.operation-result.v1' && r.role === 'state_estimator' && r.verification_id === null && r.verification_status === 'not_verified','Unsupported result or verification claim'); digest(r.record_digest); text(r.recording_file);
  for (const key of ['result_id','execution_id','operation_id','evidence_id','run_id','selection_revision','channel','interval_s','created_at','runtime','parameters']) bind(r[key],e[key],key);
  const checked = dataContract(r.data,e.operation_id as string,source);
  const parameters = object(e.parameters);
  ensure(Object.keys(parameters).every(k=>k==='model'),'Unsupported snapshot parameter');
  if ('model' in parameters) bind(parameters.model,object(r.data).model,'Model');
  return freeze({integrity:'matched-external-digest',authority:'none',view:v as unknown as FsrtInspection['view'],...checked});
}
