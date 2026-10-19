import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:5174';
const artifacts = new URL('../artifacts/duel/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], cases: [], errors: [], consoleErrors: [] };
let stage = 'launch';
const progress = setInterval(() => console.log(JSON.stringify({ stage })), 10_000);
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function runCase(rejectedAPI) {
  const label = rejectedAPI ? 'rejected Fullscreen API fallback' : 'native browser fullscreen';
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  if (rejectedAPI) await context.addInitScript(() => {
    window.__fullscreenRequests = 0;
    Element.prototype.requestFullscreen = function () {
      window.__fullscreenRequests++;
      return Promise.reject(new DOMException('Fullscreen is unavailable in this WebView.', 'NotSupportedError'));
    };
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push({ stage, message: error.message }));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ stage, message: message.text() }); });
  const state = () => page.evaluate(() => window.__DUEL__.state());
  const advance = seconds => page.evaluate(seconds => { window.__DUEL__.advance(seconds); return window.__DUEL__.state(); }, seconds);
  const full = page.locator('.arena-fullscreen');
  const result = { label, automaticStarts: 0, exits: [] };
  try {
    stage = `${label}: ready`;
    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="duel-app"][data-learning-ready="true"]').waitFor();
    await page.getByTestId('duel-canvas').locator('canvas').waitFor({ state: 'visible' });
    await page.waitForFunction(() => typeof window.__DUEL__?.advance === 'function');
    await page.evaluate(() => { window.__DUEL__.pausePresentation(true); window.__DUEL__.pauseSimulation(true); });
    assert.equal(await full.count(), 0, 'the idle workshop initially uses the normal mobile app layout');

    async function startNew() {
      await page.getByTestId('start-match').tap();
      await full.waitFor({ state: 'visible' });
      await page.waitForFunction(() => document.body.classList.contains('playable-fullscreen-open'));
      if (!rejectedAPI) await page.waitForFunction(() => Boolean(document.fullscreenElement));
      assert.equal(Boolean(await page.evaluate(() => document.fullscreenElement)), !rejectedAPI, `${label}: correct fullscreen mechanism is active`);
      assert.equal((await state()).phase, 'running', `${label}: the real match starts automatically`);
      assert.equal(await page.getByTestId('training-toggle').isVisible(), true, 'compact training access remains on the duel screen');
      assert.equal(await page.getByTestId('training-toggle').getAttribute('aria-expanded'), 'false', 'a new duel tucks away the training panel');
      assert.equal(await page.locator('#training-epochs').isVisible(), false, 'pass selector does not cover the active duel');
      result.automaticStarts++;
    }

    async function waitNormal(exitName) {
      await full.waitFor({ state: 'detached' });
      await page.waitForFunction(() => !document.fullscreenElement && !document.body.classList.contains('playable-fullscreen-open'));
      assert.equal((await state()).phase, 'running', `${exitName}: exiting fullscreen keeps the match running`);
      const before = await state(), after = await advance(.25);
      assert.ok(after.time > before.time + .24, `${exitName}: the match continues after exit`);
      assert.equal(await full.count(), 0, `${exitName}: continued play respects the normal-view choice`);
      result.exits.push(exitName);
    }

    stage = `${label}: automatic start and button exit`;
    await startNew();
    const beforeRotation = await state();
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(150);
    const canvas = await full.getByTestId('duel-canvas').locator('canvas').boundingBox();
    assert.ok(canvas && Math.abs(canvas.width - 844) < 2 && Math.abs(canvas.height - 390) < 2, 'rotating the automatic fullscreen duel fills the landscape viewport');
    assert.deepEqual(await state(), beforeRotation, 'rotation preserves the match');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
    await page.getByRole('button', { name: 'Tam ekrandan çık', exact: true }).tap();
    await waitNormal('exit button');
    report.checks.push(`${label}: a new duel enters fullscreen automatically, rotates without resetting, and exits without stopping the match`);

    stage = `${label}: pause and resume respect exit`;
    await page.getByTestId('pause-match').tap();
    assert.equal((await state()).phase, 'paused');
    assert.equal(await full.count(), 0, 'pause keeps the chosen normal view');
    await page.getByTestId('pause-match').tap();
    assert.equal((await state()).phase, 'running');
    assert.equal(await full.count(), 0, 'resume keeps the chosen normal view');
    await advance(.25);
    assert.equal(await full.count(), 0, 'normal-view choice persists after resumed simulation');
    report.checks.push(`${label}: pause, resume and continued simulation respect an explicit fullscreen exit`);

    stage = `${label}: Escape exit`;
    await page.getByTestId('reset-match').tap();
    assert.equal((await state()).phase, 'ready');
    await startNew();
    await page.keyboard.press('Escape');
    await waitNormal('Escape');
    report.checks.push(`${label}: a fresh start opens fullscreen again and Escape returns to the running app`);

    stage = `${label}: browser back exit`;
    await page.getByTestId('reset-match').tap();
    await startNew();
    await page.evaluate(() => history.back());
    await waitNormal('browser back');
    assert.equal(await page.getByTestId('duel-app').isVisible(), true, 'Back keeps the duel application on the page');
    report.checks.push(`${label}: Back closes fullscreen while keeping the current duel running`);
    if (rejectedAPI) assert.equal(await page.evaluate(() => window.__fullscreenRequests), 3, 'every fresh start attempted the browser API and retained the CSS fallback on rejection');
    report.cases.push(result);
  } finally {
    await context.close();
  }
}

try {
  await runCase(false);
  await runCase(true);
  assert.equal(report.errors.length, 0, 'no browser runtime errors');
  assert.equal(report.consoleErrors.length, 0, 'no browser console errors');
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = { stage, message: error.message, stack: error.stack };
  console.error(error);
  process.exitCode = 1;
} finally {
  clearInterval(progress);
  report.finishedAt = new Date().toISOString();
  await writeFile(new URL('auto-fullscreen.json', artifacts), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}
