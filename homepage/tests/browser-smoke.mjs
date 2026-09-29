/** Real GSV in both retained inspection and opt-in company exhibition views. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startStaticServer } from '../scripts/serve.mjs';
const modulePath = process.env.PLAYWRIGHT_MODULE;
assert.ok(modulePath, 'Set PLAYWRIGHT_MODULE to pinned playwright/index.mjs');
const { chromium } = await import(pathToFileURL(resolve(modulePath)).href);
const evidence = resolve('homepage/evidence');
await mkdir(evidence, { recursive: true });
const root = resolve('homepage/dist');
const manifest = JSON.parse(await readFile(resolve(root, 'build-manifest.json'), 'utf8'));
const server = await startStaticServer(root);
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const records = [], errors = [];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const viewports = [{width:1440,height:1000},{width:768,height:1000},{width:390,height:844},{width:320,height:844},{width:844,height:390}];
async function ready(frame) {
  await frame.waitForFunction(() => Boolean(window.payloadEarth?.api?.store?.snapshot), null, {timeout:90000});
  await frame.locator('#boot').waitFor({state:'detached',timeout:30000});
}
async function bounds(locator) {
  return locator.evaluate(el => { const r = el.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,viewWidth:innerWidth,viewHeight:innerHeight}; });
}
function fits(r, label) {
  assert.ok(r.width>0 && r.height>0 && r.left>=-1 && r.right<=r.viewWidth+1 && r.top>=-1 && r.bottom<=r.viewHeight+1, `${label} must fit its viewport: ${JSON.stringify(r)}`);
}
async function provenance(frame) {
  const value = await frame.evaluate(() => {
    const snapshot=window.payloadEarth.api.store.snapshot;
    const records=['nodes','routes','flows','commodities','events','constraints','assertions','observations'].flatMap(key=>snapshot[key]);
    return {count:records.length,allSynthetic:records.every(row=>row.provenance.source==='synthetic:demo'),frozen:Object.isFrozen(snapshot)};
  });
  assert.equal(value.count,manifest.domainRecords.count); assert.equal(value.allSynthetic,true); assert.equal(value.frozen,true);
  return value;
}
async function commands(frame, fromCanvas=false) {
  await frame.locator(fromCanvas?'#scene':'.pe-cb-tab').first().press('/');
  const input=frame.locator('.pe-cb-search');
  assert.equal(await input.evaluate(el=>el===document.activeElement),true);
  const results=[];
  for (const command of manifest.gsv.commandHints) {
    await input.fill(command); await input.press('Enter');
    await frame.locator('.pe-cb-result').waitFor({state:'visible'});
    assert.equal(await frame.locator('.pe-cb-result').evaluate(el=>el.classList.contains('err')),false,command);
    results.push({command,message:await frame.locator('.pe-cb-result').innerText()});
  }
  await input.press('Escape');
  return results;
}
try {
  for (const viewport of viewports) {
    const context=await browser.newContext({viewport,reducedMotion:'reduce'});
    const page=await context.newPage();
    const requests=[],pageErrors=[],failed=[],badResponses=[];
    page.on('request',request=>requests.push({url:request.url(),method:request.method()}));
    page.on('pageerror',error=>pageErrors.push(error.message));
    page.on('requestfailed',request=>failed.push(request.url()));
    page.on('response',response=>{if(response.status()>=400)badResponses.push({url:response.url(),status:response.status()});});
    const label=`${viewport.width}x${viewport.height}`;
    try {
      assert.equal((await page.goto(origin,{waitUntil:'networkidle'})).status(),200);
      const frame=page.frames().find(frame=>frame.url().includes('/exhibit/'));
      assert.ok(frame); await ready(frame);
      assert.equal(page.frames().length,2);
      assert.equal(await page.locator('iframe').count(),1);
      assert.equal(await page.locator('canvas').count(),0);
      assert.equal(await page.evaluate(()=>typeof window.payloadEarth),'undefined');
      assert.equal(await frame.locator('html').getAttribute('data-presentation'),'exhibit');
      assert.equal(await frame.locator('.pe-commandbar').isVisible(),false);
      assert.equal(await frame.locator('.pe-layerpanel').isVisible(),false);
      assert.equal(await frame.locator('.pi-timeline').isVisible(),false);
      assert.equal(await frame.locator('.pe-sb-seg').first().isVisible(),false);
      assert.equal(await frame.locator('.pe-sb-chip').innerText(),'SYNTHETIC / DEMO DATA');
      const chip=await bounds(frame.locator('.pe-sb-chip')); fits(chip,'Original synthetic chip');
      assert.equal(await frame.evaluate(()=>window.payloadEarth.api.getLayers().some(layer=>layer.visible)),false);
      const frameRect=await bounds(page.locator('iframe')); fits(frameRect,'Exhibition');
      assert.ok(Math.abs(frameRect.width-frameRect.height)<1,'Exhibition viewport is square, not stretched');
      assert.equal(await frame.locator('#scene').evaluate(el=>el.width===el.height),true,'Actual render target is square');
      const title=await bounds(page.locator('.wordmark')), nav=await bounds(page.locator('.primary-nav')), legal=await bounds(page.locator('.legal-footer nav'));
      for (const [name,r] of Object.entries({title,nav,legal}))fits(r,name);
      assert.ok(title.left<nav.left && title.top<100 && nav.top<100);
      assert.ok(Math.abs((legal.left+legal.right)/2-viewport.width/2)<1,'Legal links centered');
      assert.ok(legal.bottom>viewport.height-65,'Legal links at the bottom');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1 && document.documentElement.scrollHeight<=innerHeight+1),true,'No landing-page scroll');
      const sourceCheck=await provenance(frame);
      const original=await frame.evaluate(()=>JSON.stringify(window.payloadEarth.api.store.snapshot));
      const timeOrigin=await frame.evaluate(()=>performance.timeOrigin),pageUrl=page.url();
      const screenshot = await page.screenshot({path:resolve(evidence,`homepage-${label}.png`)});
      // Check the rendered pixels, not just CSS tokens: the existing GSV
      // output pass converts its clear color before displaying it.
      const background = await page.evaluate(async ({bytes, rect}) => {
        const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], {type:'image/png'}));
        const canvas = new OffscreenCanvas(image.width, image.height);
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const pixel = (x,y) => [...context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data];
        const samples = {page:pixel(1,1), exhibit:pixel(rect.left+4,rect.top+4)};
        image.close();
        return samples;
      }, {bytes:[...screenshot], rect:frameRect});
      assert.deepEqual(background.exhibit,background.page,'Globe viewport must not appear as a contrasting rectangle');
      const dialogResults=[];
      for (const id of ['about','contact','licences']) {
        const trigger=page.locator(`[data-window="${id}"]`).first();
        const dialog=page.locator(`dialog#${id}`),close=dialog.locator('[data-close]');
        await trigger.click();
        assert.equal(await dialog.evaluate(el=>el.matches(':modal')),true);
        assert.equal(page.url(),pageUrl,'Opening a company window must not navigate');
        assert.equal(await close.evaluate(el=>el===document.activeElement),true);
        fits(await bounds(close),`${id} close button`);
        assert.ok((await bounds(close)).right>(await bounds(dialog)).right-65,'X is top-right');
        await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
        assert.equal(await close.evaluate(el=>el===document.activeElement),true,'Focus cycles inside dialog');
        if (viewport.width===1440 || viewport.width===390) await page.screenshot({path:resolve(evidence,`${id}-${label}.png`)});
        await close.click(); await dialog.waitFor({state:'hidden'});
        assert.equal(await trigger.evaluate(el=>el===document.activeElement),true,'Close restores opener focus');
        await trigger.click(); await page.keyboard.press('Escape'); await dialog.waitFor({state:'hidden'});
        assert.equal(await trigger.evaluate(el=>el===document.activeElement),true,'Escape restores focus');
        dialogResults.push({id,xClose:true,escapeClose:true,focusTrap:true,focusRestored:true});
      }
      assert.equal(await page.locator('#contact .email-link').getAttribute('href'),'mailto:info@notationsystems.com');
      assert.equal(await page.locator('form').count(),0);
      assert.equal(await frame.evaluate(()=>performance.timeOrigin),timeOrigin,'No iframe reload when dialogs open/close');
      assert.equal(await frame.evaluate(()=>JSON.stringify(window.payloadEarth.api.store.snapshot)),original);
      // Exercise real pointer and wheel input. No scripted camera setter.
      const canvas=frame.locator('#scene'), box=await canvas.boundingBox();
      const beforeDrag=digest(await canvas.screenshot());
      const cx=box.x+box.width/2,cy=box.y+box.height/2;
      await page.mouse.move(cx,cy); await page.mouse.down(); await page.mouse.move(cx+45,cy+12,{steps:12}); await page.mouse.up();
      await page.waitForTimeout(400);
      const afterDrag=digest(await canvas.screenshot());
      assert.notEqual(beforeDrag,afterDrag,'Dragging changes the rendered view');
      const altitudeBefore=await frame.evaluate(()=>window.payloadEarth.api.camera.altitudeRadii());
      await page.mouse.move(cx,cy); await page.mouse.wheel(0,-180);
      await frame.waitForFunction(before=>Math.abs(window.payloadEarth.api.camera.altitudeRadii()-before)>.001,altitudeBefore);
      const commandResults=await commands(frame,true);
      assert.equal(await frame.locator('.pe-commandbar').isVisible(),false,'Escape restores quiet exhibit');
      assert.equal(await frame.evaluate(()=>JSON.stringify(window.payloadEarth.api.store.snapshot)),original);
      assert.deepEqual(pageErrors,[]); assert.deepEqual(failed,[]); assert.deepEqual(badResponses,[]);
      assert.ok(requests.every(request=>request.url.startsWith(origin+'/') && ['GET','HEAD'].includes(request.method)));
      assert.ok(requests.every(request=>!new URL(request.url).pathname.startsWith('/api/')));
      records.push({viewport,presentation:'exhibit',sourceCheck,chip,frameRect,background,dialogResults,commandResults,dragChangedRender:true,wheelChangedCamera:true,snapshotUnchanged:true,iframeNotReloaded:true,requests});
    } catch(error) {
      errors.push({viewport,message:String(error),stack:error.stack,pageErrors,failed,badResponses});
      await page.screenshot({path:resolve(evidence,`failure-${label}.png`),fullPage:true}).catch(()=>{});
    } finally { await context.close(); }
  }
  // The full inspection entrypoint remains available and unmodified by opt-in CSS.
  for (const viewport of [viewports[0],viewports[2]]) {
    const context=await browser.newContext({viewport}); const page=await context.newPage();
    try {
      await page.goto(origin+'/exhibit/',{waitUntil:'networkidle'}); await ready(page.mainFrame());
      assert.equal(await page.locator('html').getAttribute('data-presentation'),'inspection');
      for (const selector of ['.pe-commandbar','.pe-layerpanel','.pi-timeline','.pe-statusbar'])assert.equal(await page.locator(selector).isVisible(),true);
      fits(await bounds(page.locator('.pe-sb-chip')),'Retained inspection chip');
      const sourceCheck=await provenance(page.mainFrame());
      const original=await page.evaluate(()=>JSON.stringify(window.payloadEarth.api.store.snapshot));
      const commandResults=await commands(page.mainFrame());
      assert.equal(await page.evaluate(()=>JSON.stringify(window.payloadEarth.api.store.snapshot)),original);
      records.push({viewport,presentation:'inspection',sourceCheck,commandResults,snapshotUnchanged:true});
    } catch(error) { errors.push({viewport,presentation:'inspection',message:String(error)}); }
    finally { await context.close(); }
  }
  const noJS=await browser.newContext({javaScriptEnabled:false,viewport:viewports[2]}); const fallback=await noJS.newPage();
  await fallback.goto(origin);
  assert.equal(await fallback.locator('h1').innerText(),'Notation Systems');
  assert.equal(await fallback.locator('.fallback').isVisible(),true);
  for (const id of ['about','contact','licences']) {
    await fallback.locator(`[data-window="${id}"]`).first().click();
    assert.equal(await fallback.locator(`dialog#${id}`).isVisible(),true);
    await fallback.locator(`dialog#${id} [data-close]`).click();
    assert.equal(await fallback.locator(`dialog#${id}`).isVisible(),false);
  }
  await noJS.close();
  for (const path of ['/api/economy','/api/economy/shipments','/api/freight','/operations','/.env','/spatial.map'])assert.equal((await fetch(origin+path)).status,404);
  for (const method of ['POST','PUT','PATCH','DELETE'])assert.equal((await fetch(origin+'/api/economy',{method})).status,405);
  await writeFile(resolve(evidence,'browser-report.json'),JSON.stringify({status:errors.length?'failed':'passed',shellCommit:manifest.shellCommit,gsvCommit:manifest.gsv.commit,records,errors,noJavaScriptWindows:true,staticRouteChecks:true},null,2)+'\n');
  if(errors.length)throw new Error(JSON.stringify(errors,null,2));
  console.log('Browser acceptance passed: square exhibition, minimal corners/footer, native windows, X/Escape/focus, no reload, real drag/zoom, retained inspection, synthetic immutable snapshot, no writes or third-party requests, no-JS windows.');
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
