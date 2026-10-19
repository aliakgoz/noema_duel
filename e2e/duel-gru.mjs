import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.BASE_URL ?? 'http://127.0.0.1:5174';
await mkdir('artifacts/duel', { recursive: true });
const report = { checks: [], errors: [], inference: null };
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(base);
  await page.locator('[data-testid="duel-app"][data-learning-ready="true"]').waitFor();
  assert.equal(await page.getByTestId('trajectories-toggle').count(), 0);
  assert.equal(await page.locator('[data-testid="gru-model"] .brain-canvas').getAttribute('data-parameter-count'), '77926');
  await page.getByTestId('brain-open').click();
  const dialog = page.getByTestId('brain-dialog'), brain = dialog.locator('.brain-canvas');
  await dialog.waitFor();
  assert.equal(JSON.parse(await brain.getAttribute('data-gru-memory')).length, 96);
  await dialog.getByLabel('GRU nöronlarında gösterilen değer').selectOption('update');
  assert.equal(await brain.getAttribute('data-gate-view'), 'update');
  await dialog.getByRole('button', { name: 'Gerçek model ağırlıklarını göster', exact: true }).click();
  const canvas = dialog.locator('canvas');
  await canvas.focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
  assert.equal(await brain.getAttribute('data-selected-layer'), '3');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await brain.getAttribute('data-selected-layer'), '2');
  await dialog.getByRole('button', { name: 'Model sinyallerini incelemek için görünümü dondur', exact: true }).click();
  assert.equal(await brain.getAttribute('data-frozen'), 'true');
  await page.screenshot({ path: 'artifacts/duel/gru-inspection.png' });
  report.checks.push('real77926 parameters,96 memory cells, gate views, actual weight selection and frozen trace');
  await dialog.getByRole('button', { name: 'Model görünümünü kapat', exact: true }).click();
  await page.getByTestId('duel-canvas').screenshot({ path: 'artifacts/duel/noema-arena.png' });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  report.inference = await page.evaluate(async () => {
    const { createDuelModel, predictDuel, getDuelMemory } = await import('/src/duel/learning.ts');
    const { createDuel } = await import('/src/duel/engine.ts');
    const model = createDuelModel(), state = createDuel();
    for (let i = 0; i < 30; i++) predictDuel(model, state);
    const times = [];
    for (let i = 0; i < 250; i++) { const start = performance.now(); predictDuel(model, state); times.push(performance.now() - start); }
    times.sort((a, b) => a - b);
    return { cpuThrottle: 4, samples: times.length, p50Ms: times[125], p95Ms: times[237], meanMs: times.reduce((a, b) => a + b) / times.length, memoryCells: getDuelMemory(model).length, decisionIntervalMs: 100 };
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  assert.ok(report.inference.p95Ms < 100, 'inference must fit inside the100ms decision interval under4xCPU throttle');
  report.checks.push('real GRU forward pass fits100ms decision interval under4xCPU slowdown; physical phone not measured');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.getByTestId('brain-open').click(); await dialog.waitFor();
  const bounds = await dialog.boundingBox(); assert.ok(bounds.width <= 390);
  await page.screenshot({ path: 'artifacts/duel/gru-mobile.png' });
  assert.deepEqual(report.errors, []); report.passed = true;
} catch (error) { report.passed = false; report.failure = error.stack; process.exitCode = 1; }
finally { await browser.close(); await writeFile('artifacts/duel/gru.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
