import { describe, expect, it } from 'vitest';
import { sampleWeatherTargets } from './weatherCycle';

describe('cosmetic weather clock', () => {
  it('opens partly cloudy, includes strong sunshine, rain and a sunny recovery', () => {
    const start = sampleWeatherTargets(0, 120, 'auto');
    const sunshine = sampleWeatherTargets(22, 120, 'auto');
    const rain = sampleWeatherTargets(60, 120, 'auto');
    const recovery = sampleWeatherTargets(106, 120, 'auto');
    expect(start.cloudCover).toBeGreaterThan(0.3);
    expect(start.sunlight).toBeGreaterThan(0.55);
    expect(sunshine.sunlight).toBeGreaterThan(0.88);
    expect(sunshine.rain).toBe(0);
    expect(rain.rain).toBeGreaterThan(0.8);
    expect(rain.sunlight).toBeLessThan(0.15);
    expect(recovery.sunlight).toBeGreaterThan(0.85);
    expect(recovery.rain).toBe(0);
  });

  it('keeps every seeded duration smooth at its cyclic boundary', () => {
    for (let duration = 112; duration <= 128; duration++) {
      const before = sampleWeatherTargets(duration - 0.001, duration, 'auto');
      const after = sampleWeatherTargets(duration + 0.001, duration, 'auto');
      expect(Math.abs(before.cloudCover - after.cloudCover)).toBeLessThan(0.0001);
      expect(Math.abs(before.sunlight - after.sunlight)).toBeLessThan(0.0001);
      for (let time = 0; time < duration; time += 0.25) {
        const value = sampleWeatherTargets(time, duration, 'auto');
        for (const field of [value.rain, value.cloudCover, value.sunlight]) {
          expect(field).toBeGreaterThanOrEqual(0);
          expect(field).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('manual clear is sunny with a few clouds; manual rain remains overcast', () => {
    for (let time = 0; time < 240; time += 3) {
      const sunny = sampleWeatherTargets(time, 120, 'clear');
      const rainy = sampleWeatherTargets(time, 120, 'rain');
      expect(sunny.rain).toBe(0);
      expect(sunny.cloudCover).toBeGreaterThan(0.08);
      expect(sunny.cloudCover).toBeLessThan(0.14);
      expect(sunny.sunlight).toBeGreaterThan(0.85);
      expect(rainy.rain).toBe(0.88);
      expect(rainy.sunlight).toBeLessThan(0.12);
    }
  });
});
