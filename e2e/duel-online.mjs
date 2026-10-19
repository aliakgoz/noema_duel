import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5174';
const server = process.env.DUEL_SERVER_URL ?? 'http://127.0.0.1:8787';
const report = { checks: [], errors: [], entry: null };
await mkdir('artifacts/duel', { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let page;
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: .5 });
  page.setDefaultTimeout(30000); page.on('pageerror', error => report.errors.push(error.message));
  await page.addInitScript(url => localStorage.setItem('noema-duel-server', url), server);
  await page.goto(base);
  await page.locator('[data-testid="duel-app"][data-learning-ready="true"]').waitFor();
  await page.evaluate(() => { window.__DUEL__.pausePresentation(true); window.__DUEL__.pauseSimulation(true); });
  await page.getByTestId('start-match').click();
  await page.getByRole('button', { name: 'Tam ekrandan çık', exact: true }).click();
  await page.locator('.duel-canvas canvas').focus();
  await page.keyboard.down('d'); await page.keyboard.down('Space');
  await page.evaluate(() => window.__DUEL__.advance(2.1));
  await page.keyboard.up('d'); await page.keyboard.up('Space');
  const count = Number((await page.getByTestId('sample-count').textContent()).match(/\d+/)?.[0]); assert.ok(count >= 16);
  await page.locator('.training-drawer>summary').click();
  await page.getByTestId('training-toggle').click();
  assert.equal(await page.locator('#training-epochs').inputValue(), '1');
  await page.getByTestId('train-robot').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="model-status"]')?.textContent.includes('hazır'));
  report.checks.push(`Recorded ${count} real keyboard demonstrations and trained genuine GRU for the default 1 epoch in its actual Worker.`);
  await page.getByRole('navigation', { name: 'Ana menü' }).getByRole('button', { name: 'Online Arena', exact: true }).click();
  await page.locator('.du-online-connection.online').waitFor();
  assert.ok(await page.getByRole('button', { name: 'Modelimi arenaya gönder' }).isEnabled());
  await page.getByLabel('Arena oyuncu adı').fill('UI Duel Smoke');
  const submission = page.waitForResponse(response => response.url().endsWith('/api/duel/submit') && response.request().method() === 'POST', { timeout: 45000 });
  await page.getByRole('button', { name: 'Modelimi arenaya gönder' }).click();
  const response = await submission; assert.equal(response.status(), 200);
  const result = await response.json(); assert.equal(result.entry.total, 3); assert.equal(result.entry.name, 'UI Duel Smoke');
  report.entry = result.entry;
  await page.locator('.du-online-result').waitFor();
  report.checks.push('Explicitly uploaded the actually trained model through the real client/session/server worker route and displayed its real three-round result.');
  await page.screenshot({ path: 'artifacts/duel/online-arena-desktop.png', fullPage: true });
  await page.getByRole('navigation', { name: 'Ana menü' }).getByRole('button', { name: 'Sıralama', exact: true }).click();
  await page.locator('.du-online-connection.online').waitFor();
  await page.locator('.du-online-player strong', { hasText: 'UI Duel Smoke' }).waitFor();
  const boardResponse = await page.request.get(`${server}/api/duel/leaderboard`), board = await boardResponse.json();
  assert.ok(board.entries.some(entry => entry.modelHash === result.entry.modelHash));
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `rankings must fit ${width}px`);
    await page.screenshot({ path: `artifacts/duel/online-rankings-${width}.png`, fullPage: true });
  }
  await page.getByTestId('page-arena').click(); await page.locator('.du-online-connection.online').waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  const modelBox = await page.locator('.du-online-submit').boundingBox(), featureBox = await page.locator('.du-online-feature').boundingBox();
  assert.ok(modelBox.y < featureBox.y, 'model action must precede secondary decorative copy on mobile');
  await page.screenshot({ path: 'artifacts/duel/online-arena-mobile.png', fullPage: true });
  report.checks.push('Real server score appears in Rankings; 360px and 390px layouts have no horizontal overflow; mobile model action precedes the challenge illustration.');
  assert.deepEqual(report.errors, []); report.passed = true;
} catch (error) { report.passed = false; report.failure = error.stack; process.exitCode = 1; if (page) await page.screenshot({ path: 'artifacts/duel/online-failure.png', fullPage: true }).catch(() => {}); }
finally { await writeFile('artifacts/duel/online.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); await browser.close(); }
