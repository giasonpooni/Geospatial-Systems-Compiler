import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const {inspectSimulatedFsrtView:inspect,inspectSimulatedFsrtText:inspectText,SIMULATED_ENVELOPE}=await import(process.env.SIMULATED_FSRT_VIEW_MODULE);
const {inspectFsrtView:inspectLegacy}=await import(process.env.LEGACY_FSRT_VIEW_MODULE);
const root=process.env.SIMULATED_FSRT_VIEW_FIXTURES,index=JSON.parse(readFileSync(join(root,'index.json'),'utf8'));
const hash=x=>'sha256:'+createHash('sha256').update(x).digest('hex');
function fixture(name='ordinary') {
  const raw=readFileSync(join(root,index[name].view));assert.equal(hash(raw),index[name].file_sha256);
  const e=JSON.parse(raw.toString());assert.equal(hash(e.payload),index[name].view_sha256);
  return e;
}
function altered(name,fn) {
  const e=fixture(name),v=JSON.parse(e.payload);fn(v);e.payload=JSON.stringify(v);e.sha256=hash(e.payload);return e;
}
function editSource(v,fn){const s=JSON.parse(v.source.payload);fn(s);v.source.payload=JSON.stringify(s);v.source.source_sha256=hash(v.source.payload);}
for(const name of ['ordinary','held','missing','both_missing','singular']) {
  test('actual '+name+' exact source/records/time',async()=>{
    const e=fixture(name),r=await inspectText(JSON.stringify(e),e.sha256),v=JSON.parse(e.payload);
    assert.equal(JSON.stringify(r.view),JSON.stringify(v));assert.equal(r.authority,'none');
    assert.equal(r.source.clock.tick,1);assert.equal(r.source.clock.ticks_per_second,10);
    assert.equal(r.representationId,e.sha256);assert.notEqual(r.source.producer.execution_id,r.view.execution.execution_id);
    assert.equal(r.stages.length,['both_missing','singular'].includes(name)?0:6);
    assert.ok(Object.isFrozen(r.view));assert.ok(Object.isFrozen(r.source));
    if(r.data)assert.equal(r.data.calibrated_observation.t,0.1);
  });
}
test('held stage values equal while stage identities differ',async()=>{
  const e=fixture('held'),r=await inspect(e,e.sha256);
  assert.equal(r.held,true);assert.equal(r.data.residuals.correction,null);
  const a=r.stages.find(s=>s.name==='posterior'),b=r.stages.find(s=>s.name==='reconciled');
  assert.deepEqual(a.matrix,b.matrix);assert.notEqual(a.covarianceId,b.covarianceId);
});
test('missing source stays absent; innovation is one-dimensional',async()=>{
  const e=fixture('missing'),r=await inspect(e,e.sha256);
  assert.equal(r.data.calibrated_observation.values[1],null);
  assert.equal(r.data.residuals.innovation[1],null);
  assert.equal(r.stages.find(s=>s.name==='innovation').matrix.length,1);
});
test('input and output cross terms retained',async()=>{
  const e=fixture(),r=await inspect(e,e.sha256);
  assert.equal(r.source.covariance[0][1],0.1);
  assert.notEqual(r.stages.find(s=>s.name==='reconciled').matrix[0][1],0);
});
const changes={
  'source class':v=>editSource(v,s=>s.source_class='physical_measurement'),
  'wrong source schema':v=>editSource(v,s=>s.schema='ciw.fsrt-view.v1'),
  'hidden reference source':v=>editSource(v,s=>s.truth=[49,51]),
  'hidden reference producer':v=>editSource(v,s=>s.producer.true_mass=[49,51]),
  'state owner':v=>editSource(v,s=>s.producer.state_owner='NET'),
  'clock owner':v=>editSource(v,s=>s.producer.clock_owner='NET'),
  'Boolean tick':v=>editSource(v,s=>s.clock.tick=true),
  'fractional tick':v=>editSource(v,s=>s.clock.tick=1.5),
  'zero rate':v=>editSource(v,s=>s.clock.ticks_per_second=0),
  'render phase':v=>editSource(v,s=>s.clock.phase='interpolated'),
  'native time reset':v=>v.result.data.data.calibrated_observation.t=0,
  'source time swap':v=>editSource(v,s=>s.clock.tick=2),
  'source digest swap':v=>v.source.source_sha256='sha256:'+'f'.repeat(64),
  'entity order':v=>editSource(v,s=>s.entity_ids.reverse()),
  'source order':v=>editSource(v,s=>s.source_ids.reverse()),
  'duplicated entity':v=>editSource(v,s=>s.entity_ids[1]=s.entity_ids[0]),
  'input covariance detached':v=>editSource(v,s=>s.covariance[0][1]=0.2),
  'input missingness detached':v=>editSource(v,s=>{s.mask[1]=false;s.values[1]=null;}),
  'unit':v=>editSource(v,s=>s.unit='g'),
  'frame':v=>editSource(v,s=>s.frame='world'),
  'new physical calibration':v=>v.result.data.data.covariance_artifacts.observation.provenance.metadata.calibration_status='calibrated',
  'synthetic notice removed':v=>v.result.data.native_label_notice='',
  'native operation':v=>v.result.data.native_operation_id='fsrt.tank-reconstruct.v1',
  'wrapper source claim':v=>v.result.data.source_class='physical_measurement',
  'reference supplied':v=>v.result.data.reference_truth_supplied=true,
  'verification':v=>v.result.verification_status='verified',
  'view authority':v=>v.authority.state_admission='admitted',
  'view reference':v=>v.authority.reference_truth_included=true,
  'occurrence collision':v=>editSource(v,s=>s.producer.execution_id=v.execution.execution_id),
  'result binding':v=>v.result.execution_id='execution-'+'f'.repeat(32),
  'covariance binding':v=>v.result.data.data.covariance_artifacts.posterior.matrix[0][1]+=1,
  'covariance stage identity':v=>v.result.data.data.covariance_artifacts.reconciled.covariance_id=v.result.data.data.covariance_artifacts.posterior.covariance_id,
  'independence':v=>{v.execution.parameters.independence.prior_independent_of_observations=false;v.result.parameters=v.execution.parameters;},
  'unknown property':v=>v.reference_state={mass:[49,51]},
};
for(const [name,fn] of Object.entries(changes))test('rehashed '+name+' rejected',async()=>{const e=altered('ordinary',fn);await assert.rejects(inspect(e,e.sha256));});
test('held status cannot acquire correction',async()=>{const e=altered('held',v=>v.result.data.data.residuals.correction=[0,0]);await assert.rejects(inspect(e,e.sha256));});
test('refusal cannot acquire result',async()=>{const e=altered('both_missing',v=>v.result=JSON.parse(fixture().payload).result);await assert.rejects(inspect(e,e.sha256));});
test('legacy reader refuses synthetic schema',async()=>{const e=fixture();await assert.rejects(inspectLegacy(e,e.sha256));});
test('synthetic reader refuses relabelled legacy outer schema',async()=>{const e=fixture();e.schema='ciw.fsrt-view-envelope.v1';await assert.rejects(inspect(e,e.sha256));});
test('wrong external selection',async()=>{const e=fixture();await assert.rejects(inspect(e,'sha256:'+'e'.repeat(64)));});
test('changed payload without matching digest',async()=>{const e=fixture();e.payload+=' ';await assert.rejects(inspect(e,e.sha256));});
for(const [name,payload] of [['duplicate','{"schema":1,"schema":2}'],['escaped duplicate','{"a":1,"\\u0061":2}'],['nonfinite','{"x":1e999}'],['unsafe integer','{"x":9007199254740993}'],['nested','['.repeat(60)+'0'+']'.repeat(60)],['oversize',' '.repeat(262145)]]) {
 test(name+' JSON refused',async()=>{const e={schema:SIMULATED_ENVELOPE,payload,sha256:hash(payload)};await assert.rejects(inspect(e,e.sha256));});
}
test('outer duplicate JSON refused',async()=>{const e=fixture(),raw=JSON.stringify(e).replace('{','{"schema":"'+SIMULATED_ENVELOPE+'",');await assert.rejects(async()=>inspectText(raw,e.sha256));});
test('captured bytes cannot change during digest',async()=>{
 const e=fixture(),expected=e.sha256,promise=inspect(e,expected);e.payload=fixture('held').payload;
 assert.equal((await promise).held,false);
});
test('returned records are deeply frozen',async()=>{const e=fixture(),r=await inspect(e,e.sha256);assert.throws(()=>r.source.clock.tick=0,TypeError);assert.throws(()=>r.stages[0].matrix[0][0]=0,TypeError);});
