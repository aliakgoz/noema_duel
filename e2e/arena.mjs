import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server/index.ts';

const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
const artifacts = new URL('../artifacts/', import.meta.url);
const result = {
  baseURL, startedAt: new Date().toISOString(), checks: [], errors: [], consoleErrors: [],
  apiRequests: [], apiResponses: [], passed: false,
};
let browser;
let arena;
let listener;
await mkdir(artifacts, { recursive: true });

try {
  arena = await createServer({
    storageDirectory: fileURLToPath(new URL('arena-test-data/', artifacts)),
    allowedOrigins: [new URL(baseURL).origin],
  });
  listener = arena.app.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  assert.ok(address && typeof address !== 'string');
  const arenaURL = `http://127.0.0.1:${address.port}`;
  result.arenaURL = arenaURL;
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const context = await browser.newContext({ viewport: { width: 1365, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.on('pageerror', error => result.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') result.consoleErrors.push(message.text()); });
  page.on('request', request => {
    if (!request.url().startsWith(arenaURL)) return;
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST') {
      const data = request.postDataJSON();
      result.apiRequests.push({
        path, method: request.method(),
        hasBearer: /^Bearer [A-Za-z0-9_-]{43}$/.test(request.headers().authorization ?? ''),
        bodyKeys: Object.keys(data ?? {}).sort(),
      });
    }
  });
  page.on('response', response => {
    if (response.url().startsWith(arenaURL)) result.apiResponses.push({ path: new URL(response.url()).pathname, status: response.status() });
  });
  await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('.scene-host canvas').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('.training-status small')?.textContent?.includes('kaydedildi'), null, { timeout: 60000 });
  assert.equal(await page.locator('.world-header h2').textContent(), 'İlk Adımlar');
  result.checks.push('final production UI initialized with the first actual puzzle');

  await page.locator('.sidebar-settings').click();
  await page.locator('.settings-label input').fill('ArenaQA');
  await page.getByRole('button', { name: 'Kapat', exact: true }).click();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowRight');
  assert.match(await page.locator('.world-stats').textContent(), /2\s*HAMLE/);
  assert.equal(await page.locator('.learning-count strong').textContent(), '2');
  await page.getByRole('button', { name: /^Robotuna öğret/ }).click();
  await page.waitForFunction(() => document.querySelector('.version-tag')?.textContent === 'v1', null, { timeout: 60000 });
  await page.waitForTimeout(400);
  result.checks.push('two real key actions became demonstrations and the actual training worker committed model v1');

  await page.locator('.sidebar .nav-item').filter({ hasText: 'Arena' }).click();
  await page.locator('.server-settings summary').click();
  await page.locator('.server-settings input').fill(arenaURL);
  const submission = page.waitForResponse(response => response.url() === `${arenaURL}/api/submit` && response.request().method() === 'POST', { timeout: 60000 });
  await page.getByRole('button', { name: 'ArenaQA modelini gönder', exact: true }).click();
  const response = await submission;
  const payload = await response.json();
  assert.equal(response.status(), 200, JSON.stringify(payload));
  assert.equal(payload.entry.total, 8);
  assert.ok(Number.isInteger(payload.entry.solved) && payload.entry.solved >= 0 && payload.entry.solved <= 8);
  assert.ok(Number.isInteger(payload.entry.moves) && payload.entry.moves >= 0 && payload.entry.moves <= 1280);
  assert.match(payload.entry.modelHash, /^[a-f0-9]{64}$/);
  await page.waitForFunction(() => document.querySelector('.arena-status')?.textContent?.includes('Sonuç sunucuda hesaplandı'), null, { timeout: 60000 });
  const row = page.locator('.leaderboard-row').filter({ hasText: payload.entry.modelHash.slice(0, 10) });
  await row.first().waitFor({ state: 'visible' });
  assert.match(await row.first().innerText(), /ArenaQA/);
  assert.ok((await row.first().innerText()).includes(`${payload.entry.solved}/8`));
  result.checks.push('real authenticated arena submission executed the learned fixed model in the server worker and rendered the eight-puzzle result');

  result.session = await page.evaluate(base => {
    const stored = localStorage.getItem(`noema-arena-session:${base}`);
    const session = stored ? JSON.parse(stored) : null;
    return {
      present: Boolean(session), tokenFormatValid: /^[A-Za-z0-9_-]{43}$/.test(session?.token ?? ''),
      tokenLength: session?.token?.length ?? 0, playerIdPresent: typeof session?.playerId === 'string', name: session?.name,
    };
  }, arenaURL);
  assert.equal(result.session.present, true);
  assert.equal(result.session.tokenFormatValid, true);
  assert.equal(result.session.playerIdPresent, true);
  assert.equal(result.session.name, 'ArenaQA');
  assert.ok(result.apiRequests.some(request => request.path === '/api/session' && !request.hasBearer));
  const submitRequest = result.apiRequests.find(request => request.path === '/api/submit');
  assert.ok(submitRequest?.hasBearer, 'UI submission sends the guest bearer token');
  assert.deepEqual(submitRequest.bodyKeys, ['model', 'name'], 'The UI sends model weights and name without a client score');
  result.checks.push('guest session persists locally; bearer authentication is present; no client score is submitted');
  result.entry = payload.entry;
  result.challengeDay = payload.challengeDay;
  result.leaderboardRows = await page.locator('.leaderboard-row').count();
  assert.deepEqual(result.errors, [], 'No uncaught browser exceptions');
  result.passed = true;
} catch (error) {
  result.failure = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (listener) {
    listener.closeAllConnections();
    await new Promise(resolveClose => listener.close(() => resolveClose()));
  }
  if (arena) await arena.close();
  result.finishedAt = new Date().toISOString();
  await writeFile(new URL('arena-ui.json', artifacts), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
