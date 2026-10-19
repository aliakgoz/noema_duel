import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const destination = new URL('../artifacts/e2e/', import.meta.url);
await mkdir(destination, { recursive: true });
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], errors: [], views: [], ignoredHotUpdates: [] };
let phase = 'boot';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function boot({ mobile = true, fallback = false, nativeBackMock = false } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1120, height: 760 },
    isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1,
    serviceWorkers: 'block',
  });
  // Keep the modules loaded at navigation stable while other agents edit the
  // development checkout. This filters Vite's reload events only; game traffic,
  // initial module loading, rendering and browser input remain real.
  await context.routeWebSocket('**/*', socket => {
    const server = socket.connectToServer();
    server.onMessage(message => {
      let payload;
      try { payload = JSON.parse(String(message)); } catch { /* Non-JSON app traffic is forwarded. */ }
      if (payload?.type === 'update' || payload?.type === 'full-reload') {
        report.ignoredHotUpdates.push({ phase, type: payload.type });
        return;
      }
      socket.send(message);
    });
  });
  if (fallback) await context.addInitScript(() => {
    window.__fullscreenRequests = 0;
    HTMLElement.prototype.requestFullscreen = () => {
      window.__fullscreenRequests++;
      return Promise.reject(new Error('Test fixture: WebView denied Fullscreen API'));
    };
  });
  if (nativeBackMock) {
    // Exercise the real App native-back branch with a clearly labelled bridge
    // fixture. This is not a claim of Android hardware/WebView verification.
    await context.addInitScript(() => {
      window.androidBridge = {};
      window.__nativeBackListeners = new Map();
      window.__nativeBackNextId = 0;
      window.__nativeExitCalls = 0;
    });
    await context.route(/\/node_modules\/\.vite\/deps\/@capacitor_app\.js(?:\?.*)?$/, route => route.fulfill({
      contentType: 'application/javascript',
      body: `export const App = {
        addListener: async (event, callback) => {
          const id = ++window.__nativeBackNextId;
          if (event === 'backButton') window.__nativeBackListeners.set(id, callback);
          return { remove: async () => window.__nativeBackListeners.delete(id) };
        },
        exitApp: async () => { window.__nativeExitCalls++; }
      };`,
    }));
  }
  const page = await context.newPage();
  await page.route('**/src/render/GameScene.ts*', async route => {
    const response = await route.fetch();
    const source = await response.text();
    await route.fulfill({ response, body: source + `
      // Test-only observer of the exact GameScene module imported by App.
      const noemaOriginalResize = GameScene.prototype.resize;
      GameScene.prototype.resize = function (...args) {
        const result = noemaOriginalResize.apply(this, args);
        window.__fullscreenScene = this;
        if (!this.renderer.__fullscreenObserved) {
          this.renderer.__fullscreenObserved = true;
          const render = this.renderer.render.bind(this.renderer);
          this.renderer.render = (...renderArgs) => {
            const result = render(...renderArgs);
            this.__fullscreenFrames = (this.__fullscreenFrames ?? 0) + 1;
            this.__fullscreenRenderedView = { width: this.container.clientWidth, height: this.container.clientHeight };
            return result;
          };
        }
        return result;
      };
    ` });
  });
  page.on('pageerror', error => report.errors.push({ phase, message: error.message, stack: error.stack }));
  page.on('console', message => { if (message.type() === 'error') report.errors.push({ phase, message: message.text() }); });
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.locator('.scene-host canvas').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(() => document.querySelector('.training-status small')?.textContent?.includes('kaydedildi'));
  assert.equal(await page.locator('.scene-error').count(), 0);
  await page.evaluate(() => {
    window.__fullscreenCanvas = document.querySelector('.scene-host canvas');
    window.__fullscreenInitialOverflow = {
      body: document.body.style.overflow,
      root: document.documentElement.style.overflow,
      overscroll: document.documentElement.style.overscrollBehavior,
    };
  });
  return { page, context };
}

async function open(page) {
  await page.evaluate(() => { window.__fullscreenFrameBaseline = window.__fullscreenScene?.__fullscreenFrames ?? 0; });
  await page.getByRole('button', { name: 'Görünümü büyüt', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Tam ekran oyun alanı', exact: true });
  await dialog.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.body.classList.contains('playable-fullscreen-open'));
  assert.equal(await page.evaluate(() => window.__fullscreenCanvas === document.querySelector('.scene-host canvas')), true, 'fullscreen preserves the same live canvas');
  await visibleGeometry(page);
  return dialog;
}

async function visibleGeometry(page) {
  await page.waitForFunction(() => {
    const scene = window.__fullscreenScene;
    if (!scene || scene.disposed || !scene.hasPresentedFrame) return false;
    const point = scene.robot.root.position.clone().project(scene.camera);
    return Number.isFinite(point.x) && Number.isFinite(point.y)
      && Math.abs(point.x) < 1 && Math.abs(point.y) < 1 && Math.abs(point.z) < 1
      && scene.renderer.info.render.triangles > 1000
      && (scene.__fullscreenFrames ?? 0) >= (window.__fullscreenFrameBaseline ?? 0) + 2
      && scene.__fullscreenRenderedView?.width === scene.container.clientWidth
      && scene.__fullscreenRenderedView?.height === scene.container.clientHeight;
  }, null, { timeout: 20_000 });
}

async function layout(page, label) {
  await visibleGeometry(page);
  const dimensions = await page.evaluate(() => {
    const card = document.querySelector('.world-card.playable-fullscreen');
    const targets = [...card.querySelectorAll('.direction,.interact-key,[data-fullscreen-exit],.camera-toggle')];
    const teach = [...card.querySelectorAll('.playable-fullscreen-bar button')].find(element => element.textContent.includes('Robotuna öğret'));
    if (teach) targets.push(teach);
    const box = card.getBoundingClientRect();
    const scene = card.querySelector('.world-viewport').getBoundingClientRect();
    return {
      width: innerWidth, height: innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      card: { x: box.x, y: box.y, width: box.width, height: box.height },
      scene: { width: scene.width, height: scene.height },
      nativeFullscreen: document.fullscreenElement === card,
      controls: targets.map(element => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return {
          label: element.getAttribute('aria-label') ?? element.textContent.trim(), x: rect.x, y: rect.y,
          width: rect.width, height: rect.height,
          exposed: hit === element || element.contains(hit),
        };
      }),
      bodyLocked: document.body.style.overflow === 'hidden',
      rootLocked: document.documentElement.style.overflow === 'hidden',
      renderer: (() => {
        const live = window.__fullscreenScene;
        const point = live.robot.root.position.clone().project(live.camera);
        return {
          frames: live.__fullscreenFrames,
          calls: live.renderer.info.render.calls,
          triangles: live.renderer.info.render.triangles,
          robotNDC: point.toArray(),
          cameraPosition: live.camera.position.toArray(),
          frustum: [live.camera.left, live.camera.right, live.camera.top, live.camera.bottom, live.camera.near, live.camera.far],
        };
      })(),
    };
  });
  assert.equal(dimensions.controls.length, 8, `${label}: all four direction controls, interaction, camera, teaching and exit exist`);
  assert.ok(dimensions.bodyLocked && dimensions.rootLocked, `${label}: background scrolling is locked`);
  assert.ok(dimensions.documentWidth <= dimensions.width + 1, `${label}: no horizontal overflow`);
  assert.ok(Math.abs(dimensions.card.x) <= 1 && Math.abs(dimensions.card.y) <= 1, `${label}: card starts at viewport origin`);
  assert.ok(dimensions.card.width >= dimensions.width - 1 && dimensions.card.height >= dimensions.height - 1, `${label}: playable card fills viewport`);
  assert.ok(dimensions.scene.width > 180 && dimensions.scene.height > 100, `${label}: arena retains useful visible space`);
  for (const control of dimensions.controls) {
    assert.ok(control.width >= 43.5 && control.height >= 43.5, `${label}/${control.label}: accessible touch target`);
    assert.ok(control.x >= -1 && control.y >= -1 && control.x + control.width <= dimensions.width + 1 && control.y + control.height <= dimensions.height + 1, `${label}/${control.label}: control is entirely visible`);
    assert.equal(control.exposed, true, `${label}/${control.label}: no overlay covers the control`);
  }
  report.views.push({ label, ...dimensions });
  if (process.env.NO_SCREENSHOTS !== '1') await page.screenshot({ path: fileURLToPath(new URL(`fullscreen-${label}.png`, destination)) });
  return dimensions;
}

const samples = async page => Number(await page.locator('.learning-count strong').textContent());

async function cycleCamera(page, label) {
  const before = await samples(page);
  const moves = await page.locator('.world-stats').textContent();
  const button = page.locator('.camera-toggle');
  assert.equal((await button.textContent()).trim(), 'CAM 01');
  for (const expected of ['CAM 02', 'CAM 03', 'CAM 01']) {
    await button.click();
    await page.waitForFunction(expected => document.querySelector('.camera-toggle')?.textContent?.trim() === expected, expected);
    await page.waitForTimeout(500);
    await visibleGeometry(page);
    assert.equal(await page.evaluate(() => window.__fullscreenCanvas === document.querySelector('.scene-host canvas')), true);
    assert.equal(await samples(page), before, 'changing view must not add demonstrations');
    assert.equal(await page.locator('.world-stats').textContent(), moves, 'changing view must not alter the puzzle');
    if (expected === 'CAM 03' && process.env.NO_SCREENSHOTS !== '1') await page.screenshot({ path: fileURLToPath(new URL(`fullscreen-${label}-camera03.png`, destination)) });
  }
  report.checks.push(`${label}: the actual camera button cycles all three views without replacing the canvas or altering game progress`);
}

async function variantControls(page, name) {
  const before = await samples(page);
  await page.getByRole('button', { name: 'Benzer bölüm', exact: true }).tap();
  await page.locator('.workshop-toolbar[data-variant="true"]').waitFor();
  await visibleGeometry(page);
  const original = page.getByRole('button', { name: 'Asıl düzen', exact: true });
  const bounds = await original.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const arena = document.querySelector('.world-viewport').getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, arenaBottom: arena.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight, exposed: hit === element || element.contains(hit) };
  });
  assert.ok(bounds.width >= 43.5 && bounds.height >= 43.5, `${name}: Asıl düzen target is at least 44px`);
  assert.ok(bounds.x >= 0 && bounds.y >= bounds.arenaBottom - 1 && bounds.x + bounds.width <= bounds.viewportWidth + 1 && bounds.y + bounds.height <= bounds.viewportHeight + 1, `${name}: Asıl düzen is visible below the arena`);
  assert.equal(bounds.exposed, true);
  assert.equal(await samples(page), before);
  if (process.env.NO_SCREENSHOTS !== '1') await page.screenshot({ path: fileURLToPath(new URL(`fullscreen-${name}-variant.png`, destination)) });
  await original.tap();
  await page.locator('.workshop-toolbar[data-variant="false"]').waitFor();
  assert.equal(await samples(page), before);
  report.checks.push(`${name}: the variant's Asıl düzen button remains visible, uncovered and 44px below the actual map`);
}

async function play(page) {
  const dialog = page.getByRole('dialog', { name: 'Tam ekran oyun alanı', exact: true });
  const before = await samples(page);
  // This loop is real touch input through all controls. A new contextual sample
  // proves one engine action even when an attempted interaction has no target.
  for (const [index, selector] of ['[data-action="0"]', '[data-action="1"]', '[data-action="2"]', '[data-action="3"]', '.interact-key'].entries()) {
    await dialog.locator(selector).tap();
    await page.waitForFunction(expected => Number(document.querySelector('.learning-count strong')?.textContent) === expected, before + index + 1);
  }
  assert.match(await dialog.locator('.world-stats').textContent(), /4\s*HAMLE/);
  return { before, after: await samples(page), actions: 5, successfulMoves: 4 };
}

async function restored(page) {
  await page.locator('.world-card.playable-fullscreen').waitFor({ state: 'detached' });
  await page.waitForFunction(() => !document.body.classList.contains('playable-fullscreen-open') && !history.state?.__noemaPlayableFullscreen);
  const result = await page.evaluate(() => ({
    canvasPreserved: window.__fullscreenCanvas === document.querySelector('.scene-host canvas'),
    fullscreenElement: Boolean(document.fullscreenElement),
    overflowRestored: document.body.style.overflow === window.__fullscreenInitialOverflow.body
      && document.documentElement.style.overflow === window.__fullscreenInitialOverflow.root
      && document.documentElement.style.overscrollBehavior === window.__fullscreenInitialOverflow.overscroll,
    activeLabel: document.activeElement?.getAttribute('aria-label'),
  }));
  assert.equal(result.canvasPreserved, true);
  assert.equal(result.fullscreenElement, false);
  assert.equal(result.overflowRestored, true);
  await page.locator('.world-header').waitFor({ state: 'visible' });
  return result;
}

try {
  phase = 'portrait CSS fallback';
  const mobile = await boot({ fallback: true });
  await open(mobile.page);
  const portrait = await layout(mobile.page, 'portrait-fallback');
  assert.equal(portrait.nativeFullscreen, false);
  assert.ok(await mobile.page.evaluate(() => window.__fullscreenRequests > 0), 'the real rejected Fullscreen API path was attempted');
  await cycleCamera(mobile.page, 'portrait');
  report.touch = await play(mobile.page);
  report.checks.push('portrait: API rejection leaves the same live game playable, with every direction and E producing exactly one engine action');
  await variantControls(mobile.page, 'portrait');
  await mobile.page.getByRole('button', { name: 'Tam ekrandan çık', exact: true }).click();
  report.exitButton = await restored(mobile.page);
  assert.equal(report.exitButton.activeLabel, 'Görünümü büyüt');
  report.checks.push('visible exit restores normal layout, scrolling, opener focus and the original canvas');

  phase = 'landscape CSS fallback';
  await mobile.page.setViewportSize({ width: 844, height: 390 });
  await open(mobile.page);
  await layout(mobile.page, 'landscape-fallback');
  await mobile.page.setViewportSize({ width: 844, height: 320 });
  await layout(mobile.page, 'short-landscape-fallback');
  await cycleCamera(mobile.page, 'short-landscape');
  await variantControls(mobile.page, 'short-landscape');
  const beforeLandscape = await samples(mobile.page);
  await mobile.page.locator('.playable-fullscreen [data-action="0"]').tap();
  await mobile.page.waitForFunction(expected => Number(document.querySelector('.learning-count strong')?.textContent) === expected, beforeLandscape + 1);
  await mobile.page.locator('.playable-fullscreen .interact-key').tap();
  await mobile.page.waitForFunction(expected => Number(document.querySelector('.learning-count strong')?.textContent) === expected, beforeLandscape + 2);
  await mobile.page.keyboard.press('Escape');
  await restored(mobile.page);
  report.checks.push('landscape at 844×390 and 844×320 retains uncovered touch controls; Escape exits and restores the page');

  phase = 'history back';
  await mobile.page.setViewportSize({ width: 390, height: 844 });
  await open(mobile.page);
  const originalURL = mobile.page.url();
  await mobile.page.evaluate(() => history.back());
  await restored(mobile.page);
  assert.equal(mobile.page.url(), originalURL);
  report.checks.push('browser Back closes fullscreen without navigating away from the game');
  await mobile.context.close();

  phase = 'actual Fullscreen API';
  const desktop = await boot({ mobile: false });
  const enabled = await desktop.page.evaluate(() => document.fullscreenEnabled);
  await open(desktop.page);
  const accepted = await desktop.page.waitForFunction(() => document.fullscreenElement !== null, null, { timeout: 4000 }).then(() => true).catch(() => false);
  report.fullscreenAPI = { enabled, accepted };
  await layout(desktop.page, 'desktop-api');
  // Every tab remains inside the real modal and the original live canvas.
  for (let i = 0; i < 12; i++) {
    await desktop.page.keyboard.press('Tab');
    assert.equal(await desktop.page.evaluate(() => document.querySelector('.playable-fullscreen').contains(document.activeElement)), true);
  }
  if (accepted) {
    await desktop.page.evaluate(() => document.exitFullscreen());
    await restored(desktop.page);
    report.checks.push('actual browser Fullscreen API succeeds, traps keyboard focus and closes the playable layout when browser fullscreen ends');
  } else {
    await desktop.page.getByRole('button', { name: 'Tam ekrandan çık', exact: true }).click();
    await restored(desktop.page);
    report.checks.push('headless browser denied native fullscreen; desktop CSS fallback and keyboard focus trap passed');
  }
  await desktop.context.close();

  phase = 'mocked Android back callback';
  const native = await boot({ fallback: true, nativeBackMock: true });
  await native.page.waitForFunction(() => window.__nativeBackListeners.size > 0);
  await open(native.page);
  await native.page.evaluate(() => [...window.__nativeBackListeners.values()].at(-1)({ canGoBack: true }));
  await restored(native.page);
  const bridge = await native.page.evaluate(() => ({ exitCalls: window.__nativeExitCalls, listeners: window.__nativeBackListeners.size }));
  assert.equal(bridge.exitCalls, 0, 'native Back must close the playable screen before App.exitApp');
  assert.ok(bridge.listeners > 0);
  report.mockedNativeBack = { ...bridge, limitation: 'Callback bridge fixture only; no physical Android device was exercised.' };
  report.checks.push('mocked Android plugin callback exercises the actual App handler and closes fullscreen without requesting app exit');
  await native.context.close();
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = { phase, stack: error.stack ?? String(error) };
  process.exitCode = 1;
  for (const [index, page] of browser.contexts().flatMap(context => context.pages()).entries()) {
    try { await page.screenshot({ path: fileURLToPath(new URL(`fullscreen-failure-${index}.png`, destination)), timeout: 5000 }); } catch { /* Keep original assertion. */ }
  }
} finally {
  report.finishedAt = new Date().toISOString();
  await browser.close();
  await writeFile(new URL('playable-fullscreen.json', destination), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
