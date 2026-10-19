import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const destination = new URL('../artifacts/e2e/', import.meta.url);
await mkdir(destination, { recursive: true });
const report = { baseURL, checks: [], errors: [] };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const shot = (page, name) => page.screenshot({ path: fileURLToPath(new URL(name, destination)) });

async function boot(reducedMotion = 'no-preference', mobile = false) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 400 } : { width: 1120, height: 760 }, reducedMotion, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  // Exercise the actual Vite modules and simulator without a second React/WebGL view.
  await page.route('**/src/main.tsx', route => route.fulfill({ contentType: 'application/javascript', body: 'export {};' }));
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { document.body.innerHTML = '<div id="mechanisms-host" style="position:fixed;inset:0"></div>'; document.body.style.margin = '0'; });
  await page.addScriptTag({ type: 'module', content: `
    import * as THREE from '/node_modules/.vite/deps/three.js';
    import { GameScene } from '/src/render/GameScene.ts';
    import { createState, step } from '/src/core/engine.ts';
    import { LEVELS } from '/src/core/levels.ts';
    window.__THREE = THREE; window.__levels = LEVELS; window.__createState = createState; window.__step = step;
    window.__state = createState(LEVELS[10]);
    window.__scene = new GameScene(document.querySelector('#mechanisms-host'), window.__state, { quality: '${mobile ? 'balanced' : 'high'}' });
    window.__scene.setWeather('clear'); window.__ready = true;
  ` });
  await page.waitForFunction(() => window.__ready === true);
  return { page, context };
}

const act = (page, actions) => page.evaluate(actions => {
  for (const action of actions) window.__state = window.__step(window.__state, action);
  window.__scene.update(window.__state);
  return { switches: window.__state.switches.map(item => item.on), doors: window.__state.doors.map(item => item.open) };
}, actions);

const inspect = page => page.evaluate(() => {
  const scene = window.__scene;
  const switches = [...scene.switchVisuals.values()];
  const doors = [...scene.doorVisuals.values()];
  return {
    switches: switches.map(item => ({ activation: item.activation, y: item.button.position.y, emissive: item.surface.emissiveIntensity, color: item.status.color.getHexString(), spill: item.spillMaterial.opacity, attached: !!item.button.parent })),
    doors: doors.map(item => {
      scene.world.updateMatrixWorld(true);
      const box = new window.__THREE.Box3().setFromObject(item.shutter);
      const frame = item.root.getObjectByName('solid doorway frame and overhead cassette');
      const cassette = frame?.children.find(mesh => mesh.material === scene.assets.material('ceramicLight'));
      const cassetteBox = cassette ? new window.__THREE.Box3().setFromObject(cassette) : null;
      const robotBox = new window.__THREE.Box3().setFromObject(scene.robot.root);
      return { openness: item.openness, visible: item.shutter.visible, bottom: box.min.y - item.root.position.y, color: item.status.color.getHexString(), attached: item.shutter.children.length > 0, openLabel: item.openLabel.visible, closedLabel: item.closedLabel.visible,
        shutterScale: item.shutter.scale.toArray(),
        slats: item.slats.map(slat => ({ scale: slat.scale.toArray(), y: slat.position.y, visible: slat.visible })),
        cassetteBottom: cassetteBox?.min.y, robotTop: robotBox.max.y,
        plaqueAligned: item.openLabel.parent === item.root && item.closedLabel.parent === item.root,
        plaqueHeight: item.openLabel.position.y,
        renderCalls: scene.renderer.info.render.calls,
      };
    }),
    ownMaterials: switches.length < 2 || (switches[0].surface !== switches[1].surface && switches[0].status !== switches[1].status),
  };
});

try {
  const { page, context } = await boot();
  await page.waitForTimeout(400);
  await shot(page, 'mechanisms-closed.png');
  const closed = await inspect(page);
  assert.equal(closed.doors[0].visible, true);
  assert.equal(closed.doors[0].closedLabel, true);
  assert.ok(closed.doors[0].bottom < 0.1, 'closed panel reaches the sill');
  assert.equal(closed.doors[0].slats.length, 7, 'gate consists of seven separate rigid shutter segments');
  assert.ok(closed.doors[0].slats.every(slat => slat.visible && slat.scale.every(value => value === 1)));
  assert.ok(closed.doors[0].cassetteBottom > closed.doors[0].robotTop + 0.08, 'cassette leaves clearance for the complete robot including its antenna');
  assert.equal(closed.doors[0].plaqueAligned, true, 'status plaque belongs to the physical cassette, without a crosswise floating sign');
  assert.equal(closed.ownMaterials, true);
  let state = await act(page, [1, 0, 4]);
  assert.deepEqual(state.switches, [true, false]);
  assert.deepEqual(state.doors, [false]);
  await page.waitForFunction(() => [...window.__scene.switchVisuals.values()][0].activation > 0.99);
  const firstOn = await inspect(page);
  assert.ok(firstOn.switches[0].emissive > 1.4);
  assert.ok(firstOn.switches[0].spill > 0.6);
  assert.equal(firstOn.switches[1].emissive, 0, 'unpressed switch remains unlit');
  assert.equal(firstOn.switches[1].color, closed.switches[1].color, 'shared assets do not recolor an unrelated switch');
  report.checks.push('a real toggle lights its full surface and halo without changing another switch');
  state = await act(page, [2, 1, 2, 4]);
  assert.deepEqual(state.doors, [true]);
  await page.waitForFunction(() => [...window.__scene.doorVisuals.values()][0].openness > 0.99);
  await shot(page, 'mechanisms-open.png');
  const opened = await inspect(page);
  assert.equal(opened.doors[0].visible, false, 'retracted shutter leaves a completely empty passage');
  assert.equal(opened.doors[0].openLabel, true, 'open status plaque is visible from above');
  assert.equal(opened.doors[0].closedLabel, false);
  assert.ok(opened.doors[0].bottom > 1.6, 'all rigid slats retract above the full robot passage');
  assert.deepEqual(opened.doors[0].shutterScale, [1, 1, 1], 'opening never squashes the shutter group');
  assert.ok(opened.doors[0].slats.every(slat => !slat.visible && slat.scale.every(value => value === 1)), 'all rigid segments are hidden inside the cassette at full opening');
  for (let i = 1; i < opened.doors[0].slats.length; i++) assert.ok(Math.abs((opened.doors[0].slats[i].y - opened.doors[0].slats[i - 1].y) - (closed.doors[0].slats[i].y - closed.doors[0].slats[i - 1].y)) < 0.00001, 'segment spacing stays constant while retracting');
  assert.notEqual(opened.doors[0].color, closed.doors[0].color);
  state = await act(page, [4]);
  assert.deepEqual(state.switches, [true, false]);
  assert.deepEqual(state.doors, [false]);
  await page.waitForFunction(() => [...window.__scene.doorVisuals.values()][0].openness < 0.01);
  const closedAgain = await inspect(page);
  assert.equal(closedAgain.doors[0].visible, true);
  assert.equal(closedAgain.doors[0].closedLabel, true);
  assert.ok(closedAgain.doors[0].bottom < 0.1);
  report.checks.push('seven rigid gate segments retract into a real cassette without scaling, clear the complete robot passage, and close again after a real switch release');
  report.doorGeometry = { slats: opened.doors[0].slats.length, shutterScale: opened.doors[0].shutterScale, cassetteBottom: opened.doors[0].cassetteBottom, robotTop: opened.doors[0].robotTop, renderCalls: opened.doors[0].renderCalls };
  await page.evaluate(() => { window.__state = window.__createState(window.__levels[6]); window.__scene.update(window.__state); });
  state = await act(page, [1, 4, 0, 1, 2, 4]);
  assert.deepEqual(state.switches, [true]);
  assert.deepEqual(state.doors, [true]);
  await page.waitForFunction(() => [...window.__scene.doorVisuals.values()][0].openness > 0.99);
  await shot(page, 'mechanisms-pressure-crate.png');
  state = await act(page, [4]);
  assert.deepEqual(state.switches, [false]);
  assert.deepEqual(state.doors, [false]);
  report.checks.push('a real carried crate presses the plate; lifting it releases both plate and gate');
  await page.evaluate(() => window.__scene.dispose());
  await context.close();
  const mobile = await boot('reduce', true);
  state = await act(mobile.page, [1, 0, 4, 2, 1, 2, 4]);
  const reduced = await inspect(mobile.page);
  assert.deepEqual(state.doors, [true]);
  assert.equal(reduced.doors[0].openness, 1, 'reduced motion applies the final state immediately');
  assert.equal(reduced.doors[0].visible, false);
  assert.ok(reduced.switches.every(item => item.emissive > 1.4));
  await shot(mobile.page, 'mechanisms-mobile-open.png');
  await mobile.page.evaluate(() => window.__scene.dispose());
  await mobile.context.close();
  report.checks.push('mobile reduced-motion view shows the complete open state immediately');
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) { report.passed = false; report.failure = error.stack ?? String(error); process.exitCode = 1; }
finally { await browser.close(); await writeFile(new URL('mechanisms.json', destination), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
