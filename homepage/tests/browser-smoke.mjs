/** Production-only browser acceptance. No fake globe is allowed in this test. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startStaticServer } from '../scripts/serve.mjs';
const modulePath = process.env.PLAYWRIGHT_MODULE;
assert.ok(modulePath, 'Set PLAYWRIGHT_MODULE to an installed, pinned playwright/index.mjs');
const { chromium } = await import(pathToFileURL(resolve(modulePath)).href);
const root = resolve('homepage/dist');
const evidence = resolve('homepage/evidence');
await mkdir(evidence, {recursive:true});
const manifest = JSON.parse(await readFile(resolve(root, 'build-manifest.json'), 'utf8'));
assert.ok(manifest.domainRecords.count > 0);
const server = await startStaticServer(root);
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless:true, args:['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
const records = [];
try {
  for (const viewport of [{width:1440,height:1100},{width:390,height:844}]) {
    const context = await browser.newContext({viewport, reducedMotion:'reduce'});
    const page = await context.newPage();
    const requests = []; const errors = []; const failures = [];
    page.on('request', req => requests.push({url:req.url(), method:req.method()}));
    page.on('pageerror', err => errors.push(err.message));
    page.on('requestfailed', req => failures.push({url:req.url(), error:req.failure()?.errorText}));
    const response = await page.goto(origin, {waitUntil:'networkidle'});
    assert.equal(response.status(), 200);
    const frame = page.frames().find(frame => frame.url().startsWith(origin+'/exhibit/'));
    assert.ok(frame, 'GSV is the only child browsing context');
    await frame.waitForFunction(() => Boolean(window.payloadEarth?.api?.store?.snapshot), null, {timeout:90000});
    await frame.locator('#boot').waitFor({state:'detached',timeout:30000});
    assert.equal(page.frames().length, 2);
    assert.equal(await page.locator('iframe').count(), 1);
    assert.equal(await page.locator('canvas').count(), 0);
    assert.equal(await page.locator('.surfaces a, .surfaces button').count(), 0);
    assert.equal(await page.locator('#build-status').isVisible(), true);
    assert.match(await page.locator('#build-status').innerText(), /Synthetic snapshot/);
    assert.equal(await frame.locator('.pe-sb-chip').isVisible(), true);
    assert.equal(await frame.locator('.pe-sb-chip').innerText(), 'SYNTHETIC / DEMO DATA');
    const original = await frame.evaluate(() => JSON.stringify(window.payloadEarth.api.store.snapshot));
    const sourceCheck = await frame.evaluate(() => {
      const snapshot = window.payloadEarth.api.store.snapshot;
      const rows = ['nodes','routes','flows','commodities','events','constraints','assertions','observations'].flatMap(key => snapshot[key]);
      return {count:rows.length, allSynthetic:rows.every(row => row.provenance.source==='synthetic:demo'), frozen:Object.isFrozen(snapshot)};
    });
    assert.equal(sourceCheck.allSynthetic,true); assert.equal(sourceCheck.frozen,true);
    assert.equal(sourceCheck.count,manifest.domainRecords.count);
    // Actual keyboard command path, not a homepage proxy or fabricated buttons.
    await frame.locator('body').press('/');
    const input = frame.locator('.pe-cb-search');
    assert.equal(await input.evaluate(el => el===document.activeElement), true);
    for (const command of manifest.gsv.commandHints) {
      await input.fill(command); await input.press('Enter');
      await frame.locator('.pe-cb-result').waitFor({state:'visible'});
      assert.equal(await frame.locator('.pe-cb-result').evaluate(el=>el.classList.contains('err')), false, `Unsupported hint: ${command}`);
    }
    await input.press('Escape');
    assert.equal(await frame.evaluate(() => JSON.stringify(window.payloadEarth.api.store.snapshot)), original, 'View commands must not replace or mutate the snapshot');
    assert.equal(await page.evaluate(()=>typeof window.payloadEarth), 'undefined', 'No parent command bridge');
    const dimensions = await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
    assert.ok(dimensions.scroll <= dimensions.width + 1, 'Homepage horizontal overflow');
    await page.screenshot({path:resolve(evidence,`homepage-${viewport.width}.png`),fullPage:true});
    await page.locator('#exhibit').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#build-status').isVisible(), true);
    await page.screenshot({path:resolve(evidence,`exhibit-${viewport.width}.png`)});
    assert.deepEqual(errors, [], 'Browser execution errors');
    assert.deepEqual(failures, [], 'Failed resource requests');
    assert.ok(requests.every(req=>req.url.startsWith(origin+'/') && ['GET','HEAD'].includes(req.method)), 'Only local static read requests');
    assert.ok(requests.every(req=>!new URL(req.url).pathname.startsWith('/api/')), 'No operational API requests');
    records.push({viewport,sourceCheck,requests,errors,failures});
    await context.close();
  }
  const noJS = await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});
  const fallback = await noJS.newPage(); await fallback.goto(origin);
  assert.equal(await fallback.locator('h1').innerText(),'Notation Systems');
  assert.equal(await fallback.locator('#build-status').isVisible(),true);
  assert.match(await fallback.locator('#exhibit-caption').innerText(),/Not live shipments/);
  assert.equal(await fallback.locator('.source-links a').count(),3);
  await noJS.close();
  for (const path of ['/api/economy','/api/economy/shipments','/api/freight','/operations','/.env','/spatial.map']) assert.equal((await fetch(origin+path)).status,404);
  for (const method of ['POST','PUT','PATCH','DELETE']) assert.equal((await fetch(origin+'/api/economy',{method})).status,405);
  await writeFile(resolve(evidence,'browser-report.json'), JSON.stringify({gsvCommit:manifest.gsv.commit,records,noJavaScriptFallback:true,staticRouteChecks:true},null,2)+'\n');
  console.log('Browser acceptance passed: real GSV, desktop + mobile, original synthetic chip, all four hints, unchanged immutable snapshot, no third-party or write requests, no-JS fallback.');
} finally {
  await browser.close(); await new Promise(resolve=>server.close(resolve));
}
