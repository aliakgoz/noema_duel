import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const artifacts = new URL('../artifacts/e2e/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const result = { baseURL, startedAt: new Date().toISOString(), checks: [], errors: [], consoleErrors: [], failedRequests: [] };
let offlineProbe;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
function observe(page) {
  page.on('pageerror', error => result.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') result.consoleErrors.push(message.text()); });
  page.on('requestfailed', request => result.failedRequests.push({ url: request.url(), type: request.resourceType(), origin: request.headers().origin ?? null, error: request.failure()?.errorText }));
}
async function ready(page) {
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.locator('.scene-host canvas').waitFor({ state: 'visible', timeout: 20_000 });
  assert.equal(await page.locator('.scene-error').count(), 0, '3D scene must initialize');
  await page.waitForFunction(() => document.querySelector('.training-status small')?.textContent?.includes('kaydedildi'));
}
async function fits(page, label) {
  const dimensions = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
  assert.ok(dimensions.content <= dimensions.width + 1, `${label}: horizontal overflow ${JSON.stringify(dimensions)}`);
  result.checks.push(`${label}: no horizontal overflow`);
}
async function screenshot(page, name) { if (process.env.NO_SCREENSHOTS !== '1') await page.screenshot({ path: new URL(name, artifacts).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true }); }

try {
  if (process.env.OFFLINE_ONLY !== '1') {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await desktop.newPage(); observe(page); await ready(page);
  assert.equal(await page.locator('.world-header h2').textContent(), 'İlk Adımlar');
  await fits(page, 'desktop workshop'); await screenshot(page, 'desktop-workshop.png');
  result.checks.push('desktop: real WebGL scene initialized');

  await page.getByRole('button', { name: 'Nasıl oynanır', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.locator('.help-steps > div').count(), 4);
  await page.getByRole('button', { name: 'Kapat', exact: true }).click();
  await page.locator('.sidebar-settings').click();
  await page.locator('.settings-label input').fill('QA-N');
  await page.getByRole('button', { name: 'Kapat', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.training-status small')?.textContent?.includes('kaydedildi'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('.robot-profile strong')?.textContent === 'QA-N');
  result.checks.push('settings name persists through IndexedDB reload');

  await page.locator('.sidebar .nav-item').filter({ hasText: 'Keşifler' }).click();
  assert.equal(await page.locator('.level-card').count(), 56);
  await page.locator('.level-card').filter({ hasText: 'İlk İz' }).click();
  assert.equal(await page.locator('.world-header h2').textContent(), 'İlk İz');
  await page.keyboard.press('ArrowRight');
  assert.match(await page.locator('.world-stats').textContent(), /1\s*HAMLE/);
  await page.locator('[data-action="3"]').click();
  assert.match(await page.locator('.world-stats').textContent(), /2\s*HAMLE/);
  await page.locator('[data-action="1"]').focus(); await page.keyboard.press('Enter');
  assert.match(await page.locator('.world-stats').textContent(), /3\s*HAMLE/);
  await page.locator('[data-action="3"]').focus(); await page.keyboard.press('Space');
  assert.match(await page.locator('.world-stats').textContent(), /4\s*HAMLE/);
  result.checks.push('56 curriculum rooms; direct keyboard, pointer and focused button Enter/Space controls advance engine');
  await page.getByRole('button', { name: 'Beyni büyüt', exact: true }).click();
  await page.locator('.brain-modal canvas').waitFor({ state: 'visible' });
  const sampleCount = await page.locator('.learning-count strong').textContent();
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.locator('.learning-count strong').textContent(), sampleCount, 'modal keyboard input cannot add hidden training samples');
  await screenshot(page, 'desktop-brain.png');
  await page.getByRole('button', { name: 'Kapat', exact: true }).click();
  result.checks.push('expanded neural visualization opens and closes');
  const countBeforeNeuronSelection = await page.locator('.learning-count strong').textContent();
  await page.locator('.brain-canvas--compact canvas').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('.learning-count strong').textContent(), countBeforeNeuronSelection, 'neuron selection must not control the robot or create training examples');
  await page.locator('.brain-canvas--compact canvas').evaluate(element => element.blur());
  result.checks.push('compact brain keyboard navigation selects neurons without moving the robot');
  await page.locator('.sidebar .nav-item').filter({ hasText: 'Keşifler' }).click();
  await page.locator('.level-card').filter({ hasText: 'Bir Dokunuş' }).click();
  for (const key of ['ArrowRight', 'ArrowDown', 'ArrowUp']) await page.keyboard.press(key);
  await screenshot(page, 'desktop-door-closed.png');
  await page.keyboard.press('e');
  await page.waitForTimeout(600);
  assert.match(await page.locator('.scene-host canvas').getAttribute('aria-label'), /1\/1 kapı açık/);
  await screenshot(page, 'desktop-door-open.png');
  await page.keyboard.press('e');
  await page.waitForTimeout(600);
  assert.match(await page.locator('.scene-host canvas').getAttribute('aria-label'), /0\/1 kapı açık/);
  result.checks.push('actual keyboard interaction activates the switch and opens/closes the rendered door');

  for (const label of ['Arena', 'Günlük']) {
    await page.locator('.sidebar .nav-item').filter({ hasText: label }).click();
    await fits(page, `desktop ${label}`);
  }

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const small = await mobile.newPage(); observe(small); await ready(small);
  await small.locator('[data-action="0"]').tap();
  await small.locator('[data-action="1"]').tap();
  assert.match(await small.locator('.world-stats').textContent(), /2\s*HAMLE/);
  await small.locator('.control-desk').scrollIntoViewIfNeeded();
  const downCovered = await small.locator('[data-action="2"]').evaluate(element => {
    const box = element.getBoundingClientRect();
    const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return top !== element && !element.contains(top);
  });
  assert.equal(downCovered, false, 'mobile down control must not be hidden by sticky training/navigation bars');
  await small.locator('[data-action="2"]').tap();
  await small.locator('[data-action="3"]').tap();
  assert.match(await small.locator('.world-stats').textContent(), /4\s*HAMLE/);
  result.checks.push('mobile: actual touch controls perform exactly one action per tap');
  await fits(small, 'mobile workshop'); await screenshot(small, 'mobile-workshop.png');
  await small.getByRole('button', { name: 'Nasıl oynanır', exact: true }).click();
  await fits(small, 'mobile help'); await screenshot(small, 'mobile-help.png');
  const dialog = await small.getByRole('dialog').boundingBox();
  assert.ok(dialog && dialog.x >= -1 && dialog.width <= 391, 'mobile dialog fits viewport');
  await small.getByRole('button', { name: 'Kapat', exact: true }).click();
  for (const label of ['Keşifler', 'Arena', 'Günlük']) {
    await small.locator('.mobile-nav button').filter({ hasText: label }).click();
    await fits(small, `mobile ${label}`);
    if (label === 'Keşifler') { assert.equal(await small.locator('.level-card').count(), 56); await screenshot(small, 'mobile-curriculum.png'); }
  }
  result.checks.push('390x844 mobile navigation, pages and modal validated');
  }

  if (process.env.OFFLINE_TEST === '1') {
    const offlineContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const offlinePage = await offlineContext.newPage(); observe(offlinePage); await ready(offlinePage);
    offlineProbe = offlinePage;
    await offlinePage.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20_000 });
    result.offlineCacheBefore = await offlinePage.evaluate(async () => {
      const cacheNames = await caches.keys();
      const cacheEntries = [];
      for (const name of cacheNames) {
        const cache = await caches.open(name);
        const requests = await cache.keys();
        cacheEntries.push({ name, entries: await Promise.all(requests.map(async request => {
          const response = await cache.match(request);
          return { url: request.url, requestOrigin: request.headers.get('Origin'), vary: response?.headers.get('Vary'), status: response?.status };
        })) });
      }
      const assets = [...document.querySelectorAll('script[src],link[rel="stylesheet"]')].map(element => element.src ?? element.href);
      const originVariantChecks = await Promise.all(assets.map(async url => {
        const request = new Request(url, { headers: { Origin: location.origin } });
        return { url, explicitOrigin: request.headers.get('Origin'), plainMatch: Boolean(await caches.match(url)), originSensitiveMatch: Boolean(await caches.match(request)), ignoreVaryMatch: Boolean(await caches.match(request, { ignoreVary: true })) };
      }));
      return { controller: navigator.serviceWorker.controller?.scriptURL, rootMatches: Boolean(await caches.match('/')), indexMatches: Boolean(await caches.match('/index.html')), assets, originVariantChecks, cacheEntries };
    });
    await writeFile(new URL('offline-before.html', artifacts), await offlinePage.content());
    await offlineContext.setOffline(true);
    await offlinePage.reload({ waitUntil: 'domcontentloaded' });
    await offlinePage.locator('.scene-host canvas').waitFor({ state: 'visible', timeout: 20_000 });
    await offlinePage.waitForFunction(() => document.querySelector('.training-status small')?.textContent?.includes('kaydedildi'));
    await offlinePage.waitForFunction(() => {
      const direction = document.querySelector('[data-action="0"]');
      return direction && !direction.disabled;
    });
    await offlinePage.keyboard.press('ArrowUp');
    await offlinePage.keyboard.press('ArrowRight');
    assert.match(await offlinePage.locator('.world-stats').textContent(), /2\s*HAMLE/);
    await offlinePage.getByRole('button', { name: /^Robotuna öğret/ }).click();
    await offlinePage.waitForFunction(() => document.querySelector('.version-tag')?.textContent === 'v1', null, { timeout: 40_000 });
    await screenshot(offlinePage, 'offline-workshop.png');
    result.checks.push('production: full reload, manual play and actual worker training with network offline');
    await offlineContext.close();
  }
  assert.deepEqual(result.errors, [], 'no uncaught browser exceptions');
  result.passed = true;
} catch (error) {
  result.passed = false; result.failure = error.stack ?? String(error); process.exitCode = 1;
  if (offlineProbe) {
    result.offlinePage = { title: await offlineProbe.title().catch(() => ''), url: offlineProbe.url() };
    await writeFile(new URL('offline-failure.html', artifacts), await offlineProbe.content().catch(() => ''));
  }
  const pages = browser.contexts().flatMap(context => context.pages());
  for (let index = 0; index < pages.length; index++) {
    try { await pages[index].screenshot({ path: new URL(`smoke-failure-${index}.png`, artifacts).pathname.replace(/^\/(\w:)/, '$1'), timeout: 5000 }); } catch { /* Preserve the original failure. */ }
  }
} finally {
  result.finishedAt = new Date().toISOString();
  await writeFile(new URL('smoke.json', artifacts), JSON.stringify(result, null, 2));
  if (process.env.OFFLINE_TEST === '1') await writeFile(new URL('smoke-offline.json', artifacts), JSON.stringify(result, null, 2));
  await browser.close();
  console.log(JSON.stringify(result, null, 2));
}
