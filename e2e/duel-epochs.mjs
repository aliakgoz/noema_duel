import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const report = { checks: [], errors: [] };
await mkdir('artifacts/duel', { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: .5 });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(process.env.BASE_URL ?? 'http://127.0.0.1:5174', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-learning-ready="true"]').waitFor();
    await page.evaluate(() => window.__DUEL__?.pausePresentation(true));
    const input = page.getByRole('spinbutton', { name: 'Eğitim tur sayısı' });
    assert.equal(await input.inputValue(), '1');
    const decrease = page.getByRole('button', { name: 'Tur sayısını azalt' });
    const increase = page.getByRole('button', { name: 'Tur sayısını artır' });
    assert.equal(await decrease.isDisabled(), true);
    await increase.click(); assert.equal(await input.inputValue(), '2');
    await decrease.click(); assert.equal(await input.inputValue(), '1');
    await input.fill('500'); assert.equal(await increase.isDisabled(), true);
    await input.fill('1');
    const panel = page.locator('.learning-panel');
    const layout = await page.evaluate(() => {
      const controls = document.querySelector('.training-controls'), stepper = document.querySelector('.epoch-stepper'), button = controls.querySelector('.train-button');
      const bounds = element => { const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, height: box.height }; };
      const style = getComputedStyle(stepper.querySelector('input'));
      return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, controls: bounds(controls), stepper: bounds(stepper), button: bounds(button), font: style.fontFamily, color: style.color, background: getComputedStyle(stepper).backgroundColor };
    });
    assert.ok(layout.documentWidth <= width + 1, `no overflow at ${width}: ${JSON.stringify(layout)}`);
    assert.ok(layout.stepper.right + 4 <= layout.button.x, `training controls do not collide at ${width}: ${JSON.stringify(layout)}`);
    assert.ok(layout.controls.right <= width, `controls fit at ${width}`);
    assert.ok(layout.button.right <= layout.controls.right + 1, `button stays inside its panel at ${width}`);
    assert.ok(Math.abs(layout.button.height - layout.stepper.height) < 2, `training controls share the same height at ${width}`);
    assert.ok(layout.font.includes('Manrope'));
    assert.ok(layout.stepper.height >= 36 && layout.stepper.height <= 40);
    await panel.screenshot({ path: `artifacts/duel/training-controls-${width}.png` });
    report.checks.push({ width, defaultEpochs: 1, stepperBounds: true, layout });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.passed = false; report.failure = error.message; process.exitCode = 1;
} finally {
  await writeFile('artifacts/duel/epochs.json', JSON.stringify(report, null, 2));
  await browser.close(); console.log(JSON.stringify(report, null, 2));
}
