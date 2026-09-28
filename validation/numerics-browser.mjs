// Browser integration fixtures are not evidence of native numerical execution.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const base = 'http://127.0.0.1:3101';
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3101'], { stdio: 'inherit' });
const hash = text => 'sha256:'+createHash('sha256').update(text).digest('hex');
const wrap = (schema,value) => { const payload=JSON.stringify(value); return {schema,payload,sha256:hash(payload)}; };
let browser;
try {
  let ready=false;
  for(let i=0;i<120;i++) {
    try { if((await fetch(base+'/numerics')).ok) { ready=true; break; } } catch {}
    if(server.exitCode !== null) throw new Error('Next server exited');
    await new Promise(r=>setTimeout(r,500));
  }
  assert.ok(ready,'Numerics page must be served');
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const d='sha256:'+'a'.repeat(64);
  const mean=wrap('notation.linear-map-view-envelope.v1', {
    schema:'notation.linear-map-view.v1',case_digest:d,model:{owner:'browser fixture',kind:'not-native-evidence',digest:d},
    frame:'local-fixture',provider:'cpp',native_profile:'affine-binary64.v1',bundle_digest:d,result_id:d,
    numerical_result_id:d,execution_id:'execution-'+'b'.repeat(32),verification_id:d,runtime_digest:d,
    outputs:[{id:'difference',unit:'m',baseline:0,delta:-1,value:-1},{id:'sum',unit:'m',baseline:0,delta:5,value:5}],
    claim_scope:'first-order-mean-response-only',covariance:'not_propagated',may_authorize:false,
    physical_validation:'not_established',sp1_verification:'not_performed',state_admission:'not_performed'});
  const view=wrap('notation.linear-uncertainty-view-envelope.v1', {
    schema:'notation.linear-uncertainty-view.v1',mean,quantity_ids:['difference','sum'],units:['m','m'],
    frame:'local-fixture',matrix:[[7,-5],[-5,19]],covariance_id:d,input_covariance_id:d,
    calculation_id:d,verification_id:d,native_stage_count:5,scope:'fixed-jacobian-input-covariance-only',may_authorize:false});
  await page.goto(base+'/numerics');
  const file=page.getByLabel('Retained view JSON');
  const pin=page.getByLabel('Expected SHA-256 from your trusted artifact record');
  const button=page.getByRole('button',{name:'Inspect retained result'});
  await file.setInputFiles({name:'fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(view))});
  await pin.fill(view.sha256); await button.click();
  await page.getByRole('heading',{name:'Full propagated covariance'}).waitFor();
  assert.equal(await page.getByRole('region',{name:'Full covariance'}).getByRole('cell',{name:'-5',exact:true}).count(),2);
  assert.match(await page.getByRole('status').innerText(),/Bytes match/);
  await page.setViewportSize({width:700,height:900});
  assert.ok(await page.getByRole('heading',{name:'Retained numerical results'}).isVisible());
  await pin.fill('sha256:'+'0'.repeat(64));
  assert.equal(await page.getByRole('region',{name:'Full covariance'}).count(),0);
  await button.click();
  await page.waitForFunction(()=>document.querySelector('[role=status]')?.textContent?.includes('selection differs'));
  await file.setInputFiles({name:'mean.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(mean))});
  await pin.fill(mean.sha256); await button.click();
  await page.getByText('No propagated covariance accompanies this mean-only view.').waitFor();
  assert.equal(await page.getByRole('region',{name:'Full covariance'}).count(),0);
  assert.deepEqual(errors,[]);
  console.log('Browser checks passed: covariance, cross terms, invalidation, refusal, legacy mean, 700px, no page errors.');
} finally { if(browser) await browser.close(); server.kill('SIGTERM'); }
