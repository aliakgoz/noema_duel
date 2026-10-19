import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const fullscreenOnly = process.env.FULLSCREEN_ONLY === '1';
const artifacts = new URL('../artifacts/duel/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const result = { baseURL, startedAt: new Date().toISOString(), checks: [], errors: [], consoleErrors: [], screenshots: [], workers: [] };
let stage = 'launch';
const progressTimer = setInterval(() => console.log(JSON.stringify({ stage })), 10_000);
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

function observe(page) {
  page.on('worker', worker => result.workers.push(worker.url()));
  page.on('pageerror', error => result.errors.push({ stage, message: error.message, stack: error.stack }));
  page.on('console', message => {
    if (message.type() === 'error') result.consoleErrors.push({ stage, message: message.text() });
  });
}

async function ready(page) {
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('duel-app').waitFor({ state: 'visible' });
  await page.locator('[data-testid="duel-app"][data-learning-ready="true"]').waitFor();
  await page.getByTestId('duel-canvas').locator('canvas').waitFor({ state: 'visible' });
  await page.waitForFunction(() => typeof window.__DUEL__?.state === 'function' && typeof window.__DUEL__?.advance === 'function');
  // SwiftShader rasterization is tested in screenshots. Keep its last real frame
  // between captures so GPU emulation cannot starve the independent learning test.
  await page.evaluate(() => window.__DUEL__.pausePresentation(true));
  await page.locator('.training-drawer > summary').click();
}

async function state(page) {
  return page.evaluate(() => window.__DUEL__.state());
}

async function advance(page, seconds) {
  await page.evaluate(seconds => window.__DUEL__.advance(seconds), seconds);
  await page.waitForTimeout(30);
  return state(page);
}

async function savedLearning(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('noema-local-v1', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, read = db.transaction('records').objectStore('records').get('noema-duel-gru96-v1');
      read.onsuccess = () => { db.close(); resolve(read.result); };
      read.onerror = () => { db.close(); reject(read.error); };
    };
  }));
}

function ownHalves(snapshot, label) {
  assert.equal(snapshot.robots.length, 2, `${label}: exactly two robots`);
  assert.ok(snapshot.robots[0].x < 0, `${label}: left robot must stay in its half`);
  assert.ok(snapshot.robots[1].x > 0, `${label}: right robot must stay in its half`);
  for (const robot of snapshot.robots) {
    assert.ok(Number.isFinite(robot.x) && Number.isFinite(robot.z), `${label}: finite robot position`);
    assert.ok(robot.hp >= 0 && robot.hp <= robot.maxHp, `${label}: health bounds`);
  }
}

async function fits(page, label) {
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  assert.ok(dimensions.document <= dimensions.viewport + 1, `${label}: horizontal overflow ${JSON.stringify(dimensions)}`);
  const bounds = await page.getByTestId('duel-canvas').locator('canvas').boundingBox();
  assert.ok(bounds && bounds.width >= 200 && bounds.height >= 160, `${label}: usable rendered canvas`);
  result.checks.push(`${label}: canvas visible; no horizontal overflow`);
}

async function screenshot(page, name, fullPage = true) {
  if (process.env.NO_SCREENSHOTS === '1') return;
  await page.evaluate(() => window.__DUEL__?.pausePresentation(false));
  await page.waitForTimeout(120);
  await page.screenshot({ path: fileURLToPath(new URL(name, artifacts)), fullPage });
  await page.evaluate(() => window.__DUEL__?.pausePresentation(true));
  result.screenshots.push(name);
}

async function fullscreenRegression(width, height) {
  stage = `fullscreen ${width}x${height}`;
  const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage(); observe(page); await ready(page);
  await page.getByTestId('start-match').click();
  const beforeKeyboard = await state(page);
  // Start retains button focus. Direction keys must still reach the manual robot.
  await page.keyboard.down('w');
  await page.waitForFunction(beforeZ => window.__DUEL__.state().robots[0].z < beforeZ - .05, beforeKeyboard.robots[0].z, { timeout: 5000 });
  const keyboardMoved = await advance(page, .35);
  await page.keyboard.up('w');
  assert.ok(keyboardMoved.robots[0].z < beforeKeyboard.robots[0].z - .1, `direction keys work directly after clicking Start without clicking the canvas: ${JSON.stringify({ before: { z: beforeKeyboard.robots[0].z, time: beforeKeyboard.time }, after: { z: keyboardMoved.robots[0].z, time: keyboardMoved.time, phase: keyboardMoved.phase }, focus: await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 180)) })}`);
  await page.getByTestId('reset-match').click();
  await page.getByTestId('start-match').click();
  const panel = page.locator('.arena-fullscreen');
  await panel.waitFor({ state: 'visible' });
  const cdp = await context.newCDPSession(page);
  async function pressTouch(control, seconds) {
    const box = await control.boundingBox();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, 'fullscreen touch control stays inside the visible viewport');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }] });
    await page.waitForTimeout(60);
    const snapshot = await advance(page, seconds);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return snapshot;
  }
  const beforeTouch = await state(page);
  const movementZone = panel.getByTestId('movement-zone');
  const movementBox = await movementZone.boundingBox();
  assert.ok(movementBox, 'left movement area stays available while the floating ring is hidden');
  const joystickCenter = { x: movementBox.x + movementBox.width / 2, y: movementBox.y + movementBox.height / 2, id: 1 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [joystickCenter] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...joystickCenter, x: joystickCenter.x + 40 }] });
  await page.waitForTimeout(60);
  const touchMoved = await advance(page, .3);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.ok(touchMoved.robots[0].x > beforeTouch.robots[0].x + .1, 'fullscreen circular joystick touch input moves the robot');
  ownHalves(touchMoved, stage);
  assert.equal(await panel.locator('.power-input').count(), 0, 'manual power adjustment is removed');
  await advance(page, 1.3);
  const beforeFire = await state(page);
  const aimBounds = await panel.getByTestId('duel-canvas').locator('canvas').boundingBox();
  await page.touchscreen.tap(aimBounds.x + aimBounds.width * .7, aimBounds.y + aimBounds.height * .4);
  const fired = await advance(page, .1);
  assert.equal(fired.robots[0].shots, beforeFire.robots[0].shots + 1, 'fullscreen arena tap fires exactly one real projectile');
  assert.equal(fired.robots[0].decision.power, 1, 'tap shooting always uses full power');
  const visible = await panel.evaluate(element => ({ width: element.scrollWidth, height: element.clientHeight, viewportWidth: innerWidth, viewportHeight: innerHeight }));
  assert.ok(visible.width <= visible.viewportWidth + 1 && visible.height <= visible.viewportHeight + 1, 'fullscreen arena fits the viewport');
  await screenshot(page, `fullscreen-${width}x${height}.png`, false);
  await panel.getByRole('button', { name: 'Tam ekrandan çık', exact: true }).tap();
  await page.locator('.arena-fullscreen').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => Boolean(document.fullscreenElement)), false, 'fullscreen exits cleanly');
  result.checks.push(`${width}x${height}: focused Start keyboard input, fullscreen real touch movement and direct tap shooting, fixed full power, visible controls and exit`);
  await context.close();
}

try {
  if (fullscreenOnly) {
    for (const [width, height] of [[390, 844], [604, 268]]) await fullscreenRegression(width, height);
  } else {
  stage = 'desktop ready';
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: .5 });
  const page = await desktop.newPage();
  observe(page);
  await ready(page);
  const initial = await state(page);
  assert.equal(initial.phase, 'ready');
  assert.equal(initial.robots[0].hp, 240);
  assert.equal(initial.robots[1].hp, 240);
  ownHalves(initial, stage);
  await fits(page, 'desktop 1440');
  await screenshot(page, 'desktop-ready.png');

  stage = 'pause and resume';
  await page.getByTestId('start-match').click();
  assert.equal((await state(page)).phase, 'running');
  const untrained = await advance(page, .4);
  assert.equal(untrained.robots[0].x, initial.robots[0].x, 'untrained player robot must not use the opponent scripted planner');
  assert.equal(untrained.robots[0].shots, 0, 'untrained player robot must wait for a demonstration');
  await page.getByTestId('pause-match').click();
  const paused = await state(page);
  assert.equal(paused.phase, 'paused');
  await page.waitForTimeout(250);
  assert.equal((await state(page)).time, paused.time, 'paused animation frames must not advance match time');
  const stillPaused = await advance(page, 1);
  assert.equal(stillPaused.time, paused.time, 'deterministic advance must respect pause');
  await page.getByTestId('pause-match').click();
  assert.equal((await state(page)).phase, 'running');
  result.checks.push('start, pause, frozen simulation and resume');

  stage = 'manual demonstrations';
  await page.getByRole('button', { name: 'Tam ekrandan çık', exact: true }).click();
  assert.equal(await page.getByTestId('manual-mode').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByTestId('watch-robot').isEnabled(), false, 'watching requires a trained player model');
  const canvas = page.getByTestId('duel-canvas').locator('canvas');
  const dimensions = await canvas.boundingBox();
  await canvas.click({ position: { x: dimensions.width * .72, y: dimensions.height * .5 } });
  const beforeDemo = (await state(page)).robots[0];
  const samplesBeforeDemo = parseInt(await page.getByTestId('sample-count').textContent(), 10);
  await page.keyboard.down('d');
  await page.keyboard.down('Space');
  const flight = await page.waitForFunction(() => {
    const shot = window.__DUEL__.state().projectiles.find(shot => shot.owner === 0);
    return shot ? { vx: shot.vx, vz: shot.vz, radius: shot.radius } : false;
  }, null, { timeout: 5000 });
  const projectile = await flight.jsonValue();
  assert.ok(Math.abs(Math.hypot(projectile.vx, projectile.vz) - 18) < .001, 'live flat projectile uses fixed full-power 18m/s launch speed');
  assert.equal(projectile.radius, .2, 'live projectile has the larger visible radius');
  result.projectile = { speed: Math.hypot(projectile.vx, projectile.vz), radius: projectile.radius };
  result.checks.push('live flat projectile uses fixed full-power speed and a larger visible radius');
  await advance(page, 3);
  await page.waitForFunction(before => parseInt(document.querySelector('[data-testid="sample-count"]').textContent, 10) >= before + 24, samplesBeforeDemo, { timeout: 60_000 });
  await page.keyboard.up('Space');
  await page.keyboard.up('d');
  const demonstrated = await state(page);
  assert.ok(demonstrated.robots[0].x > beforeDemo.x + .1, 'manual D input must move the player robot');
  assert.ok(demonstrated.robots[0].shots > 0, 'held manual fire must throw real projectiles');
  ownHalves(demonstrated, stage);
  result.checks.push('real keyboard movement and held fire record at least 20 demonstrations');

  stage = 'worker training';
  if (await page.getByTestId('training-toggle').getAttribute('aria-expanded') !== 'true') await page.getByTestId('training-toggle').click();
  const epochInput = page.getByRole('spinbutton', { name: 'Eğitim tur sayısı' });
  assert.equal(await epochInput.inputValue(), '1', 'new sessions default to one training pass');
  await page.getByTestId('train-robot').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="watch-robot"]').disabled, null, { timeout: 30_000 });
  assert.equal((await state(page)).phase, 'paused', 'training pauses the active match');
  await page.evaluate(() => window.__DUEL__.pausePresentation(true));
  assert.ok(result.workers.some(url => url.includes('learning.worker')), 'backpropagation must use the real dedicated Worker');
  const firstPass = await savedLearning(page);
  assert.equal(firstPass.model.trainedSteps, firstPass.samples.length, 'default training consumes every demonstration exactly once');
  result.checks.push('training defaults to exactly one pass');
  if (await page.getByTestId('training-toggle').getAttribute('aria-expanded') !== 'true') await page.getByTestId('training-toggle').click();
  await epochInput.fill('99');
  await page.getByTestId('train-robot').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="watch-robot"]').disabled, null, { timeout: 60_000 });
  await page.evaluate(() => window.__DUEL__.pausePresentation(true));
  const saved = await savedLearning(page);
  assert.ok(saved.samples.length >= 20);
  assert.equal(saved.model.trainedSteps, saved.samples.length * 100, 'selectable passes continue from the existing trained model');
  assert.ok(Number.isFinite(saved.loss));
  assert.ok(saved.samples.filter(sample => sample.output[0] > .9 && sample.output[4] === 1).length >= 16, 'stored labels must contain the demonstrated movement and firing');
  result.learning = { samples: saved.samples.length, trainedSteps: saved.model.trainedSteps, loss: saved.loss, version: saved.model.version };
  result.checks.push('dedicated Worker trains actual motor targets and persists the model plus demonstrations');
  await screenshot(page, 'desktop-trained.png');

  stage = 'learned robot playback';
  await page.getByTestId('watch-robot').click();
  const playbackStart = await state(page);
  assert.equal(playbackStart.phase, 'running');
  assert.equal(await page.getByTestId('manual-mode').getAttribute('aria-pressed'), 'false');
  const playback = await advance(page, 1.5);
  assert.ok(playback.robots[0].x > playbackStart.robots[0].x + .1, 'trained robot must reproduce rightward movement');
  assert.ok(playback.robots[0].shots > 0, 'trained robot must reproduce firing');
  ownHalves(playback, stage);
  assert.equal(parseInt(await page.getByTestId('sample-count').textContent(), 10), saved.samples.length, 'playback cannot record its own predictions as teacher demonstrations');
  result.checks.push('trained player reproduces demonstrated movement and firing without adding self-generated labels');
  await screenshot(page, 'desktop-learned-match.png');

  stage = 'view controls';
  for (const testId of ['camera-toggle']) {
    const control = page.getByTestId(testId);
    const attribute = (await control.getAttribute('aria-pressed')) !== null ? 'aria-pressed' : 'aria-label';
    const before = await control.getAttribute(attribute);
    await control.click();
    assert.notEqual(await control.getAttribute(attribute), before, `${testId}: toggle state`);
    await control.click();
  }
  const speed = page.getByLabel('Simülasyon hızı', { exact: true });
  const speedOptions = await speed.locator('option').evaluateAll(options => options.map(option => option.value));
  assert.ok(speedOptions.length >= 2, 'simulation speed choices');
  await speed.selectOption(speedOptions.at(-1));
  await speed.selectOption(speedOptions[0]);
  assert.equal(await page.getByTestId('trajectories-toggle').count(), 0, 'future projectile path controls are removed');
  result.checks.push('camera and speed controls; future projectile paths removed');

  stage = 'learned duel health and victory';
  let battle = await state(page);
  for (let turn = 0; turn < 9 && battle.phase === 'running'; turn++) {
    battle = await advance(page, 5);
    ownHalves(battle, `battle ${turn}`);
    if (turn === 1) await screenshot(page, 'desktop-match.png');
  }
  assert.ok(battle.robots.some(robot => robot.shots > 0), 'robots decide and fire shots');
  assert.ok(battle.robots.some(robot => robot.hp < robot.maxHp), 'shots deal damage');
  if (battle.phase === 'finished') {
    if (battle.winner === 'draw') assert.ok(battle.robots.every(robot => robot.hp === 0));
    else {
      assert.ok(battle.winner === 0 || battle.winner === 1);
      assert.equal(battle.robots[1 - battle.winner].hp, 0, 'loser health is depleted');
      assert.ok(battle.robots[battle.winner].hp > 0, 'winner survives');
    }
  }
  result.battle = { time: battle.time, phase: battle.phase, winner: battle.winner, robots: battle.robots.map(({ name, hp, shots, hits, damage }) => ({ name, hp, shots, hits, damage })) };
  result.checks.push('learned robot vs training opponent fires, deals damage and respects court halves until victory or 45 simulated seconds');
  await screenshot(page, 'desktop-combat.png');

  stage = 'model persistence';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('duel-canvas').locator('canvas').waitFor({ state: 'visible' });
  await page.locator('[data-testid="duel-app"][data-learning-ready="true"]').waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-testid="watch-robot"]').disabled);
  await page.evaluate(() => window.__DUEL__.pausePresentation(true));
  const restored = await savedLearning(page);
  assert.deepEqual(restored.model, saved.model, 'trained weights persist across page reload');
  assert.equal(parseInt(await page.getByTestId('sample-count').textContent(), 10), saved.samples.length);
  result.checks.push('model weights and demonstrations survive a real reload');

  stage = 'court selection';
  await page.locator('.training-drawer > summary').click();
  const layout = page.getByLabel('Arena seçimi', { exact: true });
  const layoutOptions = await layout.locator('option').evaluateAll(options => options.map(option => option.value));
  assert.equal(layoutOptions.length, 3, 'three court layouts');
  for (const option of layoutOptions) {
    await layout.selectOption(option);
    const selected = await state(page);
    assert.equal(selected.layout, option);
    assert.equal(selected.phase, 'ready', 'court selection resets the match');
    assert.equal(await page.getByTestId('watch-robot').isEnabled(), true, 'changing court preserves trained model');
    assert.equal(parseInt(await page.getByTestId('sample-count').textContent(), 10), saved.samples.length);
    ownHalves(selected, `layout ${option}`);
  }
  result.checks.push('three court layouts load cleanly and reset match state');
  await page.getByTestId('watch-robot').click();
  await page.getByTestId('teach-mode').click();
  assert.equal(await page.getByTestId('manual-mode').getAttribute('aria-pressed'), 'true');
  result.checks.push('teaching mode can take control back from the learned robot');
  await desktop.close();

  for (const width of [390, 768]) {
    stage = `mobile ${width}`;
    const mobile = await browser.newContext({ viewport: { width, height: 900 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    const small = await mobile.newPage();
    observe(small);
    await ready(small);
    await fits(small, stage);
    await screenshot(small, `mobile-${width}-ready.png`);
    await small.getByTestId('start-match').tap();
    await advance(small, 2);
    assert.equal((await state(small)).phase, 'running');
    await small.getByTestId('pause-match').tap();
    assert.equal((await state(small)).phase, 'paused');
    await small.getByTestId('reset-match').tap();
    assert.equal((await state(small)).phase, 'ready');
    result.checks.push(`mobile ${width}: touch start, pause and reset`);
    await mobile.close();
  }
  }

  assert.deepEqual(result.errors, [], 'browser page errors');
  assert.deepEqual(result.consoleErrors, [], 'browser console errors');
  result.passed = true;
} catch (error) {
  result.passed = false;
  result.failure = { stage, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  clearInterval(progressTimer);
  await browser.close();
  result.finishedAt = new Date().toISOString();
  await writeFile(new URL(fullscreenOnly ? 'controls.json' : 'duel.json', artifacts), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
