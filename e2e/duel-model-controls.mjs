import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:5174';
const artifacts = new URL('../artifacts/duel/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], commands: [], measurements: [], screenshots: [], errors: [], consoleErrors: [] };
let stage = 'launch';
const progress = setInterval(() => console.log(JSON.stringify({ stage })), 10_000);
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('pageerror', error => report.errors.push({ stage, message: error.message }));
page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ stage, message: message.text() }); });
const monitor = page.getByTestId('robot-control-monitor');
const knob = page.getByTestId('robot-move-knob');
const fire = page.getByTestId('robot-fire-command');
const cover = page.getByTestId('robot-cover-command');
const state = () => page.evaluate(() => window.__DUEL__.state());
const control = () => page.evaluate(() => window.__DUEL__.control());
const advance = seconds => page.evaluate(seconds => { window.__DUEL__.advance(seconds); return window.__DUEL__.state(); }, seconds);
const check = name => { report.checks.push(name); console.log(JSON.stringify({ check: name })); };
let fixtureSeed = 100;

async function screenshot(name) {
  if (process.env.NO_SCREENSHOTS === '1') return;
  await page.evaluate(() => window.__DUEL__.pausePresentation(false));
  await page.waitForTimeout(120);
  await page.screenshot({ path: fileURLToPath(new URL(name, artifacts)), fullPage: false });
  await page.evaluate(() => window.__DUEL__.pausePresentation(true));
  report.screenshots.push(name);
}

// These deliberately simple fixtures run through the real validated JSON importer,
// real GRU, inference clock and fixed-step engine. No game state is injected.
async function importFixture({ x = 0, z = 0, fire = false, cover = false, delayedCover = false } = {}) {
  const seed = ++fixtureSeed;
  const fixture = await page.evaluate(async ({ x, z, fire, cover, delayedCover, seed }) => {
    const { createDuelModel, isDuelModel } = await import('/src/duel/learning.ts');
    const model = createDuelModel(seed);
    model.weights.forEach(tensor => tensor.fill(0));
    model.biases.forEach(tensor => tensor.fill(0));
    Object.values(model.recurrent).forEach(tensor => tensor.fill(0));
    model.biases[2] = [Math.atanh(x), Math.atanh(z), 0, 0, fire ? 8 : -8, cover ? 8 : -8];
    if (delayedCover) {
      // Input 9 is elapsed seconds / 180. With an update gate near zero this
      // path crosses the cover threshold around .37 s, after entering pickup range.
      model.weights[0][9] = 32;
      model.recurrent.weightsInput[2 * 96 * 96] = 1;
      model.recurrent.biasInput[96] = -32;
      model.weights[1][0] = 1;
      model.weights[2][5 * 64] = 32;
      model.biases[2][5] = -2.1;
    }
    model.trainedSteps = 1;
    if (!isDuelModel(model)) throw new Error('QA fixture must be a valid compatible GRU');
    return JSON.stringify(model);
  }, { x, z, fire, cover, delayedCover, seed });
  if (!await page.getByTestId('brain-dialog').isVisible()) await page.getByRole('button', { name: 'GRU modelini incele', exact: true }).click();
  await page.locator('.model-file-actions input[type="file"]').setInputFiles({ name: `control-fixture-${seed}.json`, mimeType: 'application/json', buffer: Buffer.from(fixture) });
  await page.waitForFunction(seed => new Promise(resolve => {
    const request = indexedDB.open('noema-local-v1', 1);
    request.onerror = () => resolve(false);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction('records').objectStore('records').get('noema-duel-gru96-v1');
      read.onsuccess = () => { db.close(); resolve(read.result?.model?.seed === seed); };
      read.onerror = () => { db.close(); resolve(false); };
    };
  }), seed);
  await page.getByTestId('brain-dialog').locator('.help-close').click();
  assert.equal((await state()).phase, 'ready');
  assert.equal(await monitor.isVisible(), false, 'import returns to manual teaching mode');
  await page.getByTestId('watch-robot').click();
  await page.locator('.arena-fullscreen').waitFor({ state: 'visible' });
  await page.waitForTimeout(300);
  assert.equal((await state()).phase, 'running');
  await monitor.waitFor({ state: 'visible' });
}

async function assertCommand(label, expectedX, expectedZ) {
  const [snapshot, observed] = await Promise.all([state(), control()]);
  assert.equal(observed.hasDecision, true, `${label}: a real inference was applied`);
  for (const [axis, expected] of [['x', expectedX], ['z', expectedZ]]) {
    assert.ok(Math.abs(observed.command.move[axis] - expected) < .00001, `${label}: actual ${axis} command equals the model output`);
    assert.ok(Math.abs(Number(await knob.getAttribute(`data-${axis}`)) - expected) < .00006, `${label}: dial reports the exact applied ${axis} command`);
    const robot = snapshot.robots[0];
    assert.ok(Math.abs((robot.decision.target[axis] - robot[axis]) - expected) < .00001, `${label}: engine received the displayed ${axis} command`);
  }
  assert.equal(await fire.getAttribute('data-requested'), String(observed.command.fire), `${label}: fire request reflects the command`);
  assert.equal(await cover.getAttribute('data-requested'), String(observed.command.interact), `${label}: cover request reflects the command`);
  report.commands.push({ label, control: observed, robot: snapshot.robots[0], moveLabel: await page.getByTestId('robot-move-label').textContent() });
}

function overlap(first, second) {
  return Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x) > .5
    && Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y) > .5;
}

async function manualReadyRowFits(label) {
  const panel = page.locator('.arena-panel');
  await panel.locator('.arena-controls').evaluate(element => element.scrollIntoView({ block: 'center' }));
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth + 1 }));
  assert.equal(viewport.overflow, false, `${label}: no horizontal overflow`);
  const panelBox = await panel.boundingBox();
  const controls = [['start duel', panel.getByTestId('start-match')], ['reset', panel.getByTestId('reset-match')], ['robot playback', panel.getByTestId('watch-robot')]];
  for (const [name, locator] of [['speed', panel.locator('.simulation-controls select')], ['sound', panel.locator('.simulation-controls > button')]]) if (await locator.isVisible()) controls.push([name, locator]);
  const boxes = {};
  for (const [name, locator] of controls) {
    const box = await locator.boundingBox();
    assert.ok(box && box.x >= panelBox.x - 1 && box.x + box.width <= panelBox.x + panelBox.width + 1 && box.y >= -1 && box.y + box.height <= viewport.height + 1, `${label}: ${name} fits inside the visible arena panel ${JSON.stringify(box)}`);
    assert.equal(await locator.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    }), true, `${label}: ${name} is not covered by navigation or another control`);
    for (const [otherName, otherBox] of Object.entries(boxes)) assert.equal(overlap(box, otherBox), false, `${label}: ${name} and ${otherName} do not overlap`);
    boxes[name] = box;
  }
  report.measurements.push({ label, viewport, boxes });
  check(`${label}: the full start label, robot playback and visible sound/speed controls fit before a duel starts`);
}

async function fits(label, fullscreen = true) {
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth + 1 }));
  assert.equal(viewport.overflow, false, `${label}: no horizontal overflow`);
  if (!fullscreen) await monitor.scrollIntoViewIfNeeded();
  const parts = [['movement', knob], ['fire intent', fire], ['cover intent', cover], ['movement label', page.getByTestId('robot-move-label')]];
  const boxes = {};
  for (const [name, locator] of parts) {
    assert.equal(await locator.isVisible(), true, `${label}: ${name} remains visible`);
    const box = await locator.boundingBox();
    assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `${label}: ${name} fits ${JSON.stringify(box)}`);
    boxes[name] = box;
  }
  assert.equal(await monitor.locator('button, input, select, a, [tabindex="0"]').count(), 0, `${label}: live monitor contains no interactive controls`);
  assert.equal(await monitor.evaluate(element => getComputedStyle(element).pointerEvents), 'none', `${label}: monitor lets touches through`);
  assert.equal(await page.getByTestId('movement-joystick').isVisible(), false, `${label}: spectator dial is not the manual joystick`);
  if (fullscreen) {
    const panel = page.locator('.arena-fullscreen');
    const controls = [
      ['pause', panel.getByTestId('pause-match')], ['reset', panel.getByTestId('reset-match')],
      ['take over', panel.getByTestId('watch-robot')], ['training', panel.getByTestId('training-toggle')],
      ['camera', panel.getByTestId('camera-toggle')], ['weather', panel.getByTestId('weather-toggle')],
      ['model', panel.getByRole('button', { name: 'GRU modelini incele', exact: true })],
      ['exit', panel.locator('.expand-button')],
    ];
    for (const [name, locator] of [['speed', panel.locator('.simulation-controls select')], ['sound', panel.locator('.simulation-controls > button')]]) if (await locator.isVisible()) controls.push([name, locator]);
    for (const [name, locator] of controls) {
      const box = await locator.boundingBox();
      assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `${label}: ${name} stays in view`);
      assert.equal(await locator.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      }), true, `${label}: ${name} receives touches`);
      for (const [part, partBox] of Object.entries(boxes)) assert.equal(overlap(partBox, box), false, `${label}: ${part} does not overlap ${name}`);
      boxes[name] = box;
    }
    for (const locator of [knob, fire, cover]) assert.equal(await locator.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      const arena = document.querySelector('.arena-fullscreen .duel-canvas')?.getBoundingClientRect();
      // Portrait/desktop give the readout its own row; only the landscape overlay
      // needs to pass through to the rendered field underneath it.
      if (!arena || x < arena.x || x > arena.right || y < arena.y || y > arena.bottom) return true;
      return Boolean(document.elementFromPoint(x, y)?.closest('.duel-canvas'));
    }), true, `${label}: arena remains touchable below any overlaid live readout`);
  }
  report.measurements.push({ label, viewport, boxes });
  check(`${label}: read-only robot dial and action indicators fit and leave the arena controls accessible`);
}

try {
  stage = 'ready';
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="duel-app"][data-learning-ready="true"]').waitFor();
  await page.getByTestId('duel-canvas').locator('canvas').waitFor({ state: 'visible' });
  await page.waitForFunction(() => typeof window.__DUEL__?.control === 'function');
  await page.evaluate(() => { window.__DUEL__.pausePresentation(true); window.__DUEL__.pauseSimulation(true); });
  assert.equal(await monitor.isVisible(), false, 'manual mode keeps its actual joystick and no duplicate spectator readout');
  check('Manual mode retains the interactive joystick; live robot readout appears only during robot playback');
  await manualReadyRowFits('manual ready 390 x 844');
  await page.setViewportSize({ width: 320, height: 568 });
  await manualReadyRowFits('manual ready 320 x 568');
  await page.setViewportSize({ width: 390, height: 844 });

  stage = 'continuous diagonal command';
  await importFixture({ x: .64, z: -.33 });
  const before = await state();
  await advance(.1);
  await assertCommand('non-cardinal analog movement', .64, -.33);
  const moving = await state();
  assert.ok(moving.robots[0].x > before.robots[0].x && moving.robots[0].z < before.robots[0].z, 'robot actually follows the analog direction');
  assert.ok(Math.abs(moving.robots[0].vx - 4.8 * .64) < .001 && Math.abs(moving.robots[0].vz + 4.8 * .33) < .001, 'actual unobstructed velocity matches analog strength');
  check('Dial shows the real continuous X/Z model command and its strength, including directions between the cardinal/diagonal labels');
  await fits('fullscreen portrait 390 x 844');
  await screenshot('model-controls-portrait.png');
  for (const [width, height] of [[844, 390], [604, 268], [568, 320], [320, 568], [1440, 1000]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(250);
    await fits(`fullscreen ${width} x ${height}`);
    if (width === 844) await screenshot('model-controls-landscape.png');
  }
  await page.locator('.arena-fullscreen .expand-button').click();
  await page.locator('.arena-fullscreen').waitFor({ state: 'detached' });
  await fits('normal desktop 1440 x 1000', false);
  await page.setViewportSize({ width: 390, height: 844 });
  await fits('normal portrait 390 x 844', false);
  await page.setViewportSize({ width: 320, height: 568 });
  await fits('normal portrait 320 x 568', false);
  await page.setViewportSize({ width: 390, height: 844 });

  stage = 'pause preserves command';
  await page.getByTestId('pause-match').click();
  const paused = await state();
  const pausedControl = await control();
  const pausedKnob = await knob.evaluate(element => [element.dataset.x, element.dataset.z]);
  await advance(1);
  assert.equal((await state()).time, paused.time);
  assert.deepEqual(await control(), pausedControl);
  assert.deepEqual(await knob.evaluate(element => [element.dataset.x, element.dataset.z]), pausedKnob);
  await page.waitForTimeout(350);
  assert.deepEqual(await control(), pausedControl, 'wall time does not alter a paused command');
  check('Paused playback freezes its last actual command without inventing movement or clearing the readout');

  stage = 'dead zone';
  await importFixture({ x: .05, z: -.1 });
  await advance(.1);
  await assertCommand('post-dead-zone idle', 0, 0);
  assert.equal((await state()).robots[0].vx, 0);
  assert.equal((await state()).robots[0].vz, 0);
  check('Movement below the model dead zone appears centered and produces no actual movement');

  stage = 'normalized diagonal';
  await importFixture({ x: .9, z: .9 });
  await advance(.1);
  await assertCommand('normalized diagonal', Math.SQRT1_2, Math.SQRT1_2);
  check('Oversized diagonal outputs are displayed after normalization to the applied unit movement circle');

  stage = 'blocked intent';
  await importFixture({ x: -.8 });
  await advance(1.2);
  await assertCommand('wall-blocked west intent', -.8, 0);
  const blocked = await state();
  assert.equal(blocked.robots[0].vx, 0, 'west boundary wall stops actual movement');
  assert.equal(await page.getByTestId('robot-blocked').isVisible(), true, 'blocked intent is explicitly distinguishable from idle');
  check('Wall collision preserves the attempted direction while marking the actual blocked movement');

  stage = 'fire command versus execution';
  await importFixture({ fire: true });
  await advance(.1);
  assert.equal(await fire.getAttribute('data-requested'), 'true');
  assert.equal(await fire.getAttribute('data-executed'), 'false');
  assert.equal((await state()).robots[0].shots, 0);
  assert.equal((await control()).shotAt, null);
  await advance(.52);
  const fired = await state();
  const firedControl = await control();
  assert.equal(fired.robots[0].shots, 1, 'real cooldown expiry allows exactly one actual stone');
  assert.ok(firedControl.shotAt >= .59 && firedControl.shotAt <= fired.time);
  assert.equal(await fire.getAttribute('data-executed'), 'true', 'actual shot lights the execution indicator');
  await page.getByTestId('pause-match').click();
  await page.waitForTimeout(350);
  assert.equal(await fire.getAttribute('data-executed'), 'true', 'execution flash uses simulated time and freezes while paused');
  await page.getByTestId('pause-match').click();
  await advance(.3);
  assert.equal((await state()).robots[0].shots, 1);
  assert.equal((await control()).shotAt, firedControl.shotAt);
  assert.equal(await fire.getAttribute('data-requested'), 'true');
  assert.equal(await fire.getAttribute('data-executed'), 'false', 'held request during cooldown is distinct from a newly executed shot');
  check('Fire separates the model request from real stone launch and cooldown; execution timing freezes with pause');

  stage = 'cover request edge';
  await importFixture({ x: .8, cover: true });
  await advance(.5);
  const heldCover = await state();
  assert.equal(await cover.getAttribute('data-requested'), 'true');
  assert.equal(await cover.getAttribute('data-executed'), 'false');
  assert.equal(heldCover.robots[0].carrying, null, 'holding interaction from out of range does not create repeated pickup presses');
  assert.equal((await control()).coverAt, null);
  const nearest = heldCover.crates.filter(crate => crate.owner === 0).reduce((distance, crate) => Math.min(distance, Math.hypot(crate.x - heldCover.robots[0].x, crate.z - heldCover.robots[0].z)), Infinity);
  assert.ok(nearest < 1.5, 'the robot has now moved into the actual cover pickup radius');
  check('Held cover request is visible without falsely claiming pickup; the engine still requires a new press edge');

  stage = 'real cover pickup';
  await importFixture({ x: .8, delayedCover: true });
  await advance(.2);
  assert.equal(await cover.getAttribute('data-requested'), 'false');
  assert.equal((await state()).robots[0].carrying, null);
  await advance(.3);
  const pickedUp = await state();
  assert.ok(pickedUp.robots[0].carrying, 'real timed GRU interaction picks up nearby cover');
  assert.equal(await cover.getAttribute('data-requested'), 'true');
  assert.equal(await cover.getAttribute('data-executed'), 'true');
  const pickupControl = await control();
  assert.ok(pickupControl.coverAt > .2 && pickupControl.coverAt <= pickedUp.time);
  await advance(.15);
  assert.equal((await state()).robots[0].carrying, pickedUp.robots[0].carrying, 'holding the same press does not immediately drop cover');
  assert.equal((await control()).coverAt, pickupControl.coverAt, 'no false second execution is emitted');
  check('Actual cover pickup updates the execution indicator once and a held command does not fabricate a drop');

  stage = 'finished playback';
  await importFixture();
  await advance(90);
  assert.equal((await state()).phase, 'finished', 'the actual scripted opponent completes the duel against the stationary fixture');
  const finishedControl = await control();
  assert.equal(await monitor.isVisible(), true, 'the last robot command remains available after the result');
  await advance(1);
  assert.deepEqual(await control(), finishedControl, 'no new command is invented after the duel finishes');
  check('Finished duel keeps the last actual robot command available for review');

  stage = 'takeover';
  await page.getByTestId('watch-robot').click();
  assert.equal(await monitor.isVisible(), false);
  assert.equal(await page.getByTestId('movement-zone').isVisible(), true);
  assert.equal(await page.getByTestId('movement-joystick').isVisible(), false, 'manual floating ring stays hidden until the player touches the movement area');
  check('Taking control immediately restores the manual movement area with an unobtrusive hidden floating joystick');
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.consoleErrors, []);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = { stage, message: error.message, stack: error.stack };
  try { report.failure.state = await state(); report.failure.control = await control(); await screenshot('model-controls-failure.png'); } catch {}
  console.error(error);
  process.exitCode = 1;
} finally {
  clearInterval(progress);
  report.completedAt = new Date().toISOString();
  await writeFile(new URL('model-controls.json', artifacts), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, report: fileURLToPath(new URL('model-controls.json', artifacts)) }));
}
