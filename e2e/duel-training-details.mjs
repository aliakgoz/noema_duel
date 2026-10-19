import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:5174';
const artifacts = new URL('../artifacts/duel/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], measurements: [], screenshots: [], errors: [], consoleErrors: [] };
let stage = 'launch';
const progress = setInterval(() => console.log(JSON.stringify({ stage })), 10_000);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
// Observe the real Worker messages without changing their payload, timing,
// training algorithm, demonstrations, model, or delivery to the application.
await context.addInitScript(() => {
  window.__TRAINING_DETAILS_QA__ = [];
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(url, options) {
      super(url, options);
      if (!String(url).includes('learning.worker')) return;
      const run = { url: String(url), progress: [] };
      window.__TRAINING_DETAILS_QA__.push(run);
      this.addEventListener('message', event => {
        if (event.data.type === 'progress') run.progress.push(event.data.progress);
        if (event.data.type === 'complete') run.complete = { loss: event.data.loss, epochs: event.data.epochs, trainedSteps: event.data.model.trainedSteps };
        if (event.data.type === 'error') run.error = event.data.message;
      });
    }
  };
});
const page = await context.newPage();
page.on('pageerror', error => report.errors.push({ stage, message: error.message }));
page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ stage, message: message.text() }); });
const toggle = page.getByTestId('training-toggle');
const panel = page.locator('.arena-training-bar');
const details = page.getByTestId('training-details');
const epochs = page.locator('#training-epochs');
const train = page.getByTestId('train-robot');
const cancel = page.getByTestId('cancel-training');
const state = () => page.evaluate(() => window.__DUEL__.state());
const advance = seconds => page.evaluate(seconds => { window.__DUEL__.advance(seconds); return window.__DUEL__.state(); }, seconds);
const workerRuns = () => page.evaluate(() => structuredClone(window.__TRAINING_DETAILS_QA__));
const check = name => { report.checks.push(name); console.log(JSON.stringify({ check: name })); };

async function savedLearning() {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('noema-local-v1', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction('records').objectStore('records').get('noema-duel-gru96-v1');
      read.onsuccess = () => { db.close(); resolve(read.result); };
      read.onerror = () => { db.close(); reject(read.error); };
    };
  }));
}

async function openPanel() {
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.tap();
  await panel.waitFor({ state: 'visible' });
}

async function closePanel() {
  if (await toggle.getAttribute('aria-expanded') === 'true') await page.getByTestId('training-close').tap();
  await panel.waitFor({ state: 'hidden' });
}

async function waitCompleted(previousSteps, additional) {
  await page.waitForFunction(({ previousSteps, additional }) => new Promise(resolve => {
    const request = indexedDB.open('noema-local-v1', 1);
    request.onerror = () => resolve(false);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction('records').objectStore('records').get('noema-duel-gru96-v1');
      read.onsuccess = () => { db.close(); resolve(read.result?.model?.trainedSteps === previousSteps + additional); };
      read.onerror = () => { db.close(); resolve(false); };
    };
  }), { previousSteps, additional }, { timeout: 90_000 });
  await train.waitFor({ state: 'visible' });
  return savedLearning();
}

async function chartPoints() {
  return JSON.parse(await page.getByTestId('training-loss-chart').getAttribute('data-points'));
}

async function compareWorker(runIndex, saved) {
  const run = (await workerRuns())[runIndex];
  assert.ok(run?.url.includes('learning.worker'), 'actual GRU Worker ran');
  assert.ok(run.progress.length > 0, 'actual epoch messages arrived');
  const displayed = await chartPoints();
  assert.deepEqual(displayed, run.progress.map(({ epoch, loss }) => ({ epoch, loss })), 'the chart uses every actual epoch and unrounded loss');
  assert.equal(Number(await page.getByTestId('training-loss').getAttribute('data-loss')), run.progress.at(-1).loss, 'current loss is the exact actual latest epoch loss');
  assert.notEqual(await page.getByTestId('training-loss').textContent(), '\u2014', 'a measured loss replaces the waiting placeholder');
  if (saved) {
    assert.equal(saved.loss, run.complete.loss);
    assert.equal(saved.loss, run.progress.at(-1).loss);
    assert.equal(saved.model.trainedSteps, run.complete.trainedSteps);
  }
  return run;
}

async function screenshot(name) {
  if (process.env.NO_SCREENSHOTS === '1') return;
  await page.evaluate(() => window.__DUEL__.pausePresentation(false));
  await page.waitForTimeout(120);
  await page.screenshot({ path: fileURLToPath(new URL(name, artifacts)), fullPage: false });
  await page.evaluate(() => window.__DUEL__.pausePresentation(true));
  report.screenshots.push(name);
}

async function touchable(locator, label, scroll = false) {
  if (scroll) await locator.scrollIntoViewIfNeeded();
  assert.equal(await locator.isVisible(), true, `${label}: visible`);
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `${label}: fits viewport ${JSON.stringify(box)}`);
  const hit = await locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return { reachable: element.contains(top), top: top?.outerHTML.slice(0, 400), actual: element.outerHTML.slice(0, 300) };
  });
  assert.equal(hit.reachable, true, `${label}: can receive a touch ${JSON.stringify(hit)}`);
  return box;
}

async function mobileFits(width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(180);
  await openPanel();
  await page.locator('.arena-training-popover').evaluate(element => { element.scrollTop = 0; });
  const outer = await page.locator('.arena-training-popover').boundingBox();
  assert.ok(outer && outer.x >= -1 && outer.y >= -1 && outer.x + outer.width <= width + 1 && outer.y + outer.height <= height + 1, `${width}x${height}: details panel fits viewport`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'no horizontal page overflow');
  const boxes = {};
  boxes.close = await touchable(page.getByTestId('training-close'), `${width}x${height}: close`);
  boxes.loss = await touchable(page.getByTestId('training-loss'), `${width}x${height}: actual loss`, true);
  boxes.train = await touchable(train, `${width}x${height}: repeat training`, true);
  boxes.epochs = await touchable(epochs, `${width}x${height}: pass selector`, true);
  await page.getByTestId('training-loss-chart').scrollIntoViewIfNeeded();
  assert.equal(await page.getByTestId('training-loss-chart').isVisible(), true, 'actual epoch graph can be reached');
  await page.getByTestId('training-close').scrollIntoViewIfNeeded();
  boxes.closeAfterScroll = await touchable(page.getByTestId('training-close'), `${width}x${height}: close after scrolling`);
  await page.getByTestId('training-loss').scrollIntoViewIfNeeded();
  report.measurements.push({ width, height, outer, boxes });
  check(`${width}x${height}: loss, graph, training controls and close button stay reachable without horizontal overflow`);
}

try {
  stage = 'ready';
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="duel-app"][data-learning-ready="true"]').waitFor();
  await page.waitForFunction(() => typeof window.__DUEL__?.advance === 'function');
  await page.evaluate(() => { window.__DUEL__.pauseSimulation(true); window.__DUEL__.pausePresentation(true); });
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  await openPanel();
  assert.equal(await epochs.inputValue(), '1');
  assert.equal(await train.isEnabled(), false);
  await closePanel();
  check('Fresh arena keeps training tucked away, defaults to one pass and requires real demonstrations');

  stage = 'real demonstrations';
  await page.getByTestId('start-match').tap();
  await page.locator('.arena-fullscreen').waitFor({ state: 'visible' });
  await page.waitForTimeout(300);
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await page.keyboard.down('d'); await page.keyboard.down('Space'); await advance(2.4); await page.keyboard.up('d');
  await page.keyboard.down('w'); await advance(2.4); await page.keyboard.up('w');
  await page.keyboard.down('a'); const demonstrated = await advance(2.4); await page.keyboard.up('a'); await page.keyboard.up('Space');
  assert.equal(demonstrated.phase, 'running');
  assert.ok(demonstrated.robots[0].shots > 0);
  await openPanel();
  const samples = parseInt(await page.getByTestId('arena-sample-count').textContent(), 10);
  assert.ok(samples >= 60, 'real human keys recorded at least 60 demonstration frames');
  check('Actual movement and firing generate the training examples; no synthetic dataset or model is injected');

  stage = 'default single pass';
  const beforeFirst = await state();
  await train.tap();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true', 'training details stay open when training starts');
  const first = await waitCompleted(0, samples);
  assert.equal(await panel.isVisible(), true);
  const firstRun = await compareWorker(0, first);
  assert.equal(firstRun.complete.epochs, 1);
  assert.equal(firstRun.progress.length, 1);
  assert.match(await page.getByTestId('training-status').textContent(), /tamam/i);
  const firstWorld = await state();
  assert.equal(firstWorld.phase, 'paused');
  assert.equal(firstWorld.time, beforeFirst.time);
  assert.deepEqual(firstWorld.robots.map(robot => robot.hp), beforeFirst.robots.map(robot => robot.hp));
  assert.ok(first.samples.some(sample => sample.output[0] > .9 && sample.output[4] === 1));
  assert.ok(first.samples.some(sample => sample.output[1] < -.9));
  await closePanel(); await openPanel();
  assert.equal(Number(await page.getByTestId('training-loss').getAttribute('data-loss')), first.loss, 'completed loss survives closing the panel');
  check('One real default GRU pass retains the open detail view, reports actual loss and pauses the match without changing time or health');

  stage = 'real multi-pass history';
  await epochs.fill('8');
  await train.tap();
  const multi = await waitCompleted(first.model.trainedSteps, samples * 8);
  const multiRun = await compareWorker(1, multi);
  assert.equal(multiRun.progress.length, 8);
  assert.deepEqual(multi.samples, first.samples);
  assert.notDeepEqual(multi.model.weights, first.model.weights);
  assert.match(await page.getByTestId('training-epochs-progress').textContent(), /8\s*\/\s*8/);
  assert.deepEqual((await state()), firstWorld, 'repeated learning leaves the paused game unchanged');
  report.learning = { samples, firstSteps: first.model.trainedSteps, firstLoss: first.loss, multiSteps: multi.model.trainedSteps, multiLoss: multi.loss, history: await chartPoints() };
  check('Eight selected passes show every real epoch loss and continue the existing GRU while preserving demonstrations');

  stage = 'responsive completed details';
  for (const [width, height] of [[390, 844], [844, 390], [604, 268], [320, 568]]) {
    await mobileFits(width, height);
    await screenshot(`training-details-${width}x${height}.png`);
  }

  stage = 'live cancellation and pause';
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(180);
  await epochs.fill('500');
  await train.tap();
  await cancel.waitFor({ state: 'visible' });
  await page.waitForFunction(() => window.__TRAINING_DETAILS_QA__[2]?.progress.length >= 2);
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await epochs.isEnabled(), false);
  assert.equal(await page.getByTestId('pause-match').isEnabled(), false);
  assert.equal(await page.getByTestId('reset-match').isEnabled(), false);
  assert.equal(await page.getByTestId('watch-robot').isEnabled(), false);
  assert.equal(await page.locator('.pause-overlay > button').isEnabled(), false);
  assert.match(await page.getByTestId('training-status').textContent(), /eğit|öğren|sürüyor/i);
  const liveSnapshot = await page.evaluate(() => ({ points: JSON.parse(document.querySelector('[data-testid="training-loss-chart"]').getAttribute('data-points')), loss: Number(document.querySelector('[data-testid="training-loss"]').getAttribute('data-loss')) }));
  const livePoints = liveSnapshot.points;
  assert.ok(livePoints.length >= 1 && livePoints.length < 500);
  assert.ok(livePoints.every(point => Number.isFinite(point.loss) && point.loss > 0));
  assert.equal(liveSnapshot.loss, livePoints.at(-1).loss);
  await screenshot('training-details-live-landscape.png');
  await closePanel();
  assert.equal((await state()).phase, 'paused', 'closing training cannot resume the match');
  const closedWorld = await state();
  const manuallyAdvanced = await advance(1.5);
  assert.deepEqual(manuallyAdvanced, closedWorld, 'engine ignores advancement while training is paused');
  await openPanel();
  await cancel.waitFor({ state: 'visible' });
  assert.ok((await chartPoints()).length >= livePoints.length, 'reopening preserves progress');
  await cancel.tap();
  await train.waitFor({ state: 'visible' });
  assert.equal(await panel.isVisible(), true);
  assert.match(await page.getByTestId('training-status').textContent(), /durdur|iptal/i);
  const cancelled = await savedLearning();
  assert.deepEqual(cancelled.model, multi.model, 'cancellation retains the last fully saved model');
  assert.deepEqual(cancelled.samples, multi.samples);
  assert.equal(cancelled.loss, multi.loss, 'partial training does not overwrite the saved model loss');
  assert.equal(Number(await page.getByTestId('training-saved-loss').getAttribute('data-loss')), multi.loss, 'the retained model loss card identifies the actual previous saved model');
  const cancelRun = await compareWorker(2);
  assert.equal(cancelRun.complete, undefined);
  assert.ok(cancelRun.progress.length >= 2 && cancelRun.progress.length < 500);
  assert.deepEqual(await state(), firstWorld);
  report.cancelled = { epochsCompleted: cancelRun.progress.length, lastLoss: cancelRun.progress.at(-1).loss, savedLoss: cancelled.loss };
  report.workerRuns = await workerRuns();
  check('Live progress can be closed and reopened without resuming play; cancelling retains real partial history and the previously saved model');
  await screenshot('training-details-cancelled-landscape.png');
  await page.getByTestId('training-saved-loss').scrollIntoViewIfNeeded();
  await screenshot('training-details-retained-model-landscape.png');

  stage = 'reload saved loss';
  await closePanel();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="duel-app"][data-learning-ready="true"]').waitFor();
  await page.evaluate(() => { window.__DUEL__.pauseSimulation(true); window.__DUEL__.pausePresentation(true); });
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  await openPanel();
  assert.equal(await epochs.inputValue(), '1');
  const reloaded = await savedLearning();
  assert.equal(reloaded.loss, multi.loss);
  assert.equal(reloaded.model.trainedSteps, multi.model.trainedSteps);
  assert.equal(Number(await page.getByTestId('training-loss').getAttribute('data-loss')), multi.loss, 'saved model loss remains available after a full reload');
  check('The last saved model loss remains available after a full IndexedDB reload and the next training still defaults to one pass');
  assert.equal(report.errors.length, 0, 'no browser runtime errors');
  assert.equal(report.consoleErrors.length, 0, 'no browser console errors');
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = { stage, message: error.message, stack: error.stack };
  console.error(error);
  await page.screenshot({ path: fileURLToPath(new URL('training-details-failure.png', artifacts)), fullPage: false }).catch(() => {});
  process.exitCode = 1;
} finally {
  clearInterval(progress);
  report.finishedAt = new Date().toISOString();
  await writeFile(new URL('training-details.json', artifacts), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}
