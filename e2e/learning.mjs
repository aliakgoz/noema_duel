import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

// Run against Vite: diagnostics import the actual source modules, without changing app state.
const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const PROFILE_KEY = 'profile-gru96-v3';
const artifacts = new URL('../artifacts/e2e/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const result = { baseURL, startedAt: new Date().toISOString(), styles: [], errors: [], events: [] };
const event = (name, data = {}) => { const entry = { name, at: new Date().toISOString(), ...data }; result.events.push(entry); console.log(JSON.stringify(entry)); };
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const readProfile = page => page.evaluate(profileKey => new Promise((resolve, reject) => {
  const open = indexedDB.open('noema-local-v1', 1);
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result; const request = db.transaction('records').objectStore('records').get(profileKey);
    request.onsuccess = () => { resolve(request.result); db.close(); };
    request.onerror = () => { reject(request.error); db.close(); };
  };
}), PROFILE_KEY);
const waitForSave = page => page.waitForFunction(() => document.querySelector('.training-status small')?.textContent?.includes('kaydedildi'));
async function waitForModelSave(page, revision, trained = true) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const profile = await readProfile(page);
    if (profile && profile.revision >= revision && (!trained || JSON.parse(profile.model).trainedSteps > 0)) return profile;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`IndexedDB did not commit model revision ${revision}`);
}

async function trainAndCommit(page, revision, style) {
  await page.getByRole('button', { name: /^Robotuna öğret/ }).click();
  const parked = process.env.PARK_TRAINING_SCENE === '1';
  event('training started', { style, revision, parked });
  // Default: remain in the actual workshop to verify its product-level render pause.
  // An opt-in fallback can exercise worker continuity across real UI page navigation.
  if (parked) await page.locator('.sidebar .nav-item').filter({ hasText: 'Arena' }).click();
  const heartbeat = await page.evaluate(() => new Promise(resolve => {
    let ticks = 0; const started = performance.now();
    const interval = setInterval(() => ticks++, 50);
    setTimeout(() => { clearInterval(interval); resolve({ ticks, elapsedMs: performance.now() - started }); }, 600);
  }));
  event('UI event-loop heartbeat during actual training', { style, ...heartbeat });
  assert.ok(heartbeat.ticks >= 6 && heartbeat.elapsedMs < 2500, 'The workshop event loop stays responsive during the actual training worker');
  const profile = await waitForModelSave(page, revision);
  event('training committed', { style, revision, parked, epochs: profile.metrics.epochs, trainingMs: profile.metrics.durationMs });
  if (parked) await page.locator('.sidebar .nav-item').filter({ hasText: 'Atölye' }).click();
  await page.waitForFunction(expected => document.querySelector('.version-tag')?.textContent === `v${expected}`, revision, { timeout: 30_000 });
  return profile;
}

async function teach(name, actions, firstAction) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const workerURLs = [];
  page.on('worker', worker => workerURLs.push(worker.url()));
  page.on('pageerror', error => result.errors.push(error.message));
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.locator('.scene-host canvas').waitFor({ state: 'visible' });
  await waitForSave(page);
  const original = await waitForModelSave(page, 0, false);
  event('teaching real actions', { style: name });
  for (const action of actions) await page.keyboard.press(action);
  await page.locator('.solved-banner').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.learning-count strong').textContent(), '10');
  let profile = await trainAndCommit(page, 1, name);
  await waitForSave(page);
  assert.notEqual(profile.model, original.model, 'real parameter updates must occur');
  assert.notDeepEqual(JSON.parse(profile.model).recurrent, JSON.parse(original.model).recurrent, 'actual GRU gate and recurrent tensors receive training updates');
  assert.equal(profile.samples.length, 10);
  assert.ok(profile.metrics.samples > 10, 'actual state/action augmentation must be included in training');
  assert.ok(profile.samples.every(sample => sample.observationState && Array.isArray(sample.history)), 'human demonstrations keep physical state and preceding history');
  assert.ok(profile.samples.every(sample => typeof sample.episodeId === 'string' && sample.episodeId.length > 0), 'actual human decisions carry an explicit recurrent episode ID');
  assert.equal(new Set(profile.samples.map(sample => sample.episodeId)).size, 1, 'one uninterrupted human demonstration remains one sequence');
  assert.deepEqual(profile.samples.map(sample => sample.sequenceStart), [true, ...Array(9).fill(false)], 'only the genuine first human decision resets recurrent training memory');
  assert.equal(JSON.parse(profile.model).version, 'noema-160-96-gru96-64-6-v3');
  assert.deepEqual(JSON.parse(profile.model).architecture, [160, 96, 96, 64, 6]);
  assert.ok(JSON.parse(profile.model).trainedSteps >= profile.metrics.samples * profile.metrics.epochs);
  assert.ok(workerURLs.some(url => url.includes('training.worker')), 'actual browser worker must train');

  let attempts = 0; let solved = false;
  while (attempts < 2 && !solved) {
    attempts++;
    await page.getByRole('button', { name: 'Robotu baştan izlet', exact: true }).click();
    try { await page.locator('.solved-banner').waitFor({ state: 'visible', timeout: 60_000 }); solved = true; }
    catch {
      const stop = page.getByRole('button', { name: 'Robotu durdur', exact: true });
      if (await stop.count()) await stop.click();
      if (attempts === 1) {
        profile = await trainAndCommit(page, 2, name);
        await waitForSave(page);
      }
    }
  }
  assert.ok(solved, `${name}: genuine trained policy must reproduce its simple demonstration`);
  event('learned rollout solved', { style: name, attempts });
  assert.equal(await page.locator('.learning-count strong').textContent(), '10', 'robot moves cannot become human examples');

  const diagnostics = await page.evaluate(async ({ model, expected }) => {
    const [{ TinyNetwork }, { createState, step }, { LEVELS, generateChallenge }, { encodeObservation }] = await Promise.all([
      import('/src/ml/network.ts'), import('/src/core/engine.ts'), import('/src/core/levels.ts'), import('/src/core/observation.ts'),
    ]);
    const network = TinyNetwork.deserialize(model);
    const initialInput = encodeObservation(createState(LEVELS[0]));
    const memoryBeforePreview = Array.from(network.getMemory());
    const initial = network.preview(initialInput);
    const previewPreservesMemory = JSON.stringify(Array.from(network.getMemory())) === JSON.stringify(memoryBeforePreview);
    network.predict(initialInput);
    const realDecisionChangesMemory = network.getMemory().some((value, index) => value !== memoryBeforePreview[index]);
    const heldOut = [19, 73, 128].map(seed => {
      const level = generateChallenge(seed); let state = createState(level); const history = [];
      network.resetMemory();
      for (let i = 0; i < 180 && !state.solved; i++) {
        const action = network.predict(encodeObservation(state, history)).action;
        state = step(state, action); history.push(action);
      }
      return { seed, sourceRoom: level.subtitle, solved: state.solved, ticks: state.tick, moves: state.moves };
    });
    const nearbyStarts = [{ x: 2, z: 5 }, { x: 2, z: 4 }, { x: 1, z: 4 }, { x: 1, z: 3 }].map(start => {
      const level = { ...LEVELS[0], start }; let state = createState(level); const history = [];
      network.resetMemory();
      for (let i = 0; i < 40 && !state.solved; i++) {
        const action = network.predict(encodeObservation(state, history)).action;
        state = step(state, action); history.push(action);
        if (history.length > 2) history.shift();
      }
      return { start, solved: state.solved, decisions: state.tick };
    });
    return { initialAction: initial.action, expectedInitialAction: expected, probabilities: initial.probabilities, parameterCount: network.parameterCount, previewPreservesMemory, realDecisionChangesMemory, nearbyStarts, heldOut };
  }, { model: profile.model, expected: firstAction });
  assert.equal(diagnostics.parameterCount, 77926, 'the trained browser policy is the full 77,926-parameter GRU architecture');
  assert.ok(diagnostics.previewPreservesMemory, 'inspecting the model cannot advance its recurrent memory');
  assert.ok(diagnostics.realDecisionChangesMemory, 'a real policy decision advances the trained GRU memory');
  assert.equal(diagnostics.initialAction, firstAction, 'different demonstration styles affect actual policy');
  // Generalization is measured honestly; fitting one demonstrated route does not guarantee new starts.
  event('untrained nearby-start transfer measured', { style: name, solved: diagnostics.nearbyStarts.filter(value => value.solved).length, total: diagnostics.nearbyStarts.length });
  if (process.env.NO_SCREENSHOTS !== '1') await page.screenshot({ path: new URL(`learning-gru-${name}.png`, artifacts).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
  const savedHash = createHash('sha256').update(profile.model).digest('hex');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Number(document.querySelector('.version-tag')?.textContent?.replace('v', '')) > 0);
  await waitForSave(page);
  const restored = await readProfile(page);
  assert.equal(createHash('sha256').update(restored.model).digest('hex'), savedHash, 'weights persist exactly');
  assert.equal(restored.samples.length, 10);
  assert.equal(restored.completed['room-01'], 10);
  await page.locator('.sidebar .nav-item').filter({ hasText: 'Keşifler' }).click();
  await page.locator('.level-card').filter({ hasText: 'İki Yol' }).click();
  await page.waitForTimeout(400); await waitForSave(page);
  const nextRoomProfile = await readProfile(page);
  assert.equal(createHash('sha256').update(nextRoomProfile.model).digest('hex'), savedHash, 'changing rooms preserves every trained parameter');
  assert.equal(nextRoomProfile.samples.length, 10, 'earlier room examples remain available for replay');
  await page.locator('.sidebar .nav-item').filter({ hasText: 'Keşifler' }).click();
  await page.locator('.level-card').filter({ hasText: 'İlk Adımlar' }).click();
  await page.getByRole('button', { name: 'Robotu izle', exact: true }).click();
  await page.locator('.solved-banner').waitFor({ state: 'visible', timeout: 60_000 });
  result.styles.push({ name, originalSamples: profile.samples.length, augmentedSamples: profile.metrics.samples, epochs: profile.metrics.epochs, accuracy: profile.metrics.accuracy, loss: profile.metrics.loss, trainingMs: profile.metrics.durationMs, trainingAttempts: attempts, modelHash: savedHash, workerURLs, ...diagnostics, persistence: 'exact weights and examples across reload and room change; learned rollout succeeds after return' });
  event('style validated', { style: name, nearbySolved: diagnostics.nearbyStarts.filter(value => value.solved).length });
  await context.close();
}

try {
  await teach('right-first', [...Array(6).fill('ArrowRight'), ...Array(4).fill('ArrowUp')], 1);
  await teach('up-first', [...Array(4).fill('ArrowUp'), ...Array(6).fill('ArrowRight')], 0);
  assert.notEqual(result.styles[0].modelHash, result.styles[1].modelHash);
  assert.deepEqual(result.errors, []);
  result.passed = true;
} catch (error) {
  result.passed = false; result.failure = error.stack ?? String(error); process.exitCode = 1;
  const pages = browser.contexts().flatMap(context => context.pages());
  for (let index = 0; index < pages.length; index++) {
    try { await pages[index].screenshot({ path: new URL(`learning-gru-failure-${index}.png`, artifacts).pathname.replace(/^\/(\w:)/, '$1'), timeout: 5000 }); } catch { /* Preserve the original failure. */ }
  }
} finally {
  result.finishedAt = new Date().toISOString();
  await writeFile(new URL('learning-gru.json', artifacts), JSON.stringify(result, null, 2));
  await browser.close(); console.log(JSON.stringify(result, null, 2));
}
