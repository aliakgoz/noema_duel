import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Run against Vite: the isolated view uses the actual rendering and simulator
// modules, without a second React/WebGL scene competing for the software GPU.
const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const destination = new URL('../artifacts/e2e/', import.meta.url);
await mkdir(destination, { recursive: true });
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], errors: [], scenes: [] };
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function boot(mobile = false, reducedMotion = 'no-preference') {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 420 } : { width: 1120, height: 760 },
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.stack ?? error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  await page.route('**/src/main.tsx', route => route.fulfill({ contentType: 'application/javascript', body: 'export {};' }));
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    document.body.innerHTML = '<div id="render-host" style="position:fixed;inset:0"></div>';
    document.body.style.margin = '0';
  });
  await page.addScriptTag({ type: 'module', content: `
    import * as THREE from '/node_modules/.vite/deps/three.js';
    import { GameScene } from '/src/render/GameScene.ts';
    import { createState } from '/src/core/engine.ts';
    import { LEVELS } from '/src/core/levels.ts';
    window.__THREE = THREE;
    window.__levels = LEVELS;
    window.__createState = createState;
    window.__state = createState(LEVELS[0]);
    window.__scene = new GameScene(document.querySelector('#render-host'), window.__state, { quality: '${mobile ? 'balanced' : 'high'}' });
    window.__scene.setTrainingPaused(true);
    window.__initialState = JSON.stringify(window.__state);
    window.__ready = true;
  ` });
  await page.waitForFunction(() => window.__ready === true);
  return { context, page };
}

const screenshot = async (page, name) => {
  if (process.env.NO_SCREENSHOTS !== '1') await page.screenshot({ path: fileURLToPath(new URL(name, destination)) });
};

const inspectPerimeter = page => page.evaluate(() => {
  const scene = window.__scene;
  const THREE = window.__THREE;
  const { width, height } = window.__state.level;
  const points = [
    { side: 'north', x: 0.18, z: -height / 2 - 0.4 },
    { side: 'south', x: 0.18, z: height / 2 + 0.4 },
    { side: 'west', x: -width / 2 - 0.4, z: 0.18 },
    { side: 'east', x: width / 2 + 0.4, z: 0.18 },
  ];
  scene.world.updateMatrixWorld(true);
  const ceramic = scene.assets.material('ceramic');
  const foundation = scene.assets.material('stone');
  const darkJoint = scene.assets.material('joint');
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  return points.map(point => {
    ray.set(new THREE.Vector3(point.x, 5, point.z), down);
    const hits = ray.intersectObjects(scene.world.children, true);
    const pale = hits.find(hit => hit.object.material === ceramic);
    // Include the original navy joint finish too: this assertion must reject
    // the old coplanar plinth, rather than skipping it for a lower stone layer.
    const dark = hits.find(hit => hit.object.material === foundation || hit.object.material === darkJoint);
    return {
      ...point,
      ceramicTop: pale?.point.y ?? null,
      recessTop: dark?.point.y ?? null,
      gap: pale && dark ? pale.point.y - dark.point.y : null,
    };
  });
});

const climate = (page, mode, elapsed = 0) => page.evaluate(({ mode, elapsed }) => {
  const scene = window.__scene;
  scene.setWeather(mode);
  scene.elapsed = elapsed;
  // Twenty simulated seconds settle the exact same interpolation used by RAF.
  // Holding elapsed fixes weather position, while still updating real geometry.
  for (let i = 0; i < 40; i++) scene.applyClimate(scene.atmosphere.update(0.5, elapsed));
  scene.renderer.render(scene.scene, scene.camera);
  return {
    ...scene.getAtmosphere(),
    sunIntensity: scene.sun.intensity,
    sunColor: scene.sun.color.getHexString(),
    skyIntensity: scene.skylight.intensity,
    exposure: scene.renderer.toneMappingExposure,
    shadows: scene.renderer.shadowMap.enabled && scene.sun.castShadow,
    sunlightMask: Object.fromEntries(Object.entries(scene.sunlightMask.uniforms).map(([key, value]) => [key, value.value])),
    render: { calls: scene.renderer.info.render.calls, triangles: scene.renderer.info.render.triangles },
    memory: { ...scene.renderer.info.memory },
    stateUnchanged: JSON.stringify(window.__state) === window.__initialState,
    glError: scene.renderer.getContext().getError(),
  };
}, { mode, elapsed });

function checkGeometry(samples, label) {
  assert.equal(samples.length, 4);
  for (const sample of samples) {
    assert.ok(sample.ceramicTop !== null, `${label}/${sample.side}: ceramic surround exists`);
    assert.ok(sample.recessTop !== null, `${label}/${sample.side}: dark reveal exists below surround`);
    assert.ok(sample.gap > 0.015, `${label}/${sample.side}: opaque surfaces need physical depth separation; gap=${sample.gap}`);
  }
}

try {
  const desktop = await boot();
  const original = await inspectPerimeter(desktop.page);
  checkGeometry(original, 'desktop/room-01');
  report.geometry = { desktop: original };
  report.checks.push('real merged geometry separates pale perimeter from dark reveal on all four sides');

  const clear = await climate(desktop.page, 'clear');
  await screenshot(desktop.page, 'sunlight-desktop-clear.png');
  const rain = await climate(desktop.page, 'rain', 60);
  await screenshot(desktop.page, 'sunlight-desktop-rain.png');
  const partlyCloudy = await climate(desktop.page, 'auto', 0);
  await screenshot(desktop.page, 'sunlight-desktop-partly-cloudy.png');
  assert.ok(clear.sunlight > rain.sunlight + 0.4);
  assert.ok(clear.sunIntensity > rain.sunIntensity + 0.5);
  assert.ok(clear.exposure > rain.exposure);
  assert.notEqual(clear.sunColor, rain.sunColor);
  assert.equal(clear.shadows, true);
  assert.equal(rain.shadows, true);
  assert.ok(clear.stateUnchanged && rain.stateUnchanged);
  assert.equal(clear.glError, 0);
  assert.equal(rain.glError, 0);
  assert.equal(partlyCloudy.phase, 'cloudy');
  assert.ok(partlyCloudy.sunlight > 0.4 && partlyCloudy.rain < 0.01);
  assert.ok(partlyCloudy.sunlightMask.noemaCloudShade > clear.sunlightMask.noemaCloudShade);
  assert.equal(rain.sunlightMask.noemaSunTime, 60);
  report.scenes.push({ view: 'desktop', clear, rain, partlyCloudy });
  report.checks.push('sunny and rainy views change actual directional illumination, color and exposure with real shadows');

  const auto = await desktop.page.evaluate(() => {
    const scene = window.__scene;
    scene.setWeather('auto');
    const rows = [];
    for (let elapsed = 0; elapsed <= 130; elapsed += 1) {
      scene.elapsed = elapsed;
      const snapshot = scene.atmosphere.update(1, elapsed);
      scene.applyClimate(snapshot);
      if (elapsed % 5 === 0) rows.push({ elapsed, ...scene.getAtmosphere() });
    }
    scene.renderer.render(scene.scene, scene.camera);
    return rows;
  });
  assert.ok(auto.some(row => row.phase === 'clear' && row.sunlight > 0.65));
  assert.ok(auto.some(row => row.phase === 'cloudy' && row.rain < 0.1));
  assert.ok(auto.some(row => row.phase === 'rain' && row.rain > 0.5));
  report.auto = auto;
  report.checks.push('automatic weather includes sunny, partly cloudy and rainy intervals in one complete cycle');

  await desktop.page.evaluate(() => {
    window.__state = window.__createState(window.__levels[55]);
    window.__initialState = JSON.stringify(window.__state);
    window.__scene.update(window.__state);
  });
  const large = await inspectPerimeter(desktop.page);
  checkGeometry(large, 'desktop/room-56');
  report.geometry.largeRoom = large;
  await climate(desktop.page, 'clear');
  await screenshot(desktop.page, 'sunlight-desktop-large.png');
  report.checks.push('large connected-room architecture has the same safe surface separation');
  await desktop.page.evaluate(() => window.__scene.dispose());
  await desktop.context.close();

  const mobile = await boot(true, 'reduce');
  const small = await inspectPerimeter(mobile.page);
  checkGeometry(small, 'mobile/room-01');
  report.geometry.mobile = small;
  const mobileClear = await climate(mobile.page, 'clear');
  await screenshot(mobile.page, 'sunlight-mobile-clear.png');
  const mobileRain = await climate(mobile.page, 'rain', 60);
  await screenshot(mobile.page, 'sunlight-mobile-rain.png');
  assert.ok(mobileClear.sunIntensity > mobileRain.sunIntensity + 0.5);
  assert.equal(mobileClear.glError, 0);
  assert.equal(mobileRain.glError, 0);
  assert.equal(mobileRain.sunlightMask.noemaSunTime, 0, 'reduced motion freezes cloud shadow travel');
  assert.ok(mobileClear.stateUnchanged && mobileRain.stateUnchanged);
  const motion = await mobile.page.evaluate(() => ({
    rain: window.__scene.atmosphere.rain.visible,
    leaves: window.__scene.atmosphere.fallingLeaves.visible,
  }));
  assert.deepEqual(motion, { rain: false, leaves: false });
  report.scenes.push({ view: 'mobile/reduced-motion', clear: mobileClear, rain: mobileRain });
  report.checks.push('mobile balanced reduced-motion view retains weather lighting and clear geometry while particles stay disabled');
  const cleanup = await mobile.page.evaluate(() => {
    const renderer = window.__scene.renderer;
    window.__scene.dispose();
    return { ...renderer.info.memory };
  });
  assert.equal(cleanup.geometries, 0);
  assert.equal(cleanup.textures, 0);
  report.cleanup = cleanup;
  report.checks.push('disposing the view releases all geometry and texture resources');
  await mobile.context.close();
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await browser.close();
  await writeFile(new URL('render-sunlight.json', destination), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
