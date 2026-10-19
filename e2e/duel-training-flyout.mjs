import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:5174';
const artifacts = new URL('../artifacts/duel/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], measurements: [], workers: [], screenshots: [], errors: [], consoleErrors: [] };
let stage = 'launch';
const progress = setInterval(() => console.log(JSON.stringify({ stage })), 10_000);
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('worker', worker => report.workers.push(worker.url()));
page.on('pageerror', error => report.errors.push({ stage, message: error.message }));
page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ stage, message: message.text() }); });
const toggle = page.getByTestId('training-toggle');
const bar = page.locator('.arena-training-bar');
const epochs = page.locator('#training-epochs');
const train = page.getByTestId('train-robot');
const drawer = page.locator('.training-drawer');
const state = () => page.evaluate(() => window.__DUEL__.state());
const advance = seconds => page.evaluate(seconds => { window.__DUEL__.advance(seconds); return window.__DUEL__.state(); }, seconds);
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
  await bar.waitFor({ state: 'visible' });
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
}

async function closePanel() {
  if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.tap();
  await bar.waitFor({ state: 'hidden' });
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
}

async function assertClosed() {
  assert.equal(await bar.isVisible(), false, 'training panel takes no visible space while closed');
  assert.equal(await epochs.isVisible(), false, 'pass selector stays out of the duel while closed');
  assert.equal(await train.isVisible(), false, 'full training button stays out of the duel while closed');
  assert.equal(await bar.boundingBox(), null, 'closed training panel has no layout rectangle');
  assert.equal(await toggle.isVisible(), true, 'compact training access stays available');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('#training-epochs').count(), 1, 'only one pass selector exists');
  assert.equal(await drawer.evaluate(element => element.open), false, 'the main settings drawer stays closed');
}

async function completedTraining(previousSteps, expectedAdditional) {
  await page.waitForFunction(({ previousSteps, expectedAdditional }) => new Promise(resolve => {
    const request = indexedDB.open('noema-local-v1', 1);
    request.onerror = () => resolve(false);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction('records').objectStore('records').get('noema-duel-gru96-v1');
      read.onsuccess = () => { db.close(); resolve(read.result?.model?.trainedSteps === previousSteps + expectedAdditional); };
      read.onerror = () => { db.close(); resolve(false); };
    };
  }), { previousSteps, expectedAdditional }, { timeout: 45_000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid="watch-robot"]')?.disabled);
  const saved = await savedLearning();
  assert.equal(saved.model.trainedSteps, previousSteps + expectedAdditional, 'the real saved GRU trains exactly the selected number of passes');
  assert.ok(Number.isFinite(saved.loss), 'real BPTT reports a finite loss');
  return saved;
}

async function fits(label, fullscreen = true, expanded = false) {
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth + 1 }));
  assert.equal(viewport.overflow, false, `${label}: no horizontal overflow`);
  const panel = page.locator(fullscreen ? '.arena-fullscreen' : '.arena-panel');
  const canvas = await panel.getByTestId('duel-canvas').locator('canvas').boundingBox();
  assert.ok(canvas && canvas.width >= 200 && canvas.height >= 140, `${label}: arena remains usable`);
  const controls = [['training access', toggle], ['model view', panel.getByRole('button', { name: 'GRU modelini incele', exact: true })], ['camera', panel.getByTestId('camera-toggle')], ['weather', panel.getByTestId('weather-toggle')]];
  if (!expanded) {
    controls.push(['play', panel.getByTestId('pause-match').or(panel.getByTestId('start-match'))], ['reset', panel.getByTestId('reset-match')], ['robot playback', panel.getByTestId('watch-robot')]);
    if (await panel.getByTestId('movement-zone').isVisible()) {
      controls.push(['cover', panel.getByRole('button', { name: 'Al / bırak', exact: true })]);
      const movementZone = panel.getByTestId('movement-zone');
      const movement = await movementZone.boundingBox();
      assert.ok(movement && Math.abs(movement.x - canvas.x) < 2 && Math.abs(movement.y - canvas.y) < 2 && Math.abs(movement.width - canvas.width / 2) < 2 && Math.abs(movement.height - canvas.height) < 2, `${label}: movement area covers the left half of the arena`);
      assert.equal(await movementZone.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      }), true, `${label}: left movement area receives touches`);
      assert.equal(await panel.getByTestId('movement-joystick').isVisible(), false, `${label}: inactive floating ring leaves the arena clear`);
    }
    if (fullscreen) controls.push(['exit', panel.getByRole('button', { name: 'Tam ekrandan çık', exact: true })]);
    for (const [name, control] of [['speed', panel.locator('.simulation-controls select')], ['sound', panel.locator('.simulation-controls button')], ['overlay resume', panel.locator('.pause-overlay > button')], ['overlay rematch', panel.locator('.winner-overlay > button')]]) if (await control.isVisible()) controls.push([name, control]);
  } else {
    controls.push(['passes', epochs], ['minus', bar.getByRole('button', { name: 'Tur sayısını azalt', exact: true })], ['plus', bar.getByRole('button', { name: 'Tur sayısını artır', exact: true })]);
    if (await train.isVisible()) controls.push(['train', train]);
    const stop = bar.getByRole('button', { name: 'Eğitimi durdur', exact: true });
    if (await stop.isVisible()) controls.push(['stop training', stop]);
  }
  const boxes = {};
  for (const [name, control] of controls) {
    assert.equal(await control.isVisible(), true, `${label}: ${name} visible`);
    const box = await control.boundingBox();
    assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `${label}: ${name} fits ${JSON.stringify(box)}`);
    assert.equal(await control.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    }), true, `${label}: ${name} receives touches`);
    boxes[name] = box;
  }
  for (const [firstIndex, [firstName, first]] of Object.entries(boxes).entries()) for (const [secondName, second] of Object.entries(boxes).slice(firstIndex + 1)) {
    const overlapWidth = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
    const overlapHeight = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
    assert.ok(overlapWidth <= .5 || overlapHeight <= .5, `${label}: ${firstName} overlaps ${secondName} (${overlapWidth.toFixed(2)} × ${overlapHeight.toFixed(2)} px)`);
  }
  const trainingButton = boxes['training access'];
  assert.ok(trainingButton.x + trainingButton.width / 2 > viewport.width * .55, `${label}: training access sits to the right of the arena`);
  if (expanded) {
    const popover = await page.locator('.arena-training-popover').boundingBox();
    assert.ok(popover && popover.x >= -1 && popover.y >= -1 && popover.x + popover.width <= viewport.width + 1 && popover.y + popover.height <= viewport.height + 1, `${label}: flyout fits entirely in viewport`);
    assert.ok(popover.width <= 380 && popover.height <= viewport.height, `${label}: scrollable training details fit the viewport`);
  }
  report.measurements.push({ label, viewport, canvas, controls: boxes, expanded });
  check(`${label}: compact right-hand training access and visible controls fit without overlap`);
}

async function screenshot(name) {
  if (process.env.NO_SCREENSHOTS === '1') return;
  await page.evaluate(() => window.__DUEL__.pausePresentation(false));
  await page.waitForTimeout(120);
  await page.screenshot({ path: fileURLToPath(new URL(name, artifacts)), fullPage: false });
  await page.evaluate(() => window.__DUEL__.pausePresentation(true));
  report.screenshots.push(name);
}

async function assertFullscreen() {
  await page.locator('.arena-fullscreen').waitFor({ state: 'visible' });
  // Browser fullscreen resolves asynchronously and the resize handler correctly
  // cancels pending fire. Tap after that layout change has settled.
  await page.waitForTimeout(300);
}
async function exitFullscreen() {
  await page.getByRole('button', { name: 'Tam ekrandan çık', exact: true }).tap();
  await page.locator('.arena-fullscreen').waitFor({ state: 'detached' });
}

try {
  stage = 'ready';
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="duel-app"][data-learning-ready="true"]').waitFor();
  await page.getByTestId('duel-canvas').locator('canvas').waitFor({ state: 'visible' });
  await page.waitForFunction(() => typeof window.__DUEL__?.advance === 'function');
  await page.evaluate(() => { window.__DUEL__.pauseSimulation(true); window.__DUEL__.pausePresentation(true); });
  await assertClosed();
  await fits('normal portrait 390 × 844', false);
  await screenshot('training-flyout-normal-closed.png');
  check('Fresh duel displays only the compact training button; full training controls occupy no arena space');

  stage = 'open and bounds';
  const untouched = await state();
  await openPanel();
  assert.equal(await epochs.inputValue(), '1', 'training still defaults to exactly one pass');
  assert.equal(await train.isEnabled(), false, 'empty demonstrations cannot train');
  assert.equal(await page.getByTestId('watch-robot').isEnabled(), false, 'untrained robot cannot play');
  const minus = bar.getByRole('button', { name: 'Tur sayısını azalt', exact: true });
  const plus = bar.getByRole('button', { name: 'Tur sayısını artır', exact: true });
  assert.equal(await minus.isEnabled(), false);
  await plus.tap(); assert.equal(await epochs.inputValue(), '2');
  await minus.tap(); assert.equal(await epochs.inputValue(), '1');
  await epochs.fill('600'); assert.equal(await epochs.inputValue(), '500'); assert.equal(await plus.isEnabled(), false);
  await epochs.fill('0'); assert.equal(await epochs.inputValue(), '1');
  await page.getByTestId('training-close').tap();
  await assertClosed();
  await openPanel();
  await closePanel();
  assert.deepEqual(await state(), untouched, 'opening and closing training preserves the entire current duel');
  check('One compact button exposes the only training action and pass selector with unchanged 1–500 limits');

  stage = 'fullscreen and firing';
  await openPanel();
  await page.getByTestId('start-match').tap();
  await assertFullscreen();
  await assertClosed();
  assert.equal((await state()).phase, 'running');
  const canvas = page.getByTestId('duel-canvas').locator('canvas');
  const rect = await canvas.boundingBox();
  await advance(.65); // The engine intentionally starts with a 0.6 s reload.
  const beforeShot = await state();
  await canvas.tap({ position: { x: rect.width * .52, y: rect.height * .56 } });
  const fired = await advance(.02);
  assert.equal(fired.robots[0].shots, beforeShot.robots[0].shots + 1, 'closed training UI leaves actual arena tap-to-fire working');
  check('Starting a duel closes the flyout, enters fullscreen and leaves the playing field touchable');

  stage = 'close interactions';
  const beforeOpenWhileRunning = await state();
  await openPanel();
  assert.deepEqual(await state(), beforeOpenWhileRunning, 'opening the flyout does not pause or change a running duel');
  const beforeOutside = await state();
  await page.mouse.click(rect.x + rect.width * .25, rect.y + rect.height * .5);
  await assertClosed();
  assert.equal((await state()).robots[0].shots, beforeOutside.robots[0].shots, 'dismissing the panel does not fire');
  assert.equal(await page.evaluate(() => window.__DUEL__.input().fire), false, 'dismissal does not queue an accidental shot');
  await openPanel();
  await page.keyboard.press('Escape');
  await assertClosed();
  await assertFullscreen();
  check('Outside touch and Escape close training; dismissal does not fire or leave fullscreen');

  stage = 'real demonstrations';
  await exitFullscreen();
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await page.keyboard.down('d'); await page.keyboard.down('Space');
  const demonstrated = await advance(1.9);
  await page.keyboard.up('Space'); await page.keyboard.up('d');
  await page.getByTestId('pause-match').tap();
  assert.ok(demonstrated.robots[0].shots > 0);
  await drawer.locator('summary').tap();
  const samples = parseInt(await page.getByTestId('sample-count').textContent(), 10);
  assert.ok(samples >= 16, 'real movement and firing provide at least 16 demonstrations');
  await page.getByRole('button', { name: 'Kayıt açık', exact: true }).tap();
  await drawer.locator('summary').tap();
  await page.getByRole('button', { name: 'Tam ekran', exact: true }).tap();
  await assertFullscreen();
  check('Real keyboard movement and firing record sufficient demonstrations without using an injected dataset');

  stage = 'mobile layouts';
  for (const [width, height] of [[390, 844], [844, 390], [604, 268], [568, 320]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(150);
    await closePanel();
    await fits(`fullscreen ${width} × ${height} closed`);
    if (width === 844) await screenshot('training-flyout-landscape-closed.png');
    await openPanel();
    await fits(`fullscreen ${width} × ${height} open`, true, true);
    if (width === 844) await screenshot('training-flyout-landscape-open.png');
    await closePanel();
  }

  stage = 'one real training pass';
  await openPanel();
  const beforeTraining = await state();
  await train.tap();
  const first = await completedTraining(0, samples);
  assert.ok(report.workers.some(url => url.includes('learning.worker')), 'training uses the dedicated GRU Worker');
  assert.ok(first.samples.filter(sample => sample.output[0] > .9 && sample.output[4] === 1).length >= 16, 'saved demonstrations contain human rightward movement and firing');
  assert.equal((await state()).time, beforeTraining.time, 'training preserves match time');
  assert.deepEqual((await state()).robots.map(robot => robot.hp), beforeTraining.robots.map(robot => robot.hp), 'training preserves health');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true', 'completed training keeps its details open');
  assert.equal(await page.getByTestId('training-details').getAttribute('data-status'), 'complete');
  await closePanel();
  await assertClosed();
  check('Flyout trains exactly one actual GRU pass, keeps the result open and retains the match and examples');

  stage = 'repeated training';
  await openPanel();
  await train.tap();
  const second = await completedTraining(first.model.trainedSteps, samples);
  assert.deepEqual(second.samples, first.samples);
  assert.notDeepEqual(second.model.weights, first.model.weights, 'training continues actual learned weights');
  report.learning = { samples, firstSteps: first.model.trainedSteps, repeatedSteps: second.model.trainedSteps, loss: second.loss };
  check('Reopening training continues the same saved model from the preserved demonstrations');

  stage = 'busy cancellation';
  await openPanel();
  await epochs.fill('500');
  await train.tap();
  await openPanel();
  const stop = bar.getByRole('button', { name: 'Eğitimi durdur', exact: true });
  await stop.waitFor({ state: 'visible' });
  assert.equal(await epochs.isEnabled(), false);
  assert.equal(await plus.isEnabled(), false);
  assert.equal(await minus.isEnabled(), false);
  assert.equal(await page.getByTestId('watch-robot').isEnabled(), false);
  assert.equal(await page.getByTestId('training-progress').isVisible(), true);
  await closePanel();
  assert.equal(await toggle.isVisible(), true, 'busy work remains accessible through the small right-hand button');
  await openPanel();
  await stop.tap();
  await train.waitFor({ state: 'visible' });
  assert.deepEqual((await savedLearning()).model, second.model, 'cancel keeps the previous real model');
  assert.match(await bar.textContent(), /Önceki modelin ve örneklerin korundu/);
  await epochs.fill('1');
  check('Long training can be tucked away and reopened to cancel; previous model survives cancellation');

  stage = 'learned playback';
  await exitFullscreen();
  await page.getByTestId('watch-robot').tap();
  await assertFullscreen();
  await assertClosed();
  assert.equal(await page.getByTestId('watch-robot').getAttribute('aria-pressed'), 'true');
  const playback = await advance(1.5);
  assert.equal(playback.phase, 'running');
  assert.match(playback.robots[0].decision.reason, /sinir ağının çıktıları/);
  assert.equal(parseInt(await page.getByTestId('arena-sample-count').textContent(), 10), samples, 'playback cannot generate teacher examples');
  await page.getByRole('button', { name: 'Kontrolü devral', exact: true }).tap();
  check('Robot playback also closes the flyout and uses the trained GRU without recording self-predictions');

  stage = 'genuine completed match';
  let finished;
  for (let i = 0; i < 24; i++) { finished = await advance(15); if (finished.phase === 'finished') break; }
  assert.equal(finished.phase, 'finished', 'actual opponent defeats the idle human through engine damage');
  assert.ok(finished.robots.some(robot => robot.hp === 0));
  await assertClosed();
  await fits('completed match 568 × 320 closed');
  await openPanel();
  assert.equal(await train.isEnabled(), true, 'post-match training is available after one compact button tap');
  await train.tap();
  const afterMatch = await completedTraining(second.model.trainedSteps, samples);
  const preserved = await state();
  assert.equal(preserved.phase, 'finished');
  assert.equal(preserved.time, finished.time);
  assert.deepEqual(preserved.robots.map(robot => robot.hp), finished.robots.map(robot => robot.hp));
  assert.equal(preserved.winner, finished.winner);
  report.learning.afterMatchSteps = afterMatch.model.trainedSteps;
  report.finishedMatch = { time: finished.time, winner: finished.winner, health: finished.robots.map(robot => robot.hp) };
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true', 'post-match training keeps loss details open');
  await closePanel();
  await assertClosed();
  check('After a genuinely completed match, retraining retains visible loss details and preserves the result');

  stage = 'persistence';
  await closePanel();
  await exitFullscreen();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="duel-app"][data-learning-ready="true"]').waitFor();
  await page.evaluate(() => { window.__DUEL__.pauseSimulation(true); window.__DUEL__.pausePresentation(true); });
  await assertClosed();
  const reloaded = await savedLearning();
  assert.equal(reloaded.model.trainedSteps, afterMatch.model.trainedSteps);
  assert.deepEqual(reloaded.samples, first.samples);
  await openPanel();
  assert.equal(await epochs.inputValue(), '1');
  assert.equal(await train.isEnabled(), true);
  await closePanel();
  check('Real IndexedDB reload preserves the trained model and examples while defaulting the compact flyout closed');
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
  await writeFile(new URL('training-flyout.json', artifacts), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}
