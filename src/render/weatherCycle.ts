export interface WeatherTargets {
  rain: number;
  cloudCover: number;
  /** Direct solar transmission: 0 is overcast, 1 is unobstructed warm sun. */
  sunlight: number;
}

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const smooth = (value: number): number => { const x = clamp(value); return x * x * (3 - 2 * x); };
const CLOUD_KEYFRAMES = [
  [0, 0.36], [12, 0.24], [20, 0.09], [28, 0.14], [43, 0.94],
  [72, 0.96], [82, 0.72], [98, 0.23], [108, 0.12],
] as const;

/** A deterministic cosmetic clock, independent of game state and random numbers. */
export function sampleWeatherTargets(elapsed: number, cycleLength: number, mode: 'auto' | 'clear' | 'rain'): WeatherTargets {
  const duration = Number.isFinite(cycleLength) ? Math.max(112, cycleLength) : 120;
  const time = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  const cycle = time % duration;
  let cloudCover = 0.12 + 0.24 * smooth((cycle - 108) / (duration - 108));
  for (let i = 1; i < CLOUD_KEYFRAMES.length; i++) {
    const previous = CLOUD_KEYFRAMES[i - 1], next = CLOUD_KEYFRAMES[i];
    if (cycle <= next[0]) {
      cloudCover = previous[1] + (next[1] - previous[1]) * smooth((cycle - previous[0]) / (next[0] - previous[0]));
      break;
    }
  }
  let rain = cycle < 43 || cycle > 82 ? 0 : smooth((cycle - 43) / 7) * (1 - smooth((cycle - 72) / 10)) * 0.85;
  if (mode === 'rain') { cloudCover = 0.96; rain = 0.88; }
  if (mode === 'clear') { cloudCover = 0.11 + Math.sin(time * 0.045) * 0.025; rain = 0; }
  // Clouds drift in front of the sun as well as across the background. The
  // periodic term is continuous at the loop seam, unlike an elapsed-time sine.
  const passingCloud = Math.sin(cycle / duration * Math.PI * 8 + 0.7) * 0.10 * cloudCover * (1 - rain);
  const sunlight = clamp((1 - cloudCover * 0.92 - passingCloud) * (1 - rain * 0.28));
  return { rain, cloudCover, sunlight };
}
