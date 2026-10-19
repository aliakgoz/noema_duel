import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const directory = new URL('../artifacts/e2e/', import.meta.url);
await mkdir(directory, { recursive: true });
const report = { startedAt: new Date().toISOString(), baseURL, checks: [], errors: [], consoleErrors: [] };
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const vector = async (brain, attribute = 'data-gru-memory') => JSON.parse(await brain.getAttribute(attribute));
function matches(actual, expected) {
  assert.equal(actual.length, 96); assert.equal(expected.length, 96);
  assert(Math.max(...actual.map((value, i) => Math.abs(value - expected[i]))) < 1e-7);
}
function observe(page) {
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(); observe(page); page.setDefaultTimeout(60000);
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.locator('.scene-host canvas').waitFor();
  await page.waitForFunction(() => document.querySelector('.training-status small')?.textContent?.includes('kaydedildi'));
  const compact = page.locator('.brain-canvas--compact');
  assert.equal(await compact.getAttribute('data-parameter-count'), '77926');
  assert.match(await compact.locator('canvas').getAttribute('aria-label'), /96 GRU bellek hücresi/);
  const expected = await page.evaluate(async () => {
    const [{ TinyNetwork }, { createState, step }, { LEVELS }, { encodeObservation }] = await Promise.all([
      import('/src/ml/network.ts'), import('/src/core/engine.ts'), import('/src/core/levels.ts'), import('/src/core/observation.ts'),
    ]);
    const network = new TinyNetwork(42); let state = createState(LEVELS[0]); const history = [], traces = [];
    for (const action of [1, 0, 0]) {
      traces.push(network.predict(encodeObservation(state, history)).trace.recurrent);
      state = step(state, action); history.push(action);
    }
    return traces;
  });
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.learning-count strong')?.textContent === '1');
  matches(await vector(compact), expected[0].memory);
  matches(await vector(compact, 'data-gru-previous'), expected[0].previous);
  await compact.getByRole('button', { name: 'Model sinyallerini incelemek için görünümü dondur' }).click();
  await page.keyboard.press('ArrowUp');
  await page.waitForFunction(() => document.querySelector('.learning-count strong')?.textContent === '2');
  matches(await vector(compact), expected[0].memory);
  await compact.getByRole('button', { name: 'Canlı model görünümüne devam et' }).click();
  matches(await vector(compact), expected[1].memory);
  matches(await vector(compact, 'data-gru-previous'), expected[1].previous);
  report.checks.push('each physical action consumes exactly one GRU step; frozen view holds actual earlier memory');

  await page.getByRole('button', { name: 'Beyni büyüt', exact: true }).click();
  const expanded = page.locator('.brain-modal .brain-gru');
  await expanded.locator('canvas').focus(); await page.keyboard.press('Home');
  assert.equal(await expanded.getAttribute('data-selected-layer'), '2');
  const values = await expanded.locator('.brain-cell-values strong').allTextContents();
  assert.deepEqual(values, ['previous', 'reset', 'update', 'candidate', 'memory'].map(key => expected[1][key][0].toFixed(4)));
  assert.equal(await expanded.locator('.brain-weight-list > span').count(), 5);
  for (const value of ['update', 'reset', 'candidate', 'memory']) {
    await expanded.getByRole('combobox', { name: 'GRU nöronlarında gösterilen değer' }).selectOption(value);
    matches(await vector(expanded), expected[1].memory);
  }
  await expanded.getByRole('button', { name: 'Gerçek model ağırlıklarını göster' }).click();
  assert.equal(await page.locator('.learning-count strong').textContent(), '2');
  report.checks.push('all five genuine GRU cell values and strongest weights inspect correctly; inspection does not consume memory');
  if (process.env.NO_SCREENSHOTS !== '1') await page.screenshot({ path: new URL('gru-brain-desktop.png', directory).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
  await page.getByRole('button', { name: 'Kapat', exact: true }).click();
  await page.keyboard.press('ArrowUp');
  matches(await vector(compact), expected[2].memory);
  await page.getByRole('button', { name: 'Bulmacayı sıfırla', exact: true }).click();
  assert((await vector(compact, 'data-gru-previous')).every(value => value === 0));
  await page.keyboard.press('ArrowRight');
  matches(await vector(compact), expected[0].memory);
  await page.waitForTimeout(700);
  const saved = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('noema-local-v1', 1);
    request.onsuccess = () => { const db = request.result; const read = db.transaction('records').objectStore('records').get('profile-gru96-v3');
      read.onsuccess = () => { resolve(read.result); db.close(); }; read.onerror = () => reject(read.error); };
  }));
  const model = JSON.parse(saved.model);
  assert.equal(model.trainedSteps, 0);
  assert.equal(model.version, 'noema-160-96-gru96-64-6-v3');
  assert.equal(saved.samples.length, 4);
  assert.equal(saved.samples[0].sequenceStart, true); assert.equal(saved.samples[1].sequenceStart, false);
  assert.equal(saved.samples[3].sequenceStart, true);
  assert.notEqual(saved.samples[0].episodeId, saved.samples[3].episodeId);
  report.checks.push('restart resets episode memory, starts a fresh demonstration sequence and preserves the untrained GRU weights');
  await context.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const phone = await mobile.newPage(); observe(phone);
  await phone.goto(baseURL, { waitUntil: 'domcontentloaded' }); await phone.locator('.scene-host canvas').waitFor();
  await phone.getByRole('button', { name: 'Beyni büyüt', exact: true }).click();
  const phoneBrain = phone.locator('.brain-modal .brain-gru');
  await phoneBrain.locator('canvas').focus(); await phone.keyboard.press('Home');
  await phoneBrain.getByRole('combobox').selectOption('reset');
  assert.equal(await phoneBrain.locator('.brain-cell-values strong').count(), 5);
  const layout = await phone.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth,
    drawing: document.querySelector('.brain-modal canvas').getBoundingClientRect().toJSON(),
    detail: document.querySelector('.brain-modal .brain-neuron-detail').getBoundingClientRect().toJSON(),
    note: document.querySelector('.brain-modal .fine-print').getBoundingClientRect().toJSON() }));
  assert(layout.content <= layout.width + 1);
  assert(layout.drawing.width > 200 && layout.drawing.height > 100);
  assert(layout.detail.width > 200);
  assert(layout.note.top >= layout.detail.bottom - 1, 'Cell inspection must not overlap its explanation');
  report.mobileLayout = layout;
  report.checks.push('390x844 mobile GRU visualization and gate/cell inspection fit without horizontal overflow');
  if (process.env.NO_SCREENSHOTS !== '1') await phone.screenshot({ path: new URL('gru-brain-mobile.png', directory).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
  assert.deepEqual(report.errors, []); assert.deepEqual(report.consoleErrors, []);
  report.passed = true;
} catch (error) { report.passed = false; report.failure = String(error.stack ?? error); throw error; }
finally { report.finishedAt = new Date().toISOString(); await writeFile(new URL('gru-brain.json', directory), JSON.stringify(report, null, 2)); await browser.close(); }
