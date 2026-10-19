import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const destination = new URL('../artifacts/e2e/', import.meta.url);
await mkdir(destination, { recursive: true });
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], errors: [], layouts: [], ignoredHotUpdates: [], workers: [] };
let phase = 'boot';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function boot(mobile = false) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1100 },
    isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, serviceWorkers: 'block',
  });
  await context.addInitScript(() => {
    HTMLElement.prototype.requestFullscreen = () => Promise.reject(new Error('Test fixture: CSS fullscreen fallback'));
  });
  await context.routeWebSocket('**/*', socket => {
    const server = socket.connectToServer();
    server.onMessage(message => {
      let data;
      try { data = JSON.parse(String(message)); } catch { /* Forward non-JSON traffic. */ }
      if (data?.type === 'update' || data?.type === 'full-reload') {
        report.ignoredHotUpdates.push({ phase, type: data.type }); return;
      }
      socket.send(message);
    });
  });
  const page = await context.newPage();
  page.on('worker', worker => report.workers.push(worker.url()));
  page.on('pageerror', error => report.errors.push({ phase, message: error.message, stack: error.stack }));
  page.on('console', message => { if (message.type() === 'error') report.errors.push({ phase, message: message.text() }); });
  await page.route('**/src/render/GameScene.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      const noemaNavigationResize = GameScene.prototype.resize;
      const noemaNavigationTrial = GameScene.prototype.beginTrial;
      GameScene.prototype.resize = function (...args) {
        const result = noemaNavigationResize.apply(this, args);
        window.__navigationScene = this;
        if (!this.renderer.__navigationObserved) {
          this.renderer.__navigationObserved = true;
          const render = this.renderer.render.bind(this.renderer);
          this.renderer.render = (...renderArgs) => {
            const result = render(...renderArgs);
            this.__navigationFrames = (this.__navigationFrames ?? 0) + 1;
            return result;
          };
        }
        return result;
      };
      GameScene.prototype.beginTrial = function (state) {
        window.__navigationTrials = (window.__navigationTrials ?? 0) + 1;
        return noemaNavigationTrial.call(this, state);
      };
    ` });
  });
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.locator('.scene-host canvas').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByRole('combobox', { name: 'Bölüm seç', exact: true }).waitFor();
  await saved(page);
  await page.evaluate(() => { window.__navigationCanvas = document.querySelector('.scene-host canvas'); });
  assert.equal(await page.locator('.scene-error').count(), 0);
  return { context, page };
}

const saved = page => page.waitForFunction(() => document.querySelector('.training-status small')?.textContent?.includes('kaydedildi'));
const sampleCount = async page => Number(await page.locator('.learning-count strong').textContent());
const state = page => page.evaluate(() => structuredClone(window.__navigationScene.state));

async function profile(page) {
  await saved(page);
  return page.evaluate(async () => {
    const { readRecord } = await import('/src/lib/storage.ts');
    const value = await readRecord('profile-gru96-v3');
    const model = JSON.parse(value.model);
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value.model)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const parameters = [...model.weights, ...model.biases, ...Object.values(model.recurrent)].reduce((sum, tensor) => sum + tensor.length, 0);
    return { hash, parameters, trainedSteps: model.trainedSteps, samples: value.samples.length, completed: Object.keys(value.completed).length };
  });
}

async function choose(page, value, roomId) {
  await page.getByRole('combobox', { name: 'Bölüm seç', exact: true }).selectOption(value);
  await page.waitForFunction(id => window.__navigationScene?.state.level.id === id, roomId);
  assert.equal(await page.evaluate(() => window.__navigationCanvas === document.querySelector('.scene-host canvas')), true);
}

async function visible(page) {
  await page.waitForFunction(() => {
    const scene = window.__navigationScene;
    if (!scene?.hasPresentedFrame || scene.renderer.info.render.triangles < 1000) return false;
    const point = scene.robot.root.position.clone().project(scene.camera);
    return Number.isFinite(point.x) && Math.abs(point.x) < 1 && Math.abs(point.y) < 1 && Math.abs(point.z) < 1;
  }, null, { timeout: 20_000 });
}

async function layout(page, name, fullscreen = true) {
  await visible(page);
  const result = await page.evaluate(() => {
    const card = document.querySelector('.world-card');
    const arena = card.querySelector('.world-viewport').getBoundingClientRect();
    const labels = ['Bölüm seç', 'Önceki bölüm', 'Sonraki bölüm', 'Benzer bölüm', 'Baştan izle'];
    const elements = labels.map(label => [...card.querySelectorAll('button,select')].find(element => element.getAttribute('aria-label') === label || element.textContent.trim() === label));
    const interaction = card.querySelector('.interact-key');
    const targets = [...elements, interaction];
    return {
      width: innerWidth, height: innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      arena: { x: arena.x, y: arena.y, width: arena.width, height: arena.height, bottom: arena.bottom },
      targets: targets.map((element, index) => {
        if (!element) return { label: labels[index] ?? 'Etkileşim', missing: true };
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return { label: labels[index] ?? 'Etkileşim', x: box.x, y: box.y, width: box.width, height: box.height, exposed: hit === element || element.contains(hit) };
      }),
      triangles: window.__navigationScene.renderer.info.render.triangles,
    };
  });
  assert.ok(result.documentWidth <= result.width + 1, `${name}: no horizontal overflow`);
  for (const target of result.targets) {
    assert.ok(!target.missing, `${name}/${target.label}: control exists`);
    assert.ok(target.width >= 43.5 && target.height >= 43.5, `${name}/${target.label}: control is at least 44px`);
    if (target.label !== 'Etkileşim') assert.ok(target.y >= result.arena.bottom - 1, `${name}/${target.label}: toolbar belongs below the actual arena`);
    if (fullscreen) {
      assert.ok(target.x >= -1 && target.y >= -1 && target.x + target.width <= result.width + 1 && target.y + target.height <= result.height + 1, `${name}/${target.label}: entirely visible`);
      assert.equal(target.exposed, true, `${name}/${target.label}: not covered by another UI element`);
    }
  }
  if (fullscreen) assert.ok(result.arena.width > 180 && result.arena.height > 100, `${name}: actual rendered arena retains readable space`);
  report.layouts.push({ name, ...result });
  if (process.env.NO_SCREENSHOTS !== '1') await page.screenshot({ path: fileURLToPath(new URL(`workshop-${name}.png`, destination)) });
}

async function enterFullscreen(page) {
  await page.getByRole('button', { name: 'Görünümü büyüt', exact: true }).click();
  await page.getByRole('dialog', { name: 'Tam ekran oyun alanı', exact: true }).waitFor({ state: 'visible' });
  await visible(page);
}

async function exposed(page, locator, name) {
  const box = await locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { width: rect.width, height: rect.height, x: rect.x, y: rect.y, viewportWidth: innerWidth, viewportHeight: innerHeight, exposed: hit === element || element.contains(hit) };
  });
  assert.ok(box.width >= 43.5 && box.height >= 43.5, `${name}: at least 44px touch target`);
  assert.ok(box.x >= -1 && box.y >= -1 && box.x + box.width <= box.viewportWidth + 1 && box.y + box.height <= box.viewportHeight + 1, `${name}: entirely visible`);
  assert.equal(box.exposed, true, `${name}: no overlay covers the button`);
  return box;
}

try {
  phase = 'desktop navigation';
  const desktop = await boot();
  const select = desktop.page.getByRole('combobox', { name: 'Bölüm seç', exact: true });
  const options = await select.locator('option').evaluateAll(elements => elements.map(element => ({ value: element.value, disabled: element.disabled, label: element.textContent })));
  assert.equal(options.length, 56);
  assert.ok(options.every(option => !option.disabled), 'all authored rooms are available without unlock prerequisites');
  assert.equal(await desktop.page.getByRole('button', { name: 'Önceki bölüm', exact: true }).isDisabled(), true);
  await desktop.page.keyboard.press('ArrowUp');
  await desktop.page.keyboard.press('ArrowRight');
  await desktop.page.waitForFunction(() => Number(document.querySelector('.learning-count strong')?.textContent) === 2);
  const before = await profile(desktop.page);
  assert.equal(before.parameters, 77_926);
  assert.equal(before.completed, 0);
  await choose(desktop.page, options[55].value, 'room-56');
  assert.equal(await desktop.page.getByRole('button', { name: 'Sonraki bölüm', exact: true }).isDisabled(), true);
  await desktop.page.getByRole('button', { name: 'Önceki bölüm', exact: true }).click();
  await desktop.page.waitForFunction(() => window.__navigationScene.state.level.id === 'room-55');
  await desktop.page.getByRole('button', { name: 'Sonraki bölüm', exact: true }).click();
  await desktop.page.waitForFunction(() => window.__navigationScene.state.level.id === 'room-56');
  await choose(desktop.page, options[0].value, 'room-01');
  const after = await profile(desktop.page);
  assert.deepEqual(after, before);
  report.profile = { before, after };
  report.checks.push('native 56-option selector and previous/next buttons allow skipping to room 56 without completion or changing model parameters, weights or saved examples');

  phase = 'watch current state and explicit restart';
  await desktop.page.keyboard.press('ArrowUp');
  await desktop.page.keyboard.press('ArrowRight');
  await desktop.page.waitForFunction(() => window.__navigationScene.state.tick === 2);
  const continued = await desktop.page.evaluate(() => {
    window.__navigationScene.setTrainingPaused(true);
    return { state: JSON.stringify(window.__navigationScene.state), trials: window.__navigationTrials ?? 0 };
  });
  await desktop.page.getByRole('button', { name: 'Robotu izle', exact: true }).click();
  const watching = await desktop.page.evaluate(() => ({ state: JSON.stringify(window.__navigationScene.state), trials: window.__navigationTrials ?? 0 }));
  assert.deepEqual(watching, continued, 'watching must continue the existing state without beginning or teleporting to a new trial');
  await desktop.page.getByRole('button', { name: 'Robotu durdur', exact: true }).click();
  await desktop.page.getByRole('button', { name: 'Robotu baştan izlet', exact: true }).click();
  await desktop.page.waitForFunction(() => window.__navigationScene.state.tick === 0);
  const restarted = await state(desktop.page);
  assert.equal(restarted.robot.x, restarted.level.start.x);
  assert.equal(restarted.robot.z, restarted.level.start.z);
  assert.ok(await desktop.page.evaluate(() => (window.__navigationTrials ?? 0)) > continued.trials);
  await desktop.page.getByRole('button', { name: 'Robotu durdur', exact: true }).click();
  await desktop.page.evaluate(() => window.__navigationScene.setTrainingPaused(false));
  report.continuationFixture = 'Actual renderer paused only to isolate real watch/restart handlers before the first inference decision.';
  report.checks.push('Robotu izle preserves the current physical state; only the explicit Baştan izle command begins again at the visible room start');

  phase = 'real similar room';
  const beforeVariant = await profile(desktop.page);
  const original = (await state(desktop.page)).level;
  await desktop.page.getByRole('button', { name: 'Benzer bölüm', exact: true }).click();
  await desktop.page.waitForFunction(id => window.__navigationScene.state.level.id !== id, original.id);
  const variant = (await state(desktop.page)).level;
  const physical = level => JSON.stringify([level.width, level.height, level.tiles, level.start, level.crates, level.switches, level.doors, level.goals, level.surfaces]);
  assert.notEqual(physical(variant), physical(original), 'a variant must actually change geometry or starting conditions');
  assert.equal(variant.sourceLevelId, original.id);
  assert.ok(['layout', 'start'].includes(variant.variantKind));
  const validation = await desktop.page.evaluate(async () => {
    const { solveLevel } = await import('/src/core/solver.ts');
    const { createState, step } = await import('/src/core/engine.ts');
    const level = window.__navigationScene.state.level;
    const certificate = solveLevel(level, { maxStates: 12_000, maxActions: 512 });
    return { solved: certificate !== null && certificate !== undefined && certificate.reduce(step, createState(level)).solved, decisions: certificate?.length ?? 0 };
  });
  assert.equal(validation.solved, true, 'generated room has a real engine-verified solution; the validation solver never selects robot actions');
  report.variant = { kind: variant.variantKind, changes: variant.variantChanges, originalStart: original.start, start: variant.start, validation };
  await desktop.page.getByRole('button', { name: 'Asıl düzen', exact: true }).click();
  await desktop.page.waitForFunction(id => window.__navigationScene.state.level.id === id, original.id);
  assert.equal(physical((await state(desktop.page)).level), physical(original));
  assert.deepEqual(await profile(desktop.page), beforeVariant, 'variant/original navigation preserves the model and all saved demonstrations');
  report.checks.push('Benzer bölüm immediately loads a genuinely changed and solvable visible room; Asıl düzen restores its original geometry');

  phase = 'desktop toolbar placement';
  await desktop.page.getByRole('combobox', { name: 'Bölüm seç', exact: true }).scrollIntoViewIfNeeded();
  await layout(desktop.page, 'desktop-normal', false);
  await enterFullscreen(desktop.page);
  await layout(desktop.page, 'desktop-fullscreen');
  await desktop.page.getByRole('button', { name: 'Tam ekrandan çık', exact: true }).click();
  await desktop.context.close();
  report.checks.push('desktop navigation and variant commands sit directly below the rendered map; fullscreen keeps them and E visible');

  phase = 'mobile portrait and short landscape';
  const mobile = await boot(true);
  await enterFullscreen(mobile.page);
  await layout(mobile.page, 'mobile-portrait');
  const teach = mobile.page.locator('.playable-fullscreen-bar').getByRole('button', { name: /Robotuna öğret/ });
  assert.equal(await teach.isDisabled(), true, 'fresh untrained profile cannot train without demonstrations');
  report.teachTarget = await exposed(mobile.page, teach, 'fullscreen teach');
  await mobile.page.getByRole('button', { name: 'Sonraki bölüm', exact: true }).tap();
  await mobile.page.waitForFunction(() => window.__navigationScene.state.level.id === 'room-02');
  await mobile.page.getByRole('button', { name: 'Önceki bölüm', exact: true }).tap();
  await mobile.page.waitForFunction(() => window.__navigationScene.state.level.id === 'room-01');
  assert.equal(await sampleCount(mobile.page), 0, 'navigation is not a training demonstration');
  await mobile.page.setViewportSize({ width: 844, height: 390 });
  await layout(mobile.page, 'mobile-landscape');
  await mobile.page.setViewportSize({ width: 844, height: 320 });
  await layout(mobile.page, 'mobile-short-landscape');
  const startSamples = await sampleCount(mobile.page);
  await mobile.page.locator('.playable-fullscreen .interact-key').tap();
  await mobile.page.waitForFunction(expected => Number(document.querySelector('.learning-count strong')?.textContent) === expected, startSamples + 1);
  await exposed(mobile.page, teach, 'short-landscape teach');
  await mobile.page.locator('.playable-fullscreen [data-action="0"]').tap();
  await mobile.page.waitForFunction(expected => Number(document.querySelector('.learning-count strong')?.textContent) === expected, startSamples + 2);
  assert.equal(await teach.isEnabled(), true);
  const beforeTraining = await profile(mobile.page);
  phase = 'fullscreen training cancellation';
  await teach.tap();
  const stop = mobile.page.locator('.playable-fullscreen-bar').getByRole('button', { name: /Durdur|Eğitimi durdur/ });
  await stop.waitFor({ state: 'visible' });
  report.stopTrainingTarget = await exposed(mobile.page, stop, 'short-landscape training stop');
  await mobile.page.waitForFunction(() => /\d+\/\d+\s*tur/.test(document.querySelector('.playable-fullscreen-bar')?.textContent ?? ''), null, { timeout: 40_000 });
  if (process.env.NO_SCREENSHOTS !== '1') await mobile.page.screenshot({ path: fileURLToPath(new URL('workshop-fullscreen-training.png', destination)) });
  await stop.tap();
  await teach.waitFor({ state: 'visible' });
  assert.deepEqual(await profile(mobile.page), beforeTraining, 'cancelling actual Worker training preserves the previous model');
  report.checks.push('fullscreen Teach enables after two human actions; real Worker progress and a visible 44px Stop are available, and cancellation preserves the model');

  phase = 'fullscreen training completion after exit';
  await teach.tap();
  await stop.waitFor({ state: 'visible' });
  await mobile.page.getByRole('button', { name: 'Tam ekrandan çık', exact: true }).tap();
  await mobile.page.waitForFunction(() => !document.querySelector('.playable-fullscreen') && document.body.style.overflow !== 'hidden');
  await mobile.page.waitForFunction(() => document.querySelector('.version-tag')?.textContent === 'v1', null, { timeout: 90_000 });
  const afterTraining = await profile(mobile.page);
  assert.notEqual(afterTraining.hash, beforeTraining.hash, 'completed real training changes actual saved model weights');
  assert.ok(afterTraining.trainedSteps > beforeTraining.trainedSteps);
  assert.equal(afterTraining.parameters, 77_926);
  assert.equal(afterTraining.samples, beforeTraining.samples);
  assert.ok(report.workers.some(url => url.includes('training.worker')));
  report.training = { before: beforeTraining, after: afterTraining, completedAfterFullscreenExit: true };
  await mobile.context.close();
  report.checks.push('390px portrait and 844px short landscape retain accessible, uncovered under-map commands plus a functioning E key');
  report.checks.push('training started from fullscreen continues after exiting the view, completes in the actual Worker and persists changed GRU weights');
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = { phase, stack: error.stack ?? String(error) };
  process.exitCode = 1;
  for (const [index, page] of browser.contexts().flatMap(context => context.pages()).entries()) {
    try { await page.screenshot({ path: fileURLToPath(new URL(`workshop-failure-${index}.png`, destination)), timeout: 5000 }); } catch { /* Preserve the assertion. */ }
  }
} finally {
  report.finishedAt = new Date().toISOString();
  await browser.close();
  await writeFile(new URL('workshop-navigation.json', destination), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
