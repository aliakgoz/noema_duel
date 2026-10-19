import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const destination = new URL('../artifacts/e2e/', import.meta.url);
await mkdir(destination, { recursive: true });
const report = { checks: [], errors: [], views: [] };
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 530 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  await page.route('**/src/main.tsx', route => route.fulfill({ contentType: 'application/javascript', body: 'export {};' }));
  await page.goto(process.env.BASE_URL ?? 'http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { document.body.innerHTML = '<div id="host" style="position:fixed;inset:0"></div>'; document.body.style.margin = '0'; });
  await page.addScriptTag({ type: 'module', content: `
    import * as THREE from '/node_modules/.vite/deps/three.js';
    import { GameScene } from '/src/render/GameScene.ts';
    import { createState } from '/src/core/engine.ts';
    import { LEVELS } from '/src/core/levels.ts';
    window.__THREE = THREE; window.__createState = createState;
    window.__levels = LEVELS;
    window.__scene = new GameScene(document.querySelector('#host'), createState(LEVELS[0]), { quality: 'balanced' });
    window.__scene.setTrainingPaused(true); window.__scene.setWeather('clear');
    window.__ready = true;
  ` });
  await page.waitForFunction(() => window.__ready);
  const rooms = await page.evaluate(() => [...new Set([
    0, 10, 48,
    window.__levels.indexOf(window.__levels.reduce((a, b) => a.width * a.height > b.width * b.height ? a : b)),
  ])]);
  for (const viewport of [{ width: 390, height: 530 }, { width: 604, height: 268 }]) {
    await page.setViewportSize(viewport);
    for (const room of rooms) {
      for (const view of [0, 1, 2]) {
        const result = await page.evaluate(({ room, view }) => {
          const scene = window.__scene, level = window.__levels[room], THREE = window.__THREE;
          scene.update(window.__createState(level)); scene.resize();
          const before = JSON.stringify(scene.state);
          scene.setCameraView(view);
          const points = [];
          // The playable envelope includes walls and the complete robot height.
          for (const x of [-level.width / 2, level.width / 2])
            for (const z of [-level.height / 2, level.height / 2])
              for (const y of [0, 1.8]) {
                const p = new THREE.Vector3(x, y, z).project(scene.camera);
                points.push({ x: p.x, y: p.y, z: p.z });
              }
          return { room: level.id, view, points, stateUnchanged: before === JSON.stringify(scene.state),
            position: scene.camera.position.toArray(), drawCalls: scene.renderer.info.render.calls };
        }, { room, view });
        assert.equal(result.stateUnchanged, true, 'changing the camera cannot mutate the puzzle');
        assert.ok(result.points.every(p => Math.abs(p.x) < 0.98 && Math.abs(p.y) < 0.98 && Math.abs(p.z) < 1), `clipped court: ${JSON.stringify(result)}`);
        report.views.push({ ...result, viewport });
        if (room === 10 && viewport.width === 390 && process.env.NO_SCREENSHOTS !== '1') {
          await page.screenshot({ path: fileURLToPath(new URL(`camera-mobile-${view + 1}.png`, destination)) });
        }
      }
    }
  }
  assert.ok(report.views[0].position[0] > 0 && report.views[1].position[0] < 0, 'the two diagonal views observe different sides');
  assert.ok(report.views[2].position[1] > report.views[0].position[1], 'the overhead view exposes more of the floor');
  report.checks.push('all three views keep the entire playable envelope visible in small and connected rooms, portrait and short landscape');
  report.checks.push('camera changes preserve the complete puzzle state and expose genuinely different sides');
  const disposed = await page.evaluate(() => {
    window.__scene.dispose();
    return { ...window.__scene.renderer.info.memory };
  });
  assert.deepEqual(disposed, { geometries: 0, textures: 0 });
  assert.deepEqual(report.errors, []);
  report.checks.push('city, camera props and scene GPU resources are released on disposal');
  report.passed = true;
  await context.close();
} catch (error) { report.passed = false; report.failure = error.stack ?? String(error); process.exitCode = 1; }
finally {
  await browser.close();
  await writeFile(new URL('camera-views.json', destination), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, views: report.views.map(({ points, ...rest }) => rest) }, null, 2));
}
