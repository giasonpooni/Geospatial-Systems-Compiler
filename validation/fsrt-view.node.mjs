// All baseline cases are actual pinned NET/RCI/FSRT output on synthetic inputs.
// Altered records below test the reader, not an alternative scientific model.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const { inspectFsrtView } = await import(process.env.FSRT_VIEW_MODULE);
const root = process.env.FSRT_VIEW_FIXTURES;
const index = JSON.parse(readFileSync(join(root,'index.json'),'utf8'));
const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
function fixture(name = 'ordinary') {
  const item = index[name], raw = readFileSync(join(root,item.view));
  assert.equal(hash(raw), item.file_sha256);
  const envelope = JSON.parse(raw.toString('utf8'));
  assert.equal(hash(envelope.payload), item.view_sha256);
  return {envelope, expected:item.view_sha256};
}
function altered(name, change) {
  const {envelope} = fixture(name); const view = JSON.parse(envelope.payload); change(view);
  envelope.payload = JSON.stringify(view); envelope.sha256 = hash(envelope.payload);
  return envelope;
}
for (const name of ['ordinary','held','refused','legacy']) {
  test('actual retained ' + name + ' is preserved',async()=>{
    const {envelope,expected} = fixture(name);
    const x = await inspectFsrtView(envelope,expected), original=JSON.parse(envelope.payload);
    assert.equal(x.authority,'none'); assert.equal(x.view.execution.execution_id,original.execution.execution_id);
    assert.equal(JSON.stringify(x.view.result),JSON.stringify(original.result));
    assert.equal(x.stages.length,name==='refused'?0:name==='legacy'?3:6);
    assert.ok(Object.isFrozen(x.view));
    if(x.data) { assert.ok(Object.isFrozen(x.data.estimate.covariance[0])); assert.equal(x.view.result.verification_id,null); }
  });
}
test('held stages keep identical numbers and different identities',async()=>{
  const {envelope,expected}=fixture('held'); const x=await inspectFsrtView(envelope,expected);
  assert.equal(x.held,true); assert.equal(x.data.residuals.correction,null); assert.equal(x.data.residuals.balance_after,null);
  assert.equal(x.data.diagnostics.fault_attribution,'confounded_or_unidentifiable');
  const a=x.stages.find(s=>s.name==='posterior'), b=x.stages.find(s=>s.name==='reconciled');
  assert.deepEqual(a.matrix,b.matrix); assert.notEqual(a.covarianceId,b.covarianceId);
});
test('actual off-diagonal covariance is not lost',async()=>{
  const {envelope,expected}=fixture(); const x=await inspectFsrtView(envelope,expected);
  const c=x.stages.find(s=>s.name==='reconciled'); assert.notEqual(c.matrix[0][1],0);
  assert.deepEqual(c.matrix,JSON.parse(envelope.payload).result.data.estimate.covariance);
});
const mutations = {
  'authority':v=>v.authority.state_admission='admitted',
  'verification':v=>v.result.verification_status='verified',
  'result binding':v=>v.result.execution_id='execution-'+'f'.repeat(32),
  'source order':v=>v.source.source_order.reverse(),
  'clock':v=>v.source.observed_at[0]='2026-01-01T00:00:00Z',
  'unit':v=>v.result.data.estimate.unit='g',
  'state order':v=>v.result.data.state_order.reverse(),
  'posterior covariance':v=>v.result.data.covariance_artifacts.posterior.matrix[0][1]+=1,
  'stage identity':v=>v.result.data.covariance_artifacts.reconciled.covariance_id=v.result.data.covariance_artifacts.posterior.covariance_id,
  'dependence':v=>v.result.data.covariance_artifacts.innovation.provenance.metadata.prior_independent_of_observations=false,
  'fault inference':v=>v.result.data.diagnostics.fault_attribution='sensor_1_failed',
  'boolean quantity':v=>v.result.data.estimate.values[0]=true,
  'missingness mismatch':v=>v.result.data.calibrated_observation.values[0]=null,
  'unknown operation':v=>v.execution.operation_id='fsrt.everything.v1',
  'model mismatch':v=>v.result.data.model.total_mass_kg=30,
  'frame':v=>v.result.data.covariance_artifacts.observation.frame='world',
};
for(const [name,change] of Object.entries(mutations)) {
  test('coherently rehashed '+name+' is refused',async()=>{
    const e=altered('ordinary',change); await assert.rejects(inspectFsrtView(e,e.sha256));
  });
}
test('held result cannot pretend correction was applied',async()=>{
  const e=altered('held',v=>v.result.data.residuals.correction=[0,0]); await assert.rejects(inspectFsrtView(e,e.sha256));
});
test('refused occurrence cannot acquire estimates',async()=>{
  const e=altered('refused',v=>v.result=JSON.parse(fixture().envelope.payload).result);
  await assert.rejects(inspectFsrtView(e,e.sha256));
});
test('wrong expected digest',async()=>{const {envelope}=fixture();await assert.rejects(inspectFsrtView(envelope,'sha256:'+'f'.repeat(64)));});
test('altered payload bytes',async()=>{const {envelope,expected}=fixture(); envelope.payload+=' ';await assert.rejects(inspectFsrtView(envelope,expected));});
for (const [name,raw] of [
  ['duplicate keys','{"schema":"ciw.fsrt-view.v1","schema":"ciw.fsrt-view.v1"}'],
  ['escaped duplicate','{"schema":1,"\\u0073chema":2}'],
  ['nonfinite','{"x":1e999}'], ['unsafe integer','{"x":9007199254740993}'],
  ['deep nesting','['.repeat(60)+'0'+']'.repeat(60)], ['oversize',' '.repeat(262145)]
]) test(name+' rejected',async()=>{
  const e={schema:'ciw.fsrt-view-envelope.v1',payload:raw,sha256:hash(raw)};
  await assert.rejects(inspectFsrtView(e,e.sha256));
});
test('mutation during asynchronous hash does not swap checked bytes',async()=>{
  const {envelope,expected}=fixture(); const promise=inspectFsrtView(envelope,expected);
  envelope.payload=fixture('held').envelope.payload; envelope.sha256=hash(envelope.payload);
  const x=await promise; assert.equal(x.held,false);
});
test('input mutation after return cannot change frozen inspection',async()=>{
  const {envelope,expected}=fixture(); const x=await inspectFsrtView(envelope,expected);
  assert.throws(()=>{x.data.estimate.values[0]=0;},TypeError);
  assert.throws(()=>{x.stages[0].matrix[0][0]=0;},TypeError);
});
