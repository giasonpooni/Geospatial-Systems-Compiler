// Real exported synthetic investigations, read locally by the existing /numerics route.
import assert from 'node:assert/strict';
import {readFileSync, mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const root=process.env.FSRT_VIEW_FIXTURES;
if(!root) throw new Error('Actual retained fixture directory required');
const index=JSON.parse(readFileSync(join(root,'index.json'),'utf8'));
const port=Number(process.env.FSRT_BROWSER_PORT??3318);
const url=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{stdio:'inherit'});
let browser;
try {
  let ready=false;
  for(let i=0;i<100;i++) {
    if(server.exitCode!==null) throw new Error('Next server exited');
    try {const response=await fetch(url+'/numerics'); if(response.ok){ready=true;break;}} catch {}
    await new Promise(r=>setTimeout(r,300));
  }
  assert.ok(ready,'Next server readiness');
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1100,height:850}});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url+'/numerics');
  const requests=[]; page.on('request',r=>requests.push({method:r.method(),url:r.url()}));
  const file=page.locator('input[type=file]'), digest=page.locator('input[placeholder="sha256:…"]');
  async function load(name){
    await file.setInputFiles(resolve(root,index[name].view)); await digest.fill(index[name].view_sha256);
    await page.getByRole('button',{name:'Inspect retained result',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Bytes match'}).waitFor();
  }
  await load('ordinary');
  assert.equal(await page.getByRole('region',{name:/^Covariance (observation|prior|declared_total|innovation|posterior|reconciled)$/}).count(),6);
  const native=JSON.parse(JSON.parse(readFileSync(join(root,index.ordinary.view),'utf8')).payload);
  const cross=String(native.result.data.estimate.covariance[0][1]);
  assert.ok((await page.getByRole('region',{name:'Covariance reconciled',exact:true}).innerText()).includes(cross));
  await load('held');
  await page.getByRole('heading',{name:'Correction held — original posterior retained',exact:true}).waitFor();
  assert.ok((await page.locator('[aria-label="Balance residuals"]').innerText()).includes('Not applied'));
  await digest.fill('sha256:'+'f'.repeat(64));
  assert.equal(await page.getByRole('region',{name:'Fluid snapshot',exact:true}).count(),0);
  await page.getByRole('button',{name:'Inspect retained result',exact:true}).click();
  await page.getByRole('status').filter({hasText:'External artifact selection differs'}).waitFor();
  await load('refused');
  await page.getByRole('heading',{name:'Execution refused — no estimate produced',exact:true}).waitFor();
  assert.equal(await page.getByRole('table',{name:'Observed and estimated masses'}).count(),0);
  await load('legacy');
  assert.equal(await page.getByRole('region',{name:/^Covariance (observation|posterior|reconciled)$/}).count(),3);
  assert.ok((await page.getByRole('region',{name:'Covariance posterior',exact:true}).innerText()).includes('Legacy v1 matrix'));
  // Force a slow digest so file/digest invalidation is tested before completion.
  await page.evaluate(()=>{const original=crypto.subtle.digest.bind(crypto.subtle); crypto.subtle.digest=async (...args)=>{await new Promise(r=>setTimeout(r,250));return original(...args);};});
  await file.setInputFiles(resolve(root,index.held.view)); await digest.fill(index.held.view_sha256);
  await page.getByRole('button',{name:'Inspect retained result',exact:true}).click();
  await digest.fill('sha256:'+'e'.repeat(64)); await page.waitForTimeout(500);
  assert.equal(await page.getByRole('region',{name:'Fluid snapshot',exact:true}).count(),0);
  await page.setViewportSize({width:700,height:900}); await load('held');
  assert.ok(await page.getByRole('heading',{name:'Correction held — original posterior retained',exact:true}).isVisible());
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Page must not overflow horizontally');
  const screenshots=process.env.FSRT_BROWSER_OUT;
  if(screenshots){mkdirSync(screenshots,{recursive:true});await page.screenshot({path:join(screenshots,'held-fluid-snapshot.png'),fullPage:true});}
  assert.deepEqual(errors,[]);
  assert.equal(requests.filter(r=>r.method!=='GET'||(!r.url.startsWith(url)&&!r.url.startsWith('data:'))).length,0,'No upload or external execution requests');
  console.log('FSRT browser: actual ordinary/held/refused/legacy, covariance cross term, stale async, 700px layout, no upload/page errors passed');
} finally {
  if(browser) await browser.close();
  server.kill('SIGTERM');
}
