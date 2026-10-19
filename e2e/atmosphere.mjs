import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const destination = new URL('../artifacts/e2e/', import.meta.url);
await mkdir(destination, { recursive: true });
const result = { baseURL, startedAt: new Date().toISOString(), checks: [], errors: [], errorDetails: [], workers: [] };
let phase = 'boot';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const shot = async (page, name) => { phase = name; if (process.env.NO_SCREENSHOTS !== '1') await page.screenshot({ path: new URL(name, destination).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true }); };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  page.on('pageerror', error => { result.errors.push(error.message); result.errorDetails.push({ phase, view: 'desktop', message: error.message, stack: error.stack }); });
  page.on('worker', worker => result.workers.push(worker.url()));
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.locator('.scene-host canvas').waitFor();
  await page.waitForFunction(() => document.querySelector('.training-status small')?.textContent?.includes('kaydedildi'));
  await page.getByRole('button', { name: 'Benzer bölüm', exact: true }).click();
  await page.locator('.workshop-toolbar[data-variant="true"]').waitFor();
  assert.match(await page.locator('.scene-seed').textContent(), /AKTARIM/);
  assert.equal(await page.getByRole('button', { name: 'Asıl düzen', exact: true }).isVisible(), true);
  result.checks.push('explicit under-map command opens a visible similar room before robot playback');
  await page.getByRole('button', { name: '7 koşulda sına', exact: true }).click();
  await page.locator('.transfer-report').waitFor({ timeout: 40_000 });
  assert.equal(await page.locator('.transfer-scores > div').count(), 3);
  assert.equal(await page.locator('.trial-dots i').count(), 7);
  assert.ok(result.workers.some(url => url.includes('transfer.worker')), 'real fixed-policy worker must evaluate');
  result.scores = await page.locator('.transfer-scores > div').allTextContents();
  result.checks.push('seven real policy rollouts report baseline and both transfer conditions separately');
  await page.getByRole('button', { name: 'Bulmacayı sıfırla', exact: true }).click();
  const weather = page.getByRole('button', { name: /^Hava durumunu değiştir/ });
  await weather.click();
  await page.waitForFunction(() => document.querySelector('.weather-pill')?.textContent?.includes('YAĞMUR'));
  await page.waitForTimeout(2500);
  await shot(page, 'desktop-rain.png');
  result.checks.push('rain setting runs in a real WebGL scene');
  await weather.click();
  await page.waitForFunction(() => document.querySelector('.weather-pill small')?.textContent === 'AÇIK');
  await page.waitForFunction(() => document.querySelector('.weather-pill')?.textContent?.includes('GÜNEŞLİ'), null, { timeout: 15_000 });
  await shot(page, 'desktop-wind.png');
  await page.locator('.sidebar .nav-item').filter({ hasText: 'Keşifler' }).click();
  assert.equal(await page.locator('.level-card').count(), 56);
  assert.equal(await page.locator('.chapter-section').count(), 7);
  result.checks.push('56 playable rooms in seven chapters');
  for (const index of [24, 32, 40, 47, 48, 55]) {
    const title = await page.locator('.level-card').nth(index).locator('h3').textContent();
    await page.locator('.level-card').nth(index).click();
    await page.locator('.scene-host canvas').waitFor();
    assert.equal(await page.locator('.scene-error').count(), 0);
    await page.waitForTimeout(700);
    await shot(page, `new-room-${index + 1}.png`);
    result.checks.push(`rendered room ${index + 1}: ${title}`);
    await page.locator('.sidebar .nav-item').filter({ hasText: 'Keşifler' }).click();
  }
  // Replay authored validation certificates through actual UI keys, never robot inference.
  const connectedRooms = [
    { index: 48, actions: [1,0,4,1,1,1,2,1,1,1,4,3,3,3,0,3,4,2,2,2,3,3,3] },
    { index: 55, actions: [0,4,1,1,1,2,2,4,0,1,1,1,0,0,1,2,2,2,0,1,1,1,1,1,4,3,3,3,3,3,3,3,3,0,3,4,1,2,1,1,1,2,4,0,3,3,3,2,2,3,4,2,3,3,3] },
  ];
  for (const room of connectedRooms) {
    await page.locator('.level-card').nth(room.index).click();
    for (const action of room.actions) await page.keyboard.press(['ArrowUp','ArrowRight','ArrowDown','ArrowLeft','e','z'][action]);
    await page.locator('.solved-banner').waitFor({ state: 'visible' });
    await page.waitForTimeout(700);
    await shot(page, `connected-room-${room.index + 1}-solved.png`);
    result.checks.push(`room ${room.index + 1}: actual human key sequence retrieves crates across connected rooms and completes the puzzle`);
    await page.locator('.sidebar .nav-item').filter({ hasText: 'Keşifler' }).click();
  }
  await context.close();
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  phase = 'mobile boot';
  const small = await mobile.newPage(); small.on('pageerror', error => { result.errors.push(error.message); result.errorDetails.push({ phase, view: 'mobile', message: error.message, stack: error.stack }); });
  await small.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await small.locator('.scene-host canvas').waitFor();
  await small.locator('.workshop-toolbar').scrollIntoViewIfNeeded();
  const bounds = await small.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
  assert.ok(bounds.width <= bounds.viewport + 1);
  await small.getByRole('button', { name: 'Benzer bölüm', exact: true }).tap();
  await small.locator('.workshop-toolbar[data-variant="true"]').waitFor();
  assert.match(await small.locator('.scene-seed').textContent(), /AKTARIM/);
  await shot(small, 'mobile-transfer.png');
  result.checks.push('mobile under-map variant controls fit viewport and work with reduced motion');
  assert.deepEqual(result.errors, []);
  result.passed = true;
} catch (error) {
  result.passed = false; result.failure = error.stack ?? String(error); process.exitCode = 1;
} finally {
  result.finishedAt = new Date().toISOString();
  await writeFile(new URL('atmosphere.json', destination), JSON.stringify(result, null, 2));
  await browser.close(); console.log(JSON.stringify(result, null, 2));
}
