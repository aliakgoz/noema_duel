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
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('pageerror', error => report.errors.push({ stage, message: error.message }));
page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ stage, message: message.text() }); });
const cdp = await context.newCDPSession(page);
const touches = new Map();
const joystick = page.getByTestId('movement-joystick');
const movementZone = page.getByTestId('movement-zone');
const snapshot = () => page.evaluate(() => window.__DUEL__.state());
const input = () => page.evaluate(() => window.__DUEL__.input());
const advance = seconds => page.evaluate(seconds => { window.__DUEL__.advance(seconds); return window.__DUEL__.state(); }, seconds);
const ownShots = state => state.robots[0].shots;

async function ready(targetPage = page) {
  await targetPage.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await targetPage.locator('[data-testid="duel-app"][data-learning-ready="true"]').waitFor();
  await targetPage.getByTestId('duel-canvas').locator('canvas').waitFor({ state: 'visible' });
  await targetPage.waitForFunction(() => typeof window.__DUEL__?.input === 'function');
  // Real WebGL frames are captured below. Hold their presentation between those
  // captures so SwiftShader does not starve the independent touch/physics test.
  await targetPage.evaluate(() => { window.__DUEL__.pausePresentation(true); window.__DUEL__.pauseSimulation(true); });
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

async function center(locator) {
  if (locator === joystick) {
    const zone = await movementZone.boundingBox();
    assert.ok(zone, `${stage}: left movement area has bounds`);
    // The floating ring has real CSS dimensions while hidden. Start in a safe
    // left-field location and retain those dimensions for proportional drags.
    const ring = await joystick.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    return { ...ring, x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 };
  }
  const box = await locator.boundingBox();
  assert.ok(box, `${stage}: control has a bounding box`);
  return { ...box, x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function arenaPoint(x = .66, y = .4, targetPage = page) {
  const box = await targetPage.getByTestId('duel-canvas').locator('canvas').boundingBox();
  assert.ok(box, 'arena has bounds');
  return { x: box.x + box.width * x, y: box.y + box.height * y };
}

async function tapArena(x, y, id = 22) {
  await touch('touchStart', await arenaPoint(x, y), id);
  const aimed = await input();
  await touch('touchEnd', null, id);
  return aimed.aim;
}

async function neutral(label) {
  await page.waitForFunction(() => {
    const value = window.__DUEL__.input();
    return Math.hypot(value.move.x, value.move.z) < .0001 && !value.fire;
  }, null, { timeout: 3000 });
  assert.equal(await joystick.getAttribute('data-active'), 'false', `${label}: thumb returns to center`);
  assert.equal(await joystick.isVisible(), false, `${label}: movement gauge is invisible`);
}

async function screenshot(name) {
  if (process.env.NO_SCREENSHOTS === '1') return;
  await page.evaluate(() => window.__DUEL__.pausePresentation(false));
  await page.waitForTimeout(120);
  await page.screenshot({ path: fileURLToPath(new URL(name, artifacts)), fullPage: false });
  await page.evaluate(() => window.__DUEL__.pausePresentation(true));
  report.screenshots.push(name);
}

async function fits(label, targetPage = page) {
  const panel = targetPage.locator('.arena-fullscreen');
  const canvas = await panel.getByTestId('duel-canvas').locator('canvas').boundingBox();
  assert.ok(canvas && canvas.width >= 200 && canvas.height >= 140, `${label}: usable canvas`);
  const viewport = await targetPage.evaluate(() => ({ width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth + 1 }));
  assert.equal(viewport.overflow, false, `${label}: no horizontal overflow`);
  const controls = [
    ['movement zone', panel.getByTestId('movement-zone')],
    ['cover', panel.getByRole('button', { name: 'Al / bırak', exact: true })],
    ['pause', panel.getByTestId('pause-match')],
    ['exit', panel.getByRole('button', { name: 'Tam ekrandan çık', exact: true })],
  ];
  const boxes = {};
  for (const [name, control] of controls) {
    assert.equal(await control.isVisible(), true, `${label}: ${name} visible`);
    const box = await control.boundingBox();
    assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `${label}: ${name} stays inside viewport ${JSON.stringify(box)}`);
    assert.equal(await control.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    }), true, `${label}: ${name} receives touches without an overlapping overlay`);
    boxes[name] = box;
  }
  const movement = boxes['movement zone'];
  assert.ok(Math.abs(movement.x - canvas.x) < 2 && Math.abs(movement.y - canvas.y) < 2 && Math.abs(movement.width - canvas.width / 2) < 2 && Math.abs(movement.height - canvas.height) < 2, `${label}: movement area covers the left half of the rendered field`);
  const ring = await panel.getByTestId('movement-joystick').evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  assert.ok(Math.abs(ring.width - ring.height) < 2 && ring.width >= 76, `${label}: hidden movement gauge retains analog measurement dimensions`);
  assert.equal(await panel.getByTestId('movement-joystick').isVisible(), false, `${label}: movement gauge leaves the arena clear`);
  assert.equal(await panel.locator('.movement-hint').count(), 0, `${label}: movement hint is absent`);
  assert.equal(await panel.locator('.touch-fire').count(), 0, `${label}: separate fire button removed`);
  report.measurements.push({ label, viewport, canvas, controls: boxes });
  assert.equal(await panel.locator('.power-input').count(), 0, `${label}: power adjustment is removed`);
  report.checks.push(`${label}: left-half movement area, cover, pause and exit fit and receive touches; idle ring hidden and no power adjustment`);
}

async function savedSamples() {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('noema-local-v1', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, read = db.transaction('records').objectStore('records').get('noema-duel-gru96-v1');
      read.onsuccess = () => { db.close(); resolve(read.result?.samples ?? []); };
      read.onerror = () => { db.close(); reject(read.error); };
    };
  }));
}

function pointsInDirection(shot, robot, aim) {
  const dx = aim.x - robot.x, dz = aim.z - robot.z;
  return (shot.vx * dx + shot.vz * dz) / (Math.hypot(shot.vx, shot.vz) * Math.hypot(dx, dz));
}

async function tapAndGetShot(x = .7, y = .4) {
  const before = await snapshot();
  const aim = await tapArena(x, y);
  const after = await advance(.04);
  assert.equal(ownShots(after), ownShots(before) + 1, 'one arena tap launches exactly one stone');
  const shot = after.projectiles.filter(item => item.owner === 0).sort((a, b) => b.id - a.id)[0];
  assert.ok(shot, 'newly tapped projectile exists in the actual engine');
  assert.equal(after.robots[0].decision.power, 1, 'every actual player shot uses fixed full power');
  assert.ok(Math.abs(Math.hypot(shot.vx, shot.vz) - 18) < .001, 'flat projectile launches at the full 18m/s');
  assert.ok(shot.y === undefined || Math.abs(shot.y - 1.1) < .0001, 'projectile stays at the fixed muzzle height');
  assert.ok(shot.vy === undefined || shot.vy === 0, 'flat shot has no ballistic vertical velocity');
  assert.ok(pointsInDirection(shot, after.robots[0], aim) > .995, 'actual horizontal velocity points at the touched world position');
  return { before, after, shot, aim };
}

try {
  stage = 'portrait ready';
  await ready();
  assert.equal(await page.locator('.d-pad').count(), 0, 'old four-button direction pad remains removed');
  await page.getByTestId('training-toggle').tap();
  assert.equal(await page.getByRole('spinbutton', { name: 'Eğitim tur sayısı' }).inputValue(), '1', 'training still defaults to one pass');
  await page.getByTestId('training-close').tap();
  assert.equal(await page.getByTestId('trajectories-toggle').count(), 0, 'no future projectile trajectory control');
  await page.getByTestId('start-match').tap();
  await page.locator('.arena-fullscreen').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => Boolean(document.fullscreenElement)), true, 'starting the duel automatically enters native fullscreen');
  await fits('portrait 390×844');
  await screenshot('mobile-tap-portrait.png');

  stage = 'analog joystick movement';
  const samplesBefore = parseInt(await page.getByTestId('sample-count').textContent(), 10);
  const stick = await center(joystick);
  await touch('touchStart', stick);
  assert.equal(await joystick.isVisible(), false, 'pressing movement area does not display a joystick');
  assert.ok(Math.hypot((await input()).move.x, (await input()).move.z) < .0001, 'center dead zone is neutral');
  const centerBefore = await snapshot(), centerAfter = await advance(.15);
  assert.ok(Math.hypot(centerAfter.robots[0].x - centerBefore.robots[0].x, centerAfter.robots[0].z - centerBefore.robots[0].z) < .001, 'center touch causes no movement');
  await touch('touchMove', { x: stick.x, y: stick.y - stick.height * .16 });
  const smallTarget = -(await input()).move.z;
  assert.ok(smallTarget > .05 && smallTarget < .9, 'short drag gives proportional analog target');
  const partial = await advance(.3);
  assert.ok(-partial.robots[0].vz > .1 && -partial.robots[0].vz < 4.6, 'partial drag produces partial actual speed');
  await touch('touchMove', { x: stick.x, y: stick.y - stick.height * .8 });
  assert.ok((await input()).move.z < -.99, 'outside captured drag clamps to full speed');
  const full = await advance(.16);
  assert.ok(-full.robots[0].vz > 4.7 && -full.robots[0].vz > -partial.robots[0].vz + .5, 'full drag increases actual robot speed');
  await touch('touchEnd', null);
  await neutral('released movement');
  const beforeStop = await snapshot(), stopped = await advance(.2);
  assert.ok(Math.hypot(stopped.robots[0].x - beforeStop.robots[0].x, stopped.robots[0].z - beforeStop.robots[0].z) < .001, 'release stops without drift');
  assert.equal(ownShots(stopped), 0, 'joystick movement by itself never fires');
  report.checks.push('real touch dead zone, proportional movement, captured full drag and release stop; joystick never aims or fires');

  stage = 'one tap one shot';
  await advance(.7);
  const holdPoint = await arenaPoint(.67, .4);
  const beforeHold = await snapshot();
  await touch('touchStart', holdPoint, 22);
  const holdAim = (await input()).aim;
  const firstShot = await advance(.04);
  assert.equal(ownShots(firstShot), ownShots(beforeHold) + 1, 'touching the arena fires without a second button');
  const live = firstShot.projectiles.find(item => item.owner === 0);
  assert.ok(live && pointsInDirection(live, firstShot.robots[0], holdAim) > .995, 'tap projection sets real projectile direction');
  const held = await advance(3);
  assert.equal(ownShots(held), ownShots(firstShot), 'holding a finger over more than two cooldowns does not autofire');
  await touch('touchMove', await arenaPoint(.54, .44), 22);
  const dragged = await advance(1.4);
  assert.equal(ownShots(dragged), ownShots(firstShot), 'dragging a held arena finger does not fire again');
  await touch('touchEnd', null, 22);
  report.checks.push('one canvas touch launches one accurately aimed stone; holding and dragging never autofire');

  stage = 'independent simultaneous movement and tap';
  await touch('touchStart', stick);
  await touch('touchMove', { x: stick.x + stick.width * .4, y: stick.y + stick.height * .4 });
  const diagonal = (await input()).move;
  assert.ok(diagonal.x > .5 && diagonal.z > .5 && Math.abs(Math.hypot(diagonal.x, diagonal.z) - 1) < .001, 'diagonal joystick input is normalized');
  const simultaneous = await tapAndGetShot(.72, .38);
  assert.ok((await input()).move.x > .5 && (await input()).move.z > .5, 'releasing aiming finger preserves joystick');
  const movingShot = await advance(.3);
  assert.ok(movingShot.robots[0].x > simultaneous.before.robots[0].x + .3 && movingShot.robots[0].z > simultaneous.before.robots[0].z + .3, 'robot moves during tap shooting');
  await touch('touchEnd', null);
  await neutral('both fingers released');
  report.checks.push('real two-finger input moves and fires at the tapped world position; releasing tap preserves joystick');

  stage = 'cooldown queues only latest tap';
  await page.getByTestId('reset-match').tap();
  await page.getByTestId('start-match').tap();
  await advance(1.3);
  const initial = await tapAndGetShot(.7, .4);
  await tapArena(.63, .35);
  const latestAim = await tapArena(.8, .44);
  const queued = await snapshot();
  assert.equal(ownShots(queued), ownShots(initial.after), 'cooldown does not fire queued taps early');
  const releasedQueue = await advance(queued.robots[0].cooldown + .025);
  assert.equal(ownShots(releasedQueue), ownShots(initial.after) + 1, 'multiple cooldown taps produce only one pending shot');
  const latestShot = releasedQueue.projectiles.filter(item => item.owner === 0).sort((a, b) => b.id - a.id)[0];
  assert.ok(latestShot && pointsInDirection(latestShot, releasedQueue.robots[0], latestAim) > .995, `pending shot uses the latest touched point: ${JSON.stringify({ latestAim, latestShot, robot: releasedQueue.robots[0], events: releasedQueue.events.slice(-3) })}`);
  assert.equal(ownShots(await advance(2.6)), ownShots(releasedQueue), 'pending tap is consumed exactly once');
  report.checks.push('fixed cooldown queues one shot, replaces its aim with the latest tap and consumes it once');

  stage = 'pause cancels pending tap';
  const pauseShot = await tapAndGetShot(.7, .4);
  await tapArena(.8, .44);
  await page.getByTestId('pause-match').tap();
  const paused = await snapshot();
  assert.equal(paused.phase, 'paused');
  assert.equal(ownShots(paused), ownShots(pauseShot.after), 'pending shot has not fired before pause');
  assert.equal((await advance(2)).time, paused.time, 'paused simulation stays frozen');
  await neutral('pause clears controls');
  await page.getByTestId('pause-match').tap();
  assert.equal(ownShots(await advance(1.4)), ownShots(paused), 'resuming does not discharge a stale queued tap');
  report.checks.push('pause cancels queued shooting and clears movement; resume cannot fire a stale gesture');

  stage = 'rotation cancels active gesture and pending tap';
  const rotationShot = await tapAndGetShot(.7, .4);
  await tapArena(.8, .44);
  await touch('touchStart', stick);
  await touch('touchMove', { x: stick.x + stick.width * .4, y: stick.y });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(120);
  assert.equal(await page.locator('.arena-fullscreen').count(), 1, 'rotating the same page preserves fullscreen');
  await neutral('rotation');
  await touch('touchCancel', null);
  assert.equal(ownShots(await advance(1.4)), ownShots(rotationShot.after), 'rotation cancels queued tap');
  await fits('landscape 844×390 after rotation');
  await screenshot('mobile-tap-landscape.png');
  report.checks.push('rotation keeps native fullscreen while clearing the held joystick and pending touch shot');

  stage = 'compact landscape touch controls';
  await page.setViewportSize({ width: 604, height: 268 });
  await page.waitForTimeout(120);
  await fits('compact landscape 604×268');
  const compactStick = await center(joystick), compactBefore = await snapshot();
  await touch('touchStart', compactStick);
  await touch('touchMove', { x: compactStick.x + compactStick.width * .4, y: compactStick.y });
  const compactMoved = await advance(.18);
  await touch('touchEnd', null);
  assert.ok(compactMoved.robots[0].x > compactBefore.robots[0].x + .2, 'joystick remains usable after rotation');
  await neutral('compact released movement');
  // Aim on the unobstructed right half; the left half belongs to movement.
  await tapAndGetShot(.73, .56);
  await screenshot('mobile-tap-compact.png');
  report.checks.push('compact landscape joystick and direct arena tap still operate after gesture cancellation');

  stage = 'fixed full-power flat flight';
  await page.getByTestId('reset-match').tap();
  await page.getByTestId('start-match').tap();
  await advance(1);
  const launch = await tapAndGetShot(.68, .29);
  const flatFlight = await page.evaluate(shotId => {
    const initial = window.__DUEL__.state(), path = [];
    let state = initial;
    for (let tick = 0; tick < 140; tick++) {
      const shot = state.projectiles.find(item => item.id === shotId);
      if (!shot) break;
      path.push({ x: shot.x, y: shot.y ?? 1.1, z: shot.z, vy: shot.vy ?? 0, traveled: shot.traveled, speed: Math.hypot(shot.vx, shot.vz) });
      window.__DUEL__.advance(.025); state = window.__DUEL__.state();
    }
    return { path, elapsed: state.time - initial.time, remaining: state.projectiles.some(item => item.id === shotId) };
  }, launch.shot.id);
  assert.ok(flatFlight.path.length > 10, 'real flat projectile travels across the arena');
  assert.ok(flatFlight.path.every(point => point.y === 1.1 && point.vy === 0 && Math.abs(point.speed - 18) < .001), 'real flight stays level at full launch speed, including reflections');
  assert.equal(flatFlight.remaining, false, 'flat stone expires instead of flying forever');
  assert.ok(flatFlight.elapsed <= 2.6, 'full-power flight respects the 45m cumulative range limit at 18m/s');
  assert.ok(flatFlight.path.every(point => point.traveled <= 45.0001), 'actual traveled distance never exceeds the range limit');
  report.measurements.push({ flatFlight: { ...flatFlight, path: flatFlight.path.filter((_, index) => index % 4 === 0) } });
  report.checks.push('fixed full-power shots travel horizontally at 18m/s, reflect and expire within the 45m cumulative range');

  stage = 'demonstrations include taps';
  assert.ok(parseInt(await page.getByTestId('sample-count').textContent(), 10) > samplesBefore + 10, 'real controls produce teacher demonstrations');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  let samples = [];
  for (let tries = 0; tries < 20; tries++) {
    samples = await savedSamples();
    if (samples.some(sample => Math.abs(sample.output[1] + smallTarget) < .001) && samples.some(sample => sample.output[4] === 1)) break;
    await page.waitForTimeout(100);
  }
  assert.ok(samples.some(sample => Math.abs(sample.output[0]) < .001 && Math.abs(sample.output[1] + smallTarget) < .001 && sample.output[4] === 0), 'persisted continuous joystick label is preserved');
  assert.ok(samples.some(sample => sample.output[4] === 1 && Number.isFinite(sample.output[2])), 'actual tap firing and angle enter the real training dataset');
  assert.ok(samples.every(sample => sample.output[3] === 1), 'full-power target is fixed to one in actual training examples');
  report.checks.push('analog movement and tap-to-fire decisions enter persisted GRU training examples');

  stage = 'reverse rotation and GRU inspector';
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(120);
  await fits('portrait 390×844 after reverse rotation');
  await page.getByRole('button', { name: 'GRU modelini incele', exact: true }).tap();
  await page.getByTestId('brain-dialog').waitFor({ state: 'visible' });
  const dialog = await page.getByTestId('brain-dialog').boundingBox();
  assert.ok(dialog && dialog.x >= 0 && dialog.y >= 0 && dialog.x + dialog.width <= 391 && dialog.y + dialog.height <= 845, 'real GRU inspector fits portrait fullscreen');
  await page.keyboard.press('Escape');
  await page.getByTestId('brain-dialog').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.arena-fullscreen').count(), 1, 'closing model inspector preserves fullscreen');
  await page.getByRole('button', { name: 'Tam ekrandan çık', exact: true }).tap();
  await page.locator('.arena-fullscreen').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => Boolean(document.fullscreenElement)), false, 'native fullscreen exits cleanly');
  await neutral('fullscreen exit');
  report.checks.push('reverse rotation preserves fullscreen; actual GRU inspector and clean exit remain accessible');

  stage = 'normal mobile controls';
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator('.manual-panel').scrollIntoViewIfNeeded();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, document: document.documentElement.scrollWidth }));
    assert.ok(viewport.document <= viewport.width + 1, `normal ${width}: no horizontal overflow`);
    for (const control of [movementZone, page.getByRole('button', { name: 'Al / bırak', exact: true })]) {
      const box = await control.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= viewport.height + 1, `normal ${width}: mobile control remains visible`);
    }
    assert.equal(await joystick.isVisible(), false, `normal ${width}: idle floating ring is hidden`);
    report.checks.push(`normal ${width}: floating movement area and cover fit without horizontal overflow; power adjustment remains absent`);
  }
  await screenshot('mobile-tap-normal.png');
  await context.close();

  stage = 'CSS fullscreen fallback';
  const fallbackContext = await browser.newContext({ viewport: { width: 604, height: 268 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await fallbackContext.addInitScript(() => Object.defineProperty(Element.prototype, 'requestFullscreen', { configurable: true, value: undefined }));
  const fallbackPage = await fallbackContext.newPage();
  fallbackPage.on('pageerror', error => report.errors.push({ stage, message: error.message }));
  await ready(fallbackPage);
  await fallbackPage.getByTestId('start-match').tap();
  await fallbackPage.locator('.arena-fullscreen').waitFor({ state: 'visible' });
  assert.equal(await fallbackPage.evaluate(() => Boolean(document.fullscreenElement)), false, 'unsupported fullscreen uses CSS arena expansion');
  await fits('unsupported API fallback 604×268', fallbackPage);
  const fallbackBefore = await fallbackPage.evaluate(() => { window.__DUEL__.advance(1); return window.__DUEL__.state(); });
  const point = await arenaPoint(.73, .56, fallbackPage);
  await fallbackPage.touchscreen.tap(point.x, point.y);
  const fallbackAfter = await fallbackPage.evaluate(() => { window.__DUEL__.advance(.1); return window.__DUEL__.state(); });
  assert.equal(ownShots(fallbackAfter), ownShots(fallbackBefore) + 1, 'tap-to-fire also works without native fullscreen support');
  await fallbackPage.getByRole('button', { name: 'Tam ekrandan çık', exact: true }).tap();
  await fallbackPage.locator('.arena-fullscreen').waitFor({ state: 'detached' });
  await fallbackContext.close();
  report.checks.push('unsupported fullscreen API keeps a usable landscape arena with working touch shooting and clean exit');
  assert.deepEqual(report.errors, [], 'no uncaught browser errors');
  assert.deepEqual(report.consoleErrors, [], 'no console errors');
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = { stage, message: error.message, stack: error.stack };
  try { await screenshot('mobile-tap-failure.png'); } catch { /* preserve original failure */ }
  process.exitCode = 1;
} finally {
  clearInterval(progress);
  report.finishedAt = new Date().toISOString();
  await writeFile(new URL('mobile-tap.json', artifacts), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
