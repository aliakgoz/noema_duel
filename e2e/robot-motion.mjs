import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const destination = new URL('../artifacts/e2e/', import.meta.url);
await mkdir(destination, { recursive: true });
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], errors: [] };
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
let activePage;

try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  activePage = page;
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.locator('.scene-host canvas').waitFor();
  await page.waitForFunction(() => document.querySelector('.training-status small')?.textContent?.includes('kaydedildi'));
  // Observe the actual App instance; no production-only debug hook is needed.
  const fixture = await page.evaluate(async () => {
    const moduleURL = path => performance.getEntriesByType('resource').map(entry => entry.name).filter(url => new URL(url).pathname === path).at(-1) ?? path;
    const { GameScene } = await import(moduleURL('/src/render/GameScene.ts'));
    const { TinyNetwork } = await import(moduleURL('/src/ml/network.ts'));
    const probe = window.__motion = { phase: 'idle', trials: [], decisions: [], frames: [], scene: null, network: null };
    const begin = GameScene.prototype.beginTrial;
    GameScene.prototype.beginTrial = function (state) {
      probe.scene = this;
      const trial = { at: performance.now(), phase: probe.phase, tick: state.tick, start: { ...state.robot } };
      probe.trials.push(trial);
      const result = begin.call(this, state);
      trial.readyImmediately = this.isReadyForAction();
      trial.distanceImmediately = this.robot.root.position.distanceTo(this.targetRobot);
      if (!this.renderer.__motionObserved) {
        this.renderer.__motionObserved = true;
        const render = this.renderer.render.bind(this.renderer);
        this.renderer.render = (...args) => {
          const result = render(...args);
          if (probe.phase !== 'idle') probe.frames.push({ at: performance.now(), phase: probe.phase, tick: this.state.tick, x: this.robot.root.position.x, z: this.robot.root.position.z, targetX: this.targetRobot.x, targetZ: this.targetRobot.z });
          return result;
        };
      }
      return result;
    };
    const predict = TinyNetwork.prototype.predict;
    TinyNetwork.prototype.predict = function (input) {
      const scene = probe.scene;
      probe.network = this;
      if (probe.phase !== 'idle') probe.decisions.push({ at: performance.now(), phase: probe.phase, tick: scene.state.tick, state: structuredClone(scene.state), input: Array.from(input), memoryBefore: Array.from(this.getMemory()), ready: scene.isReadyForAction(), distance: scene.robot.root.position.distanceTo(scene.targetRobot) });
      return predict.call(this, input);
    };
    const model = new TinyNetwork(42).snapshot();
    // Keep real nonzero GRU dynamics while making the output choose right reliably.
    model.weights[2].fill(0); model.biases[2].fill(0);
    model.biases[2][1] = 8;
    return JSON.stringify(model);
  });
  await page.locator('.sidebar-settings').click();
  await page.locator('input[type="file"]').setInputFiles({ name: 'motion-test-model.json', mimeType: 'application/json', buffer: Buffer.from(fixture) });
  await page.getByRole('button', { name: 'Kapat', exact: true }).click();
  await page.evaluate(() => { window.__motion.phase = 'human'; });
  await page.getByRole('button', { name: 'Bulmacayı sıfırla', exact: true }).click();
  await page.waitForFunction(() => window.__motion.scene?.isReadyForAction());
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => window.__motion.scene?.isReadyForAction() && window.__motion.scene.state.tick === 1);
  const human = await page.evaluate(async () => {
    const { encodeObservation } = await import('/src/core/observation.ts');
    const probe = window.__motion;
    return { frames: probe.frames.filter(item => item.phase === 'human'), state: structuredClone(probe.scene.state), memory: Array.from(probe.network.getMemory()), nextInput: Array.from(encodeObservation(probe.scene.state, [1])) };
  });
  assert.ok(human.frames.some(item => item.tick === 1 && Math.abs(item.x - item.targetX) > 0.05 && Math.abs(item.x - item.targetX) < 0.95), 'human movement must have visible intermediate poses');
  assert.ok(human.memory.some(value => Math.abs(value) > 0.001), 'fixture must exercise genuine nonzero GRU memory');
  report.checks.push('actual human key input uses visible intermediate walking poses');

  const handedOverAt = await page.evaluate(() => { window.__motion.phase = 'robot'; return performance.now(); });
  await page.getByRole('button', { name: 'Robotu izle', exact: true }).click();
  await page.waitForFunction(() => window.__motion.decisions.filter(item => item.phase === 'robot').length >= 2, null, { timeout: 30_000 });
  const beforePause = await page.evaluate(() => {
    window.__motion.scene.setTrainingPaused(true);
    return window.__motion.decisions.filter(item => item.phase === 'robot').length;
  });
  await page.waitForTimeout(1000);
  const afterPause = await page.evaluate(() => window.__motion.decisions.filter(item => item.phase === 'robot').length);
  assert.equal(afterPause, beforePause, 'robot must not advance while its actual renderer is paused');
  await page.evaluate(() => { window.__motion.scene.setTrainingPaused(false); });
  await page.waitForFunction(() => window.__motion.decisions.filter(item => item.phase === 'robot').length >= 5, null, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Robotu durdur', exact: true }).click();
  const observed = await page.evaluate(() => ({ trials: window.__motion.trials.filter(item => item.phase === 'robot'), decisions: window.__motion.decisions.filter(item => item.phase === 'robot'), frames: window.__motion.frames.filter(item => item.phase === 'robot') }));
  assert.deepEqual(observed.trials, [], 'watching from the current square must never reset or begin another trial');
  assert.deepEqual(observed.decisions[0].state, human.state, 'first model decision must use the exact human state, including position, crates, doors and counters');
  assert.deepEqual(observed.decisions[0].memoryBefore, human.memory, 'handover must preserve all GRU memory cells');
  assert.deepEqual(observed.decisions[0].input, human.nextInput, 'handover must preserve observation action history');
  assert.ok(observed.frames.every(item => item.tick >= human.state.tick), 'continuing never draws a teleported or reset starting state');
  assert.ok(observed.decisions[0].at - handedOverAt >= 400, 'first action must leave time to view the current pose');
  for (let i = 0; i < observed.decisions.length; i++) {
    const decision = observed.decisions[i];
    assert.equal(decision.ready, true, 'every AI action must wait for the actual scene');
    assert.ok(decision.distance < 0.025, 'previous movement must settle before another model prediction');
    if (i) assert.ok(decision.at - observed.decisions[i - 1].at >= 419, 'AI must not batch catch-up steps');
  }
  assert.ok(observed.frames.some(item => item.tick === 2 && Math.abs(item.x - item.targetX) > 0.05 && Math.abs(item.x - item.targetX) < 0.95), 'robot movement must also have visible intermediate poses');
  report.startDelayMs = observed.decisions[0].at - handedOverAt;
  report.actionIntervalsMs = observed.decisions.slice(1).map((decision, i) => decision.at - observed.decisions[i].at);
  report.maxPreActionDistance = Math.max(...observed.decisions.map(item => item.distance));
  report.checks.push('Robotu izle continues the exact human position, world state, action history and nonzero GRU memory without resetting');
  report.checks.push('all actual App model predictions wait for the previous rendered walk to settle');
  report.checks.push('robot pauses with the renderer, resumes without catch-up, and uses the same walking interpolation as human input');

  await page.getByRole('button', { name: 'Hamleleri incele', exact: true }).click();
  await page.getByRole('slider', { name: 'Tekrar hamlesi', exact: true }).focus();
  await page.keyboard.press('Home');
  await page.waitForFunction(() => window.__motion.scene.state.tick === 1 && window.__motion.scene.isReadyForAction());
  await page.evaluate(() => { window.__motion.phase = 'replay'; });
  await page.getByRole('button', { name: 'Robotu izle', exact: true }).click();
  await page.waitForFunction(() => window.__motion.decisions.some(item => item.phase === 'replay'), null, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Robotu durdur', exact: true }).click();
  const replay = await page.evaluate(() => ({ decision: window.__motion.decisions.find(item => item.phase === 'replay'), trials: window.__motion.trials.filter(item => item.phase === 'replay') }));
  assert.deepEqual(replay.trials, []);
  assert.deepEqual(replay.decision.state, human.state, 'watching replay resumes its selected visible state');
  assert.deepEqual(replay.decision.memoryBefore, human.memory, 'selected replay restores its own GRU memory instead of retaining a later decision');
  assert.deepEqual(replay.decision.input, human.nextInput);
  report.checks.push('watching a selected replay frame restores its exact visible state, history and recurrent memory');

  await page.evaluate(() => { window.__motion.phase = 'restart'; });
  await page.getByRole('button', { name: 'Robotu baştan izlet', exact: true }).click();
  await page.waitForFunction(() => window.__motion.decisions.some(item => item.phase === 'restart'), null, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Robotu durdur', exact: true }).click();
  const restart = await page.evaluate(() => ({ trial: window.__motion.trials.find(item => item.phase === 'restart'), decision: window.__motion.decisions.find(item => item.phase === 'restart'), frames: window.__motion.frames.filter(item => item.phase === 'restart') }));
  assert.equal(restart.trial.readyImmediately, false);
  assert.ok(restart.trial.distanceImmediately < 0.001);
  assert.ok(restart.frames.some(item => item.tick === 0), 'explicit restart must genuinely draw its initial pose');
  assert.equal(restart.decision.state.tick, 0);
  assert.deepEqual(restart.decision.state.robot, { ...human.state.level.start, facing: human.state.level.facing, carrying: null });
  assert.deepEqual(restart.decision.state.level, human.state.level, 'explicit restart preserves the currently visible level instead of generating another map');
  assert.ok(restart.decision.memoryBefore.every(value => value === 0), 'explicit restart clears only episodic GRU memory');
  assert.ok(restart.decision.at - restart.trial.at >= 400);
  report.checks.push('explicit Robotu baştan izlet restarts the same visible level, clears episodic memory and presents its initial frame before acting');

  await page.evaluate(() => { window.__motion.phase = 'solve-human'; });
  await page.getByRole('button', { name: 'Bulmacayı sıfırla', exact: true }).click();
  for (const key of [...Array(6).fill('ArrowRight'), ...Array(4).fill('ArrowUp')]) await page.keyboard.press(key);
  await page.locator('.solved-banner').waitFor({ state: 'visible' });
  await page.evaluate(() => { window.__motion.phase = 'solved-watch'; });
  await page.getByRole('button', { name: 'Robotu izle', exact: true }).click();
  await page.waitForFunction(() => window.__motion.decisions.some(item => item.phase === 'solved-watch'), null, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Robotu durdur', exact: true }).click();
  const solvedWatch = await page.evaluate(() => ({ trial: window.__motion.trials.find(item => item.phase === 'solved-watch'), decision: window.__motion.decisions.find(item => item.phase === 'solved-watch') }));
  assert.ok(solvedWatch.trial, 'watching a completed demonstration must start a fresh episode');
  assert.equal(solvedWatch.decision.state.tick, 0);
  assert.deepEqual(solvedWatch.decision.state.level, human.state.level, 'completed demonstration replays the exact same visible room');
  assert.ok(solvedWatch.decision.memoryBefore.every(value => value === 0));
  report.checks.push('watching a completed human demonstration restarts the same room and resets only its episodic memory');
  assert.deepEqual(report.errors, []);
  report.passed = true;
  await context.close();
} catch (error) {
  report.passed = false; report.failure = error.stack ?? String(error); process.exitCode = 1;
  if (activePage) report.probe = await activePage.evaluate(() => {
    const probe = window.__motion;
    if (!probe) return null;
    const scene = probe.scene;
    return { trials: probe.trials, decisions: probe.decisions, frames: probe.frames.slice(-3), scene: scene ? { ready: scene.isReadyForAction(), disposed: scene.disposed, visible: scene.visible, trainingPaused: scene.trainingPaused, hasPresentedFrame: scene.hasPresentedFrame, tick: scene.state.tick, distance: scene.robot.root.position.distanceTo(scene.targetRobot), yaw: scene.robot.root.rotation.y, facing: scene.state.robot.facing } : null };
  }).catch(() => null);
} finally {
  report.finishedAt = new Date().toISOString();
  await browser.close();
  await writeFile(new URL('robot-motion.json', destination), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
