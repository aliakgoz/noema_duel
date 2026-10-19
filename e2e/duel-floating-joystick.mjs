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
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
let context, page, cdp;
const touches = new Map();
const check = name => { report.checks.push(name); console.log(JSON.stringify({ check: name })); };
const state = () => page.evaluate(() => window.__DUEL__.state());
const input = () => page.evaluate(() => window.__DUEL__.input());
const advance = seconds => page.evaluate(seconds => { window.__DUEL__.advance(seconds); return window.__DUEL__.state(); }, seconds);
const shots = snapshot => snapshot.robots[0].shots;
const stick = () => page.getByTestId('movement-joystick');
const zone = () => page.getByTestId('movement-zone');

async function ready({ fallback = false, width = 390, height = 844 } = {}) {
  context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  if (fallback) await context.addInitScript(() => Object.defineProperty(Element.prototype, 'requestFullscreen', { configurable: true, value: undefined }));
  page = await context.newPage();
  page.on('pageerror', error => report.errors.push({ stage, message: error.message }));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ stage, message: message.text() }); });
  cdp = await context.newCDPSession(page);
  touches.clear();
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="duel-app"][data-learning-ready="true"]').waitFor();
  await page.getByTestId('duel-canvas').locator('canvas').waitFor({ state: 'visible' });
  await page.waitForFunction(() => typeof window.__DUEL__?.input === 'function');
  // Freeze frame/clock scheduling only; every decision below uses the real input,
  // GRU and engine via the development clock, and screenshots render real WebGL.
  await page.evaluate(() => { window.__DUEL__.pausePresentation(true); window.__DUEL__.pauseSimulation(true); });
}

async function touch(type, point, id = 11) {
  let touchPoints;
  if (type === 'touchStart' || type === 'touchMove') {
    touches.set(id, { x: point.x, y: point.y, id });
    touchPoints = Array.from(touches.values());
  } else if (type === 'touchCancel') {
    touches.clear(); touchPoints = [];
  } else {
    const ending = touches.get(id);
    assert.ok(ending, `touch ${id} must be active before ending it`);
    touches.delete(id); touchPoints = [ending];
  }
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  await page.waitForTimeout(25);
}

async function point(x, y) {
  const box = await page.getByTestId('duel-canvas').locator('canvas').boundingBox();
  assert.ok(box, 'arena has bounds');
  return { x: box.x + box.width * x, y: box.y + box.height * y };
}

async function assertPointOwner(p, owner, label) {
  const found = await page.evaluate(({ x, y, owner }) => Boolean(document.elementFromPoint(x, y)?.closest(owner)), { ...p, owner });
  assert.equal(found, true, `${label}: real touch hits ${owner}`);
}

async function neutral(label) {
  await page.waitForFunction(() => {
    const value = window.__DUEL__.input();
    return Math.hypot(value.move.x, value.move.z) < .0001 && !value.fire;
  }, null, { timeout: 3000 });
  assert.equal(await stick().getAttribute('data-active'), 'false', `${label}: floating thumb is inactive`);
  assert.equal(await stick().isVisible(), false, `${label}: movement gauge remains invisible`);
}

async function invisibleMovement(label) {
  assert.equal(await stick().isVisible(), false, `${label}: active movement gauge is invisible`);
  assert.equal(await page.locator('.movement-hint').count(), 0, `${label}: no movement hint covers the field`);
}

async function begin() {
  if ((await state()).phase !== 'ready') await page.getByTestId('reset-match').tap();
  await page.getByTestId('start-match').tap();
  await page.locator('.arena-fullscreen').waitFor({ state: 'visible' });
  await page.waitForTimeout(300);
  assert.equal((await state()).phase, 'running');
}

async function screenshot(name) {
  if (process.env.NO_SCREENSHOTS === '1') return;
  await page.evaluate(() => window.__DUEL__.pausePresentation(false));
  await page.waitForTimeout(120);
  await page.screenshot({ path: fileURLToPath(new URL(name, artifacts)), fullPage: false });
  await page.evaluate(() => window.__DUEL__.pausePresentation(true));
  report.screenshots.push(name);
}

function direction(shot, robot, aim) {
  const dx = aim.x - robot.x, dz = aim.z - robot.z;
  return (shot.vx * dx + shot.vz * dz) / (Math.hypot(shot.vx, shot.vz) * Math.hypot(dx, dz));
}

async function shotAt(p, id = 22) {
  const before = await state();
  await touch('touchStart', p, id);
  const aim = (await input()).aim;
  await touch('touchEnd', null, id);
  const after = await advance(.04);
  assert.equal(shots(after), shots(before) + 1, 'right-side touch launches exactly one stone');
  const shot = after.projectiles.filter(item => item.owner === 0).sort((a, b) => b.id - a.id)[0];
  assert.ok(shot && direction(shot, after.robots[0], aim) > .995, `real projectile points at the tapped world point: ${JSON.stringify({ shot, aim, robot: after.robots[0], events: after.events.slice(-3) })}`);
  assert.ok(Math.abs(Math.hypot(shot.vx, shot.vz) - 18) < .001, 'full-power horizontal speed remains 18m/s');
  return { before, after, aim, shot };
}

async function fits(label) {
  const canvas = await page.getByTestId('duel-canvas').locator('canvas').boundingBox();
  const bounds = await zone().boundingBox();
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, document: document.documentElement.scrollWidth }));
  assert.ok(canvas && bounds && canvas.width >= 200 && canvas.height >= 140, `${label}: usable arena and movement zone`);
  assert.ok(viewport.document <= viewport.width + 1, `${label}: no horizontal overflow`);
  assert.ok(Math.abs(bounds.x - canvas.x) <= 1 && Math.abs(bounds.y - canvas.y) <= 1, `${label}: zone begins at arena top left`);
  assert.ok(Math.abs(bounds.width - canvas.width / 2) <= 1 && Math.abs(bounds.height - canvas.height) <= 1, `${label}: full left half is available`);
  assert.equal(await zone().evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)', `${label}: movement zone does not tint the arena`);
  await invisibleMovement(label);
  const controls = [page.getByTestId('pause-match'), page.getByTestId('reset-match'), page.getByTestId('training-toggle'), page.getByTestId('camera-toggle'), page.getByTestId('weather-toggle'), page.locator('.arena-panel .expand-button'), page.locator('.touch-cover')];
  const controlBoxes = [];
  for (const control of controls) {
    assert.equal(await control.isVisible(), true, `${label}: arena control visible`);
    const box = await control.boundingBox();
    assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `${label}: control remains onscreen`);
    assert.equal(await control.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    }), true, `${label}: zone does not cover another control`);
    controlBoxes.push(box);
  }
  assert.equal(await page.locator('.d-pad, .touch-fire, .power-input').count(), 0, `${label}: no obsolete controls`);
  assert.equal(await page.getByTestId('trajectories-toggle').count(), 0, `${label}: no prediction line control`);
  report.measurements.push({ label, viewport, canvas, zone: bounds, controls: controlBoxes });
  check(`${label}: transparent left-half movement area and unobstructed arena controls fit`);
}

async function importIdleModel() {
  const fixture = await page.evaluate(async () => {
    const { createDuelModel, isDuelModel } = await import('/src/duel/learning.ts');
    const model = createDuelModel(99017);
    model.weights.forEach(tensor => tensor.fill(0));
    model.biases.forEach(tensor => tensor.fill(0));
    Object.values(model.recurrent).forEach(tensor => tensor.fill(0));
    model.biases[2] = [Math.atanh(.64), Math.atanh(-.33), 0, 0, -8, -8];
    model.trainedSteps = 1;
    assertModel(model);
    function assertModel(value) { if (!isDuelModel(value)) throw new Error('fixture must be a valid GRU'); }
    return JSON.stringify(model);
  });
  await page.getByRole('button', { name: 'GRU modelini incele', exact: true }).click();
  await page.locator('.model-file-actions input[type="file"]').setInputFiles({ name: 'floating-joystick-fixture.json', mimeType: 'application/json', buffer: Buffer.from(fixture) });
  await page.waitForFunction(() => new Promise(resolve => {
    const request = indexedDB.open('noema-local-v1', 1);
    request.onerror = () => resolve(false);
    request.onsuccess = () => {
      const db = request.result, read = db.transaction('records').objectStore('records').get('noema-duel-gru96-v1');
      read.onsuccess = () => { db.close(); resolve(read.result?.model?.seed === 99017); };
      read.onerror = () => { db.close(); resolve(false); };
    };
  }));
  await page.getByTestId('brain-dialog').locator('.help-close').click();
}

try {
  stage = 'ready movement area is inert';
  await ready();
  const initial = await state(), initialAim = (await input()).aim;
  const idleOrigin = await point(.22, .6);
  await touch('touchStart', idleOrigin);
  await touch('touchMove', { x: idleOrigin.x + 50, y: idleOrigin.y - 35 });
  await neutral('ready');
  await touch('touchEnd', null);
  assert.equal((await advance(.2)).time, initial.time);
  assert.deepEqual((await input()).aim, initialAim, 'ready arena gesture does not aim');
  check('Ready arena gestures neither move, aim nor fire');

  stage = 'native fullscreen movement from anywhere';
  await begin();
  assert.equal(await page.evaluate(() => Boolean(document.fullscreenElement)), true);
  await fits('native portrait 390 x 844');
  const beforeMove = await state();
  let partialTarget;
  for (const [index, origin] of [[.14, .35], [.42, .7], [.02, .55], [.49, .45]].entries()) {
    const p = await point(...origin);
    await assertPointOwner(p, '[data-testid="movement-zone"]', `left origin ${index}`);
    const beforeAim = (await input()).aim;
    await touch('touchStart', p);
    assert.equal(await stick().getAttribute('data-active'), 'true', 'press creates a floating joystick');
    await invisibleMovement(`left origin ${index} pressed`);
    assert.ok(Math.abs(Number(await stick().getAttribute('data-origin-x')) - p.x) < 1 && Math.abs(Number(await stick().getAttribute('data-origin-y')) - p.y) < 1, 'floating origin is the actual press location');
    assert.ok(Math.hypot((await input()).move.x, (await input()).move.z) < .0001, 'new origin starts in a neutral dead zone');
    await touch('touchMove', { x: p.x + 14, y: p.y - 9 });
    const command = (await input()).move;
    assert.ok(command.x > .05 && command.z < -.05 && Math.hypot(command.x, command.z) < .95, 'short drag is an analog diagonal command');
    await invisibleMovement(`left origin ${index} dragged`);
    partialTarget ??= command;
    assert.ok(Math.abs(Number(await stick().getAttribute('data-move-x')) - command.x) < .00006);
    assert.ok(Math.abs(Number(await stick().getAttribute('data-move-z')) - command.z) < .00006);
    await advance(.13);
    assert.deepEqual((await input()).aim, beforeAim, 'movement touch does not alter aim');
    await touch('touchEnd', null);
    await neutral(`left origin ${index} released`);
  }
  assert.equal(shots(await state()), shots(beforeMove), 'left-side movement never fires');
  check('Four separated left-side starting points, including both edges, create invisible neutral analog controls without aiming or shooting');

  stage = 'captured movement crosses center';
  const origin = await point(.23, .55);
  await touch('touchStart', origin);
  await touch('touchMove', { x: origin.x, y: origin.y - 300 });
  assert.ok((await input()).move.z < -.99 && Math.abs((await input()).move.x) < .001, 'long drag clamps to full north speed');
  const fullBefore = await state(), fullAfter = await advance(.12);
  assert.ok(fullAfter.robots[0].z < fullBefore.robots[0].z - .5, 'engine receives full-speed movement');
  await touch('touchMove', await point(.72, .6));
  const crossed = await input();
  assert.ok(crossed.move.x > .9, 'movement finger stays captured after entering the right half');
  assert.equal(crossed.fire, false);
  await touch('touchEnd', null);
  await neutral('cross-center release');
  const stopBefore = await state(), stopAfter = await advance(.15);
  assert.ok(Math.hypot(stopAfter.robots[0].x - stopBefore.robots[0].x, stopAfter.robots[0].z - stopBefore.robots[0].z) < .001, 'release stops immediately');
  check('Captured movement clamps to full speed, can cross the center without firing, and stops without drift');

  stage = 'a second left finger cannot steal or fire';
  const first = await point(.13, .6), second = await point(.41, .55);
  await touch('touchStart', first);
  await touch('touchMove', { x: first.x + 45, y: first.y });
  const ownerMove = (await input()).move, beforeSecond = await state();
  await touch('touchStart', second, 12);
  await touch('touchMove', await point(.8, .55), 12);
  assert.deepEqual((await input()).move, ownerMove, 'second left-started finger does not steal movement');
  assert.equal((await input()).fire, false, 'ignored left finger does not become a shot after crossing');
  await advance(.1);
  assert.equal(shots(await state()), shots(beforeSecond));
  await touch('touchEnd', null, 12);
  assert.deepEqual((await input()).move, ownerMove, 'releasing ignored finger leaves owner intact');
  await touch('touchEnd', null);
  await neutral('all left fingers released');
  check('A second left-started finger cannot steal movement or turn into a shot when dragged across center');

  stage = 'simultaneous movement and aimed firing';
  await advance(1.3);
  const moveOrigin = await point(.2, .65);
  await touch('touchStart', moveOrigin);
  await touch('touchMove', { x: moveOrigin.x + 50, y: moveOrigin.y - 40 });
  const diagonal = (await input()).move;
  assert.ok(diagonal.x > .5 && diagonal.z < -.5);
  const shot = await shotAt(await point(.7, .4));
  assert.deepEqual((await input()).move, diagonal, 'shot finger release preserves the movement finger');
  const simultaneous = await advance(.15);
  assert.ok(simultaneous.robots[0].x > shot.before.robots[0].x + .2 && simultaneous.robots[0].z < shot.before.robots[0].z - .2, 'robot moves while firing');
  await invisibleMovement('active portrait movement and firing');
  await screenshot('invisible-controls-portrait.png');
  await touch('touchEnd', null);
  await neutral('simultaneous release');
  check('Real two-finger input moves and fires toward the right-side world point without interfering with movement');

  stage = 'right finger keeps firing ownership across center';
  await advance(1.3);
  const beforeHold = await state();
  await touch('touchStart', await point(.7, .4), 22);
  assert.equal(shots(await advance(.04)), shots(beforeHold) + 1);
  await touch('touchMove', await point(.2, .5), 22);
  assert.ok(Math.hypot((await input()).move.x, (await input()).move.z) < .0001, 'aim finger never becomes movement');
  assert.equal(await stick().getAttribute('data-active'), 'false');
  assert.equal(shots(await advance(2.7)), shots(beforeHold) + 1, 'dragging/holding across two cooldowns does not autofire');
  await touch('touchEnd', null, 22);
  await neutral('aim release');
  check('A right-started shot finger can cross left without activating movement or repeating its shot');

  stage = 'cancel and blur clear gestures';
  for (const event of ['touchCancel', 'blur']) {
    const p = await point(.22, .6);
    await touch('touchStart', p);
    await touch('touchMove', { x: p.x + 55, y: p.y });
    assert.ok((await input()).move.x > .9);
    if (event === 'touchCancel') await touch('touchCancel', null);
    else { await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await touch('touchEnd', null); }
    await neutral(event);
  }
  check('Native touch cancellation and application blur both cancel the floating joystick');

  stage = 'training controls reset movement without accidental shot';
  const trainingOrigin = await point(.2, .58);
  await touch('touchStart', trainingOrigin);
  await touch('touchMove', { x: trainingOrigin.x + 55, y: trainingOrigin.y });
  await page.getByTestId('training-toggle').click();
  await neutral('training panel opens');
  await touch('touchEnd', null);
  const beforeDismiss = await state();
  const dismissPoint = await point(.7, .65);
  await page.touchscreen.tap(dismissPoint.x, dismissPoint.y);
  assert.equal(await page.getByTestId('training-toggle').getAttribute('aria-expanded'), 'false');
  await neutral('training dismissed');
  assert.equal(shots(await advance(1.4)), shots(beforeDismiss), 'dismiss tap is not replayed as a shot');
  check('Opening training resets the held movement; dismissing it on the field does not create a shot');

  stage = 'pause clears movement and prevents new input';
  const pauseOrigin = await point(.2, .55);
  await touch('touchStart', pauseOrigin);
  await touch('touchMove', { x: pauseOrigin.x + 50, y: pauseOrigin.y });
  await page.getByTestId('pause-match').click();
  await neutral('paused');
  await touch('touchEnd', null);
  const paused = await state();
  const pausedOrigin = await point(.15, .7);
  await touch('touchStart', pausedOrigin);
  await touch('touchMove', { x: pausedOrigin.x + 40, y: pausedOrigin.y });
  await touch('touchEnd', null);
  await neutral('paused field drag');
  assert.equal((await advance(.5)).time, paused.time);
  await page.getByTestId('pause-match').tap();
  await neutral('resume');
  check('Pausing stops the active joystick and paused field gestures cannot survive into resume');

  stage = 'rotation resets gesture and supports compact landscape';
  const rotationOrigin = await point(.2, .55);
  await touch('touchStart', rotationOrigin);
  await touch('touchMove', { x: rotationOrigin.x + 50, y: rotationOrigin.y });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(250);
  await neutral('rotation');
  await touch('touchCancel', null);
  await fits('native landscape 844 x 390');
  const landscapeOrigin = await point(.22, .65);
  await touch('touchStart', landscapeOrigin);
  await touch('touchMove', { x: landscapeOrigin.x + 45, y: landscapeOrigin.y - 30 });
  const landscapeBefore = await state(), landscapeAfter = await advance(.12);
  assert.ok((await input()).move.x > .5 && (await input()).move.z < -.5, 'landscape hidden control gives a diagonal movement command');
  assert.ok(landscapeAfter.robots[0].x > landscapeBefore.robots[0].x + .2 && landscapeAfter.robots[0].z < landscapeBefore.robots[0].z - .2, 'landscape robot actually moves with no visible control');
  await invisibleMovement('active landscape movement');
  await screenshot('invisible-controls-landscape.png');
  await touch('touchEnd', null);
  await neutral('landscape release');
  for (const [width, height] of [[604, 268], [568, 320], [320, 568]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(250);
    await fits(`native ${width} x ${height}`);
    const p = await point(.22, .65);
    await touch('touchStart', p);
    await touch('touchMove', { x: p.x + 45, y: p.y });
    assert.ok((await input()).move.x > .9, 'floating input works after viewport changes');
    await touch('touchEnd', null);
    await neutral(`release ${width}`);
  }
  check('Rotation cancels its old gesture; floating movement still works across portrait and compact landscape');

  stage = 'keyboard still contributes manual movement';
  await page.keyboard.down('w');
  const keyboardBefore = await state(), keyboardAfter = await advance(.12);
  assert.ok((await input()).move.z < -.99 && keyboardAfter.robots[0].z < keyboardBefore.robots[0].z - .5);
  await page.keyboard.up('w');
  await neutral('keyboard release');
  check('Keyboard movement remains compatible with the floating touch control');

  stage = 'teacher demonstrations preserve continuous input';
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.waitForFunction(expected => new Promise(resolve => {
    const request = indexedDB.open('noema-local-v1', 1);
    request.onerror = () => resolve(false);
    request.onsuccess = () => {
      const db = request.result, read = db.transaction('records').objectStore('records').get('noema-duel-gru96-v1');
      read.onsuccess = () => {
        const samples = read.result?.samples ?? [];
        const analog = samples.some(sample => Math.abs(sample.output[0] - expected.x) < .001 && Math.abs(sample.output[1] - expected.z) < .001 && sample.output[4] === 0);
        const fired = samples.some(sample => sample.output[4] === 1 && sample.output[3] === 1);
        db.close(); resolve(analog && fired);
      };
      read.onerror = () => { db.close(); resolve(false); };
    };
  }), partialTarget);
  check('Actual floating analog movement and simultaneous shot commands enter the persisted GRU teaching samples');

  stage = 'model playback and manual takeover';
  await importIdleModel();
  await page.getByTestId('watch-robot').click();
  await page.getByTestId('robot-control-monitor').waitFor({ state: 'visible' });
  await advance(.12);
  const actual = await page.evaluate(() => window.__DUEL__.control());
  assert.ok(Math.abs(actual.command.move.x - .64) < .00001 && Math.abs(actual.command.move.z + .33) < .00001, 'model still produces its real continuous movement');
  assert.equal(Number(await page.getByTestId('robot-move-knob').getAttribute('data-x')), .64);
  assert.equal(await zone().isVisible(), false, 'manual movement area is absent during model playback');
  assert.equal(await stick().isVisible(), false, 'interactive joystick is absent during model playback');
  const spectatorBefore = await state(), spectatorInput = await input();
  const spectatorPoint = await point(.22, .6);
  await touch('touchStart', spectatorPoint);
  await touch('touchMove', { x: spectatorPoint.x + 50, y: spectatorPoint.y });
  await touch('touchEnd', null);
  assert.deepEqual(await input(), spectatorInput, 'spectator drag never changes manual controls');
  assert.equal(shots(await state()), shots(spectatorBefore));
  await page.getByTestId('watch-robot').click();
  await zone().waitFor({ state: 'visible' });
  await neutral('manual takeover');
  const takeoverPoint = await point(.22, .65);
  await touch('touchStart', takeoverPoint);
  await touch('touchMove', { x: takeoverPoint.x + 50, y: takeoverPoint.y });
  assert.ok((await input()).move.x > .9);
  await touch('touchEnd', null);
  await neutral('takeover release');
  check('Real GRU playback keeps its command readout, disables manual touch input, and cleanly restores floating control on takeover');

  stage = 'fullscreen exit and normal mobile view';
  await page.locator('.arena-panel .expand-button').tap();
  await page.locator('.arena-fullscreen').waitFor({ state: 'detached' });
  await neutral('fullscreen exit');
  for (const [width, height] of [[390, 844], [320, 568]]) {
    await page.setViewportSize({ width, height });
    await page.getByTestId('duel-canvas').scrollIntoViewIfNeeded();
    const canvas = await page.getByTestId('duel-canvas').locator('canvas').boundingBox();
    const bounds = await zone().boundingBox();
    assert.ok(canvas && bounds && Math.abs(bounds.width - canvas.width / 2) <= 1 && Math.abs(bounds.height - canvas.height) <= 1, 'normal mode keeps the same left-half movement contract');
    const p = await point(.22, .55);
    await touch('touchStart', p);
    await touch('touchMove', { x: p.x + 45, y: p.y });
    assert.ok((await input()).move.x > .9, 'normal-view movement is live');
    await touch('touchEnd', null);
    await neutral('normal mode release');
  }
  check('Exiting fullscreen preserves clean controls, and floating input works in normal mobile view');
  await context.close();

  stage = 'unsupported fullscreen API fallback';
  await ready({ fallback: true, width: 604, height: 268 });
  await begin();
  assert.equal(await page.evaluate(() => Boolean(document.fullscreenElement)), false);
  await fits('fallback landscape 604 x 268');
  const fallbackPoint = await point(.22, .65);
  await touch('touchStart', fallbackPoint);
  // Travel north here: advancing east into the initial cover crate can consume
  // a correctly launched stone before the first fixed-step sample observes it.
  await touch('touchMove', { x: fallbackPoint.x, y: fallbackPoint.y - 45 });
  const fallbackBefore = await state(), fallbackAfter = await advance(.7);
  assert.ok(fallbackAfter.robots[0].z < fallbackBefore.robots[0].z - .5);
  await shotAt(await point(.7, .5));
  assert.ok((await input()).move.z < -.9);
  await invisibleMovement('active fallback movement and firing');
  await screenshot('invisible-controls-fallback.png');
  await touch('touchEnd', null);
  await neutral('fallback movement release');
  await page.locator('.arena-panel .expand-button').tap();
  await page.locator('.arena-fullscreen').waitFor({ state: 'detached' });
  check('CSS fullscreen fallback supports real simultaneous floating movement and aimed firing with clean exit');
  assert.deepEqual(report.errors, [], 'no uncaught browser errors');
  assert.deepEqual(report.consoleErrors, [], 'no browser console errors');
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = { stage, message: error.message, stack: error.stack };
  try { if (page && !page.isClosed()) await screenshot('floating-joystick-failure.png'); } catch { /* preserve original failure */ }
  process.exitCode = 1;
} finally {
  clearInterval(progress);
  report.finishedAt = new Date().toISOString();
  await writeFile(new URL('floating-joystick.json', artifacts), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
