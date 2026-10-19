import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const result = { baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:5173', errors: [], console: [], steps: [] };
await mkdir(new URL('../artifacts/e2e/', import.meta.url), { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let phase = 'boot';
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', error => result.errors.push({ phase, message: error.message, stack: error.stack }));
  page.on('console', message => { if (['error','warning'].includes(message.type())) result.console.push({ phase, type: message.type(), message: message.text() }); });
  await page.goto(result.baseURL, { waitUntil: 'domcontentloaded' });
  await page.locator('.scene-host canvas').waitFor();
  result.steps.push('real mobile WebGL initialized');
  phase = 'saving';
  await page.waitForFunction(() => document.querySelector('.training-status small')?.textContent?.includes('kaydedildi'));
  result.steps.push('profile hydrated and saved');
  phase = 'scroll workshop controls';
  await page.locator('.workshop-toolbar').scrollIntoViewIfNeeded();
  phase = 'generate visible similar room';
  await page.getByRole('button', { name: 'Benzer bölüm', exact: true }).tap();
  await page.locator('.workshop-toolbar[data-variant="true"]').waitFor();
  await page.waitForFunction(() => document.querySelector('.scene-seed')?.textContent?.includes('AKTARIM'));
  result.steps.push('explicit similar-room command loaded a visible variant');
  await page.waitForTimeout(3500);
  phase = 'screenshot';
  await page.screenshot({ path: new URL('../artifacts/e2e/mobile-regression.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
  result.passed = !result.errors.length;
} catch (error) { result.failure = { phase, stack: error.stack }; result.passed = false; }
finally { await browser.close(); await writeFile(new URL('../artifacts/e2e/mobile-regression.json', import.meta.url), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2)); if (!result.passed) process.exitCode = 1; }
