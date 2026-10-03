// Run after production build. Baselines must be actual NET/Godot/FSRT exports.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const root=process.env.SIMULATED_FSRT_VIEW_FIXTURES;
if(!root)throw Error('Actual synthetic-source views are required');
const index=JSON.parse(readFileSync(join(root,'index.json'),'utf8'));
const legacyRoot=process.env.FSRT_VIEW_FIXTURES;
const legacy=legacyRoot?JSON.parse(readFileSync(join(legacyRoot,'index.json'),'utf8')):null;
const hash=x=>'sha256:'+createHash('sha256').update(x).digest('hex');
for(const item of Object.values(index))assert.equal(hash(readFileSync(join(root,item.view))),item.file_sha256);
const port=3321,url=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{stdio:'inherit'});
let browser;
try {
  let ready=false;
  for(let i=0;i<100;i++){
    if(server.exitCode!==null)throw Error('Production server exited');
    try {if((await fetch(url+'/numerics')).ok){ready=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,300));
  }
  assert.ok(ready,'Production route readiness');
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1100,height:850},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url+'/numerics');
  const requests=[];page.on('request',r=>requests.push({method:r.method(),url:r.url()}));
  const file=page.locator('input[type=file]'),expected=page.locator('input[placeholder="sha256:…"]');
  const region=()=>page.getByRole('region',{name:'Simulated fluid snapshot',exact:true});
  async function load(name,from=root,records=index){
    await file.setInputFiles(resolve(from,records[name].view));await expected.fill(records[name].view_sha256);
    await page.getByRole('button',{name:'Inspect retained result',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Bytes match'}).waitFor();
  }
  await load('ordinary');
  assert.ok((await region().innerText()).includes('not a physical measurement or calibration'));
  assert.ok((await page.locator('[aria-label="Simulation clock"]').innerText()).includes('tick 1 at 10 ticks/s · post_step · 0.1 s'));
  assert.equal(await page.getByRole('region',{name:/^Covariance (observation|prior|declared_total|innovation|posterior|reconciled)$/}).count(),6);
  assert.ok((await page.getByRole('region',{name:'Covariance observation',exact:true}).innerText()).includes('0.1'));
  const view=JSON.parse(JSON.parse(readFileSync(join(root,index.ordinary.view),'utf8')).payload);
  assert.ok((await page.locator('[aria-label="Source engine occurrence"]').innerText()).includes(JSON.parse(view.source.payload).producer.execution_id));
  assert.ok((await page.locator('[aria-label="Estimator occurrence"]').innerText()).includes(view.execution.execution_id));
  await load('missing');
  assert.ok((await page.getByRole('table',{name:'Observed and estimated masses'}).innerText()).includes('Missing observation'));
  assert.equal(await page.getByRole('region',{name:'Covariance innovation',exact:true}).locator('tbody tr').count(),1);
  await load('held');
  await page.getByRole('heading',{name:'Correction held — original posterior retained',exact:true}).waitFor();
  assert.ok((await page.locator('[aria-label="Balance residuals"]').innerText()).includes('Not applied'));
  for(const name of ['both_missing','singular']){
    await load(name);await page.getByRole('heading',{name:'Execution refused — no estimate produced',exact:true}).waitFor();
    assert.equal(await page.getByRole('table',{name:'Observed and estimated masses'}).count(),0);
    assert.equal(await page.getByRole('region',{name:'Fluid covariance stages',exact:true}).count(),0);
  }
  if(legacy){
    await load('ordinary',legacyRoot,legacy);
    assert.equal(await region().count(),0);
    assert.equal(await page.getByRole('region',{name:'Fluid snapshot',exact:true}).count(),1);
    await load('ordinary');
    assert.equal(await page.getByRole('region',{name:'Fluid snapshot',exact:true}).count(),0);
  }
  await expected.fill('sha256:'+'f'.repeat(64));assert.equal(await region().count(),0);
  await page.getByRole('button',{name:'Inspect retained result',exact:true}).click();
  await page.getByRole('status').filter({hasText:'External artifact selection differs'}).waitFor();
  // Delay both outer and original-source hashes to challenge source-switch fencing.
  await page.evaluate(()=>{const old=crypto.subtle.digest.bind(crypto.subtle);crypto.subtle.digest=async(...args)=>{await new Promise(r=>setTimeout(r,150));return old(...args);};});
  await file.setInputFiles(resolve(root,index.ordinary.view));await expected.fill(index.ordinary.view_sha256);
  await page.getByRole('button',{name:'Inspect retained result',exact:true}).click();
  await file.setInputFiles(resolve(root,index.held.view));await page.waitForTimeout(500);
  assert.equal(await region().count(),0);
  await page.setViewportSize({width:700,height:900});await load('held');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'No page-level horizontal overflow');
  await page.mouse.move(650,850);await page.mouse.wheel(0,1500);await page.waitForFunction(()=>scrollY>0);
  const panel=page.getByRole('region',{name:'Covariance reconciled',exact:true});await panel.scrollIntoViewIfNeeded();
  const bounds=await panel.boundingBox();assert.ok(bounds&&bounds.y>=0&&bounds.y+bounds.height<=902,'Final covariance reachable');
  const out=process.env.SIMULATED_FSRT_BROWSER_OUT;
  if(out){mkdirSync(out,{recursive:true});await page.screenshot({path:join(out,'synthetic-covariance-visible.png')});
    await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.waitForFunction(()=>scrollY===0);
    await page.screenshot({path:join(out,'synthetic-held-inspector.png'),fullPage:true});}
  assert.deepEqual(errors,[]);
  assert.equal(requests.filter(r=>r.method!=='GET'||(!r.url.startsWith(url)&&!r.url.startsWith('data:'))).length,0,'No upload or remote execution during inspection');
  console.log('Synthetic FSRT browser passed: five actual cases, original tick/time, provenance labels, covariance, missingness, stale source/digest, 700px scrolling, legacy switching='+Boolean(legacy));
} finally {if(browser)await browser.close();server.kill('SIGTERM');}
