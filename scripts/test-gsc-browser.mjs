/** Real browser/WebGL regression. Run against an already-started local build. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
const base = process.env.GSC_TEST_URL ?? 'http://127.0.0.1:3000';
const output = process.env.GSC_BROWSER_ARTIFACTS ?? '/tmp/gsc-browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.GSC_CHROMIUM ? { executablePath: process.env.GSC_CHROMIUM } : {}),
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
const errors = [], unexpectedRequests = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
await page.route('**/*', (route) => {
  const url = new URL(route.request().url());
  if (url.origin !== new URL(base).origin && ['http:', 'https:'].includes(url.protocol)) {
    unexpectedRequests.push(url.origin + url.pathname); return route.abort();
  }
  return route.continue();
});
const check = (name, condition) => { assert.ok(condition, name); console.log(`PASS ${name}`); };
async function ready(kind) {
  await page.waitForFunction((k) => document.querySelector(`[data-testid="${k}-view"]`)?.getAttribute('data-status') === 'ready', kind, { timeout: 90_000 });
}
async function setRange(label, value) {
  await page.getByRole('slider', { name: label, exact: true }).evaluate((node, v) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(node, v); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }));
  }, String(value));
}
try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Geospatial Systems Compiler', exact: true }).waitFor();
  await ready('map');
  check('map renders a WebGL canvas', await page.locator('[data-testid="map-view"] canvas').count() === 1);
  check('full synthetic corpus reaches shared IR', Number(await page.getByTestId('eligible-count').textContent()) > 200);
  await page.getByRole('searchbox', { name: 'Find eligible records' }).fill('Shanghai');
  await page.locator('aside button').first().click();
  const selection = await page.getByTestId('selection').getAttribute('data-record');
  check('selection has compiled identity, not fabricated evidence identity', selection.includes('gsv.world-snapshot.v1') || selection.includes('gsv'));
  await page.getByTestId('dynamic-state').waitFor();
  const dynamicAtStart = await page.getByTestId('dynamic-state').textContent();
  await page.screenshot({ path: path.join(output, 'map.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Globe', exact: true }).click(); await ready('globe');
  check('selection survives map -> globe', await page.getByTestId('selection').getAttribute('data-record') === selection);
  check('old map canvas disposed on switch', await page.locator('[data-testid="map-view"] canvas').count() === 0);
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(output, 'globe.png'), fullPage: true });
  const previousTime = await page.getByTestId('event-time').textContent();
  await page.getByRole('button', { name: 'Play synthetic timeline' }).click();
  await page.waitForFunction((old) => document.querySelector('[data-testid="event-time"]').textContent !== old, previousTime);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  check('provider output is recomputed at changed event time', await page.getByTestId('dynamic-state').textContent() !== dynamicAtStart);
  const savedTime = await page.getByTestId('event-time').textContent();
  const minimum = await page.getByRole('slider', { name: 'Knowledge cutoff', exact: true }).getAttribute('min');
  await setRange('Knowledge cutoff', minimum);
  await page.getByText('Selected record is not eligible at these clocks.', { exact: false }).waitFor();
  check('withheld selection identity retained', await page.getByTestId('selection').getAttribute('data-record') === selection);
  check('knowledge change does not change event time', await page.getByTestId('event-time').textContent() === savedTime);
  check('future source values are withheld from inspector', await page.getByTestId('dynamic-state').count() === 0);
  await setRange('Knowledge cutoff', Date.parse('2026-08-31T14:00:00Z'));
  await page.getByTestId('dynamic-state').waitFor();
  await page.getByRole('tab', { name: 'Records', exact: true }).click();
  check('selection survives non-spatial view', await page.getByTestId('selection').getAttribute('data-record') === selection);
  check('globe canvas disposed on switch', await page.locator('[data-testid="globe-view"] canvas').count() === 0);
  for (let i = 0; i < 2; i++) {
    await page.getByRole('tab', { name: 'Globe', exact: true }).click(); await ready('globe');
    await page.setViewportSize({ width: 1100 + i * 50, height: 850 });
    await page.waitForTimeout(150);
    const dims = await page.locator('[data-testid="globe-view"]').evaluate((host) => ({
      host: [host.clientWidth, host.clientHeight], canvas: [host.firstElementChild.clientWidth, host.firstElementChild.clientHeight] }));
    check(`globe resize ${i + 1} follows container`, JSON.stringify(dims.host) === JSON.stringify(dims.canvas));
    await page.getByRole('tab', { name: 'Map', exact: true }).click(); await ready('map');
  }
  await page.setViewportSize({ width: 540, height: 900 }); await page.waitForTimeout(200);
  check('mobile page fits viewport', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
  check('public demo makes no external network requests', unexpectedRequests.length === 0);
  check('browser has no uncaught or console errors', errors.length === 0);
  console.log(JSON.stringify({ errors, unexpectedRequests, webgl: 'Chromium ANGLE/SwiftShader software WebGL; not physical GPU benchmarking' }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ errors, unexpectedRequests }, null, 2));
  console.error(await page.locator('main').innerText({ timeout: 1000 }).catch(() => 'main not available'));
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally { await browser.close(); }
