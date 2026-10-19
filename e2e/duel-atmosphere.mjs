import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5174';
const artifacts = 'artifacts/duel';
await mkdir(artifacts, { recursive: true });
const report = { checks: [], errors: [], snapshots: {}, passed: false };
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const stage = value => { report.stage = value; console.log(`Atmosphere: ${value}`); };

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => report.errors.push(error.message));
  stage('load real mobile WebGL scene');
  await page.goto(base, { timeout: 60000 });
  await page.locator('[data-testid="duel-app"][data-learning-ready="true"]').waitFor();
  await page.waitForFunction(() => Boolean(window.__DUEL__?.atmosphere()));
  await page.evaluate(() => { window.__DUEL__.pausePresentation(true); window.__DUEL__.pauseSimulation(true); });
  assert.equal(await page.getByTestId('duel-app').getAttribute('data-page'), 'workshop');
  assert.equal(await page.getByTestId('weather-toggle').getAttribute('data-weather'), 'auto');

  const atmosphere = () => page.evaluate(() => window.__DUEL__.atmosphere());
  const advanceWeather = seconds => page.evaluate(value => window.__DUEL__.advanceAtmosphere(value), seconds);
  const readAudio = () => page.evaluate(() => window.__DUEL__.ambienceAudio());
  const screenshot = async name => {
    // Capture genuine WebGL, then stop repeated SwiftShader frames between UI checks.
    await page.getByTestId('duel-canvas').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.__DUEL__.pausePresentation(false));
    await page.waitForTimeout(200);
    await page.getByTestId('duel-canvas').screenshot({ path: `${artifacts}/weather-${name}.png`, timeout: 30000 });
    await page.evaluate(() => window.__DUEL__.pausePresentation(true));
  };

  stage('clear sky transition');
  await page.getByTestId('weather-toggle').click();
  await advanceWeather(8);
  const clear = await atmosphere(); report.snapshots.clear = clear;
  assert.equal(clear.mode, 'clear'); assert.equal(clear.phase, 'clear');
  assert.ok(clear.rain < .02); assert.ok(clear.sunlight > .85);
  await screenshot('clear');
  report.checks.push('real weather button selects clear; scene smoothly reaches sunshine and almost no rain');

  stage('rain and wet floor transition');
  const stateBeforeWeather = await page.evaluate(() => window.__DUEL__.state());
  await page.getByTestId('weather-toggle').click();
  await advanceWeather(8);
  const rain = await atmosphere(); report.snapshots.rain = rain;
  assert.equal(rain.mode, 'rain'); assert.equal(rain.phase, 'rain');
  assert.ok(rain.rain > .8); assert.ok(rain.wetness > .65);
  assert.ok(rain.cloudCover > clear.cloudCover + .5);
  assert.ok(rain.sunlight < clear.sunlight - .5);
  assert.deepEqual(await page.evaluate(() => window.__DUEL__.state()), stateBeforeWeather, 'cosmetic weather must not mutate simulation state');
  await screenshot('rain');
  report.checks.push('rain increases cloud cover and floor wetness, lowers sunshine and leaves combat state unchanged');

  stage('unlock real browser audio');
  await page.getByRole('button', { name: 'Sesi aç', exact: true }).click();
  await page.waitForFunction(() => window.__DUEL__?.ambienceAudio()?.audible === true);
  const audio = await readAudio(); report.snapshots.audioRain = audio;
  assert.equal(audio.contextState, 'running'); assert.equal(audio.enabled, true); assert.equal(audio.visible, true);
  assert.ok(audio.rain > .75); assert.ok(audio.wind > 0);
  report.checks.push('trusted sound-button click unlocks actual AudioContext; rain and wind drive audible local ambience');

  stage('record manual movement for persistence check');
  await page.getByTestId('start-match').click();
  await page.getByRole('button', { name: 'Tam ekrandan çık', exact: true }).click();
  await page.getByTestId('duel-canvas').locator('canvas').focus();
  await page.keyboard.down('d');
  await page.evaluate(() => window.__DUEL__.advance(.8));
  await page.keyboard.up('d');
  await page.waitForFunction(() => parseInt(document.querySelector('[data-testid="sample-count"]')?.textContent ?? '0', 10) >= 6);
  const sampleCount = await page.getByTestId('sample-count').textContent();
  assert.ok(parseInt(sampleCount, 10) >= 6);
  const original = await page.evaluate(() => window.__DUEL__.state());
  const parameterCount = await page.locator('[data-testid="gru-model"] .brain-canvas').getAttribute('data-parameter-count');
  assert.equal(parameterCount, '77926'); assert.ok(original.time >= .7);

  stage('visit online arena and rankings');
  await page.getByTestId('page-arena').click();
  await page.waitForFunction(() => window.__DUEL__?.ambienceAudio()?.visible === false);
  assert.equal(await page.getByTestId('duel-app').getAttribute('data-page'), 'arena');
  assert.equal((await readAudio()).audible, false); assert.equal((await readAudio()).enabled, true);
  const paused = await page.evaluate(() => window.__DUEL__.state());
  assert.equal(paused.phase, 'paused'); assert.equal(paused.time, original.time);
  assert.deepEqual(paused.robots, original.robots); assert.deepEqual(paused.crates, original.crates);
  await page.getByTestId('page-rankings').click();
  assert.equal(await page.getByTestId('duel-app').getAttribute('data-page'), 'rankings');
  assert.equal((await readAudio()).audible, false);
  assert.deepEqual(await page.evaluate(() => window.__DUEL__.state()), paused);

  stage('return to unchanged workshop with ambience restored');
  await page.getByTestId('page-workshop').click();
  await page.waitForFunction(() => window.__DUEL__?.ambienceAudio()?.audible === true);
  await page.evaluate(() => window.__DUEL__.pausePresentation(true));
  assert.equal(await page.getByTestId('duel-app').getAttribute('data-page'), 'workshop');
  assert.equal(await page.getByTestId('sample-count').textContent(), sampleCount);
  assert.equal(await page.locator('[data-testid="gru-model"] .brain-canvas').getAttribute('data-parameter-count'), parameterCount);
  assert.deepEqual(await page.evaluate(() => window.__DUEL__.state()), paused);
  assert.equal(await page.getByRole('button', { name: 'Sesi kapat', exact: true }).getAttribute('aria-pressed'), 'true');
  report.snapshots.returnAudio = await readAudio();
  report.checks.push('workshop → arena → rankings → workshop preserves match, manual samples and GRU; online tabs mute ambience and workshop restores sound setting');

  stage('explicit mute and automatic weather');
  await page.getByRole('button', { name: 'Sesi kapat', exact: true }).click();
  assert.equal((await readAudio()).audible, false); assert.equal((await readAudio()).enabled, false);
  await page.getByTestId('weather-toggle').click();
  await advanceWeather(8);
  report.snapshots.auto = await atmosphere();
  assert.equal(report.snapshots.auto.mode, 'auto');
  report.checks.push('sound-off keeps ambience muted; weather button completes auto → clear → rain → auto cycle');
  assert.deepEqual(report.errors, []);
  report.passed = true; stage('passed');
} catch (error) {
  report.failure = error.stack ?? String(error); process.exitCode = 1;
} finally {
  await writeFile(`${artifacts}/atmosphere.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
