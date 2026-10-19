let context: AudioContext | undefined;
let enabled = true;
let unlocked = false;
let ambience: { rain: GainNode; wind: GainNode; rustle: GainNode } | undefined;
let atmosphere = { rain: 0, wind: 0, visible: true };

export interface AtmosphereSound { rain?: number; wind?: number; visible?: boolean }
const unit = (value: number): number => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

function makeAmbience(audio: AudioContext): void {
  // One quiet reusable noise source; no network samples, autoplay, or timers.
  const buffer = audio.createBuffer(1, audio.sampleRate * 3, audio.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 0x6e6f656d;
  for (let i = 0; i < data.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; data[i] = seed / 2147483648 - 1; }
  const source = audio.createBufferSource(); source.buffer = buffer; source.loop = true;
  const rainHigh = audio.createBiquadFilter(); rainHigh.type = 'highpass'; rainHigh.frequency.value = 1100;
  const rainLow = audio.createBiquadFilter(); rainLow.type = 'lowpass'; rainLow.frequency.value = 6500;
  const rain = audio.createGain(); rain.gain.value = 0;
  source.connect(rainHigh); rainHigh.connect(rainLow); rainLow.connect(rain); rain.connect(audio.destination);
  const windLow = audio.createBiquadFilter(); windLow.type = 'lowpass'; windLow.frequency.value = 420;
  const wind = audio.createGain(); wind.gain.value = 0;
  source.connect(windLow); windLow.connect(wind); wind.connect(audio.destination);
  const rustleBand = audio.createBiquadFilter(); rustleBand.type = 'bandpass'; rustleBand.frequency.value = 2200; rustleBand.Q.value = 0.55;
  const rustle = audio.createGain(); rustle.gain.value = 0;
  source.connect(rustleBand); rustleBand.connect(rustle); rustle.connect(audio.destination);
  const breeze = audio.createOscillator(); breeze.frequency.value = 0.21;
  const breezeDepth = audio.createGain(); breezeDepth.gain.value = 95;
  breeze.connect(breezeDepth); breezeDepth.connect(windLow.frequency);
  breeze.start(); source.start(); ambience = { rain, wind, rustle };
}

function synchronizeAmbience(): void {
  if (!context || !ambience) return;
  const audible = enabled && atmosphere.visible && !document.hidden;
  const now = context.currentTime;
  ambience.rain.gain.setTargetAtTime(audible ? atmosphere.rain * 0.012 : 0, now, 0.45);
  ambience.wind.gain.setTargetAtTime(audible ? atmosphere.wind * 0.006 : 0, now, 0.6);
  ambience.rustle.gain.setTargetAtTime(audible ? atmosphere.wind * 0.0035 : 0, now, 0.35);
}

function ensureContext(): AudioContext | undefined {
  if (!enabled || typeof document === 'undefined' || document.hidden) return undefined;
  if (!unlocked && !navigator.userActivation?.isActive) return undefined;
  try {
    if (!context || context.state === 'closed') { context = new AudioContext(); makeAmbience(context); }
    unlocked = true;
    if (context.state === 'suspended') void context.resume().catch(() => {});
    synchronizeAmbience(); return context;
  } catch { return undefined; }
}

function unlockAudio(event: Event): void {
  if (!event.isTrusted) return;
  unlocked = true;
  if (!ensureContext()) return;
  document.removeEventListener('pointerdown', unlockAudio, true);
  document.removeEventListener('keydown', unlockAudio, true);
}
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', unlockAudio, { capture: true, passive: true });
  document.addEventListener('keydown', unlockAudio, { capture: true });
  document.addEventListener('visibilitychange', () => {
    if (!context) return;
    if (document.hidden) void context.suspend().catch(() => {});
    else if (enabled && unlocked) { void context.resume().catch(() => {}); synchronizeAmbience(); }
  });
}

export function setSound(value: boolean): void { enabled = value; if (value) ensureContext(); synchronizeAmbience(); }

/** Safe before a gesture: stores levels until the user has unlocked audio. */
export function setAtmosphere(value: AtmosphereSound): void {
  atmosphere = { rain: value.rain === undefined ? atmosphere.rain : unit(value.rain), wind: value.wind === undefined ? atmosphere.wind : unit(value.wind), visible: value.visible ?? atmosphere.visible };
  synchronizeAmbience();
}

export function sound(kind: 'step' | 'interact' | 'success' | 'click' | 'error'): void {
  const audio = ensureContext(); if (!audio) return;
  try {
    const now = audio.currentTime;
    const sequence = kind === 'success' ? [440, 554, 659, 880] : kind === 'interact' ? [660, 880] : kind === 'error' ? [150, 120] : kind === 'click' ? [640] : [160];
    sequence.forEach((frequency, i) => {
      const oscillator = audio.createOscillator(); const gain = audio.createGain();
      oscillator.type = kind === 'step' ? 'sine' : 'triangle'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + i * 0.09); gain.gain.exponentialRampToValueAtTime(kind === 'step' ? 0.016 : 0.035, now + i * 0.09 + 0.01); gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.09 + 0.13);
      oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(now + i * 0.09); oscillator.stop(now + i * 0.09 + 0.15);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    });
  } catch { /* Audio is optional on devices without a usable audio context. */ }
}
