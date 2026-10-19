export interface DuelAtmosphereSound {
  rain: number;
  wind: number;
  visible: boolean;
  enabled: boolean;
}

export interface DuelAmbienceSnapshot extends DuelAtmosphereSound {
  audible: boolean;
  disposed: boolean;
  contextState: AudioContextState;
}

const unit = (value: number): number => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

/** Local ambience only. The caller owns unlocking, resuming and closing its AudioContext. */
export class DuelAmbienceAudio {
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly master: GainNode;
  private readonly wind: GainNode;
  private readonly leaves: GainNode;
  private readonly rain: GainNode;
  private readonly windFilter: BiquadFilterNode;
  private readonly leavesFilter: BiquadFilterNode;
  private readonly windSwell: GainNode;
  private readonly leavesSwell: GainNode;
  private atmosphere: DuelAtmosphereSound = { rain: 0, wind: 0, visible: false, enabled: false };
  private disposed = false;

  constructor(private readonly context: AudioContext) {
    const own = <T extends AudioNode>(node: T): T => { this.nodes.push(node); return node; };
    this.master = own(context.createGain());
    this.master.gain.value = 0;
    this.master.connect(context.destination);

    // All three voices share one small buffer. Different offsets avoid correlated hiss.
    // The seeded seamless loop requires no downloads, worklets or frame callbacks.
    const buffer = context.createBuffer(1, Math.round(context.sampleRate * 4), context.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 0x4455454c;
    for (let index = 0; index < data.length; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[index] = seed / 2147483648 - 1;
    }

    const voice = (offset: number): AudioBufferSourceNode => {
      const source = own(context.createBufferSource());
      source.buffer = buffer; source.loop = true;
      this.sources.push(source);
      source.start(context.currentTime, offset);
      return source;
    };
    const filter = (type: BiquadFilterType, frequency: number, q = 0.707): BiquadFilterNode => {
      const node = own(context.createBiquadFilter());
      node.type = type; node.frequency.value = frequency; node.Q.value = q;
      return node;
    };
    const gain = (value: number): GainNode => {
      const node = own(context.createGain()); node.gain.value = value; return node;
    };

    const windHigh = filter('highpass', 55);
    this.windFilter = filter('lowpass', 360);
    this.wind = gain(0);
    voice(0).connect(windHigh).connect(this.windFilter).connect(this.wind).connect(this.master);

    this.leavesFilter = filter('bandpass', 2000, 0.55);
    this.leaves = gain(0);
    voice(1.37).connect(this.leavesFilter).connect(this.leaves).connect(this.master);

    const rainHigh = filter('highpass', 1100);
    const rainLow = filter('lowpass', 6500);
    this.rain = gain(0);
    voice(2.71).connect(rainHigh).connect(rainLow).connect(this.rain).connect(this.master);

    // Slow independent swells make foliage breathe with the breeze rather than hum.
    const gust = own(context.createOscillator()); gust.type = 'sine'; gust.frequency.value = 0.13;
    this.windSwell = gain(0);
    gust.connect(this.windSwell).connect(this.wind.gain);
    this.sources.push(gust); gust.start();
    const flutter = own(context.createOscillator()); flutter.type = 'sine'; flutter.frequency.value = 0.37;
    this.leavesSwell = gain(0);
    flutter.connect(this.leavesSwell).connect(this.leaves.gain);
    this.sources.push(flutter); flutter.start();
  }

  update(atmosphere: DuelAtmosphereSound): void {
    if (this.disposed) return;
    this.atmosphere = {
      rain: unit(atmosphere.rain), wind: unit(atmosphere.wind),
      visible: atmosphere.visible, enabled: atmosphere.enabled,
    };
    const { rain, wind, visible, enabled } = this.atmosphere;
    const now = this.context.currentTime;
    const target = (parameter: AudioParam, value: number, time = 0.7): void => {
      parameter.cancelScheduledValues(now);
      parameter.setTargetAtTime(value, now, time);
    };
    // Mute at the shared output, including modulation. Gameplay sounds use another path.
    target(this.master.gain, visible && enabled ? 1 : 0, visible && enabled ? 0.45 : 0.025);
    target(this.wind.gain, wind * 0.024);
    target(this.windSwell.gain, wind * 0.008);
    target(this.leaves.gain, wind * 0.0095 * (1 - rain * 0.28));
    target(this.leavesSwell.gain, wind * 0.0035 * (1 - rain * 0.28));
    target(this.rain.gain, rain * 0.025, 0.9);
    target(this.windFilter.frequency, 260 + wind * 380, 1.2);
    target(this.leavesFilter.frequency, 1400 + wind * 1100, 1.2);
  }

  getSnapshot(): DuelAmbienceSnapshot {
    return {
      ...this.atmosphere,
      audible: !this.disposed && this.atmosphere.enabled && this.atmosphere.visible && this.context.state === 'running',
      disposed: this.disposed, contextState: this.context.state,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.master.gain.cancelScheduledValues(this.context.currentTime);
    this.master.gain.value = 0;
    for (const source of this.sources) {
      try { source.stop(); } catch { /* Context may already have been closed by its owner. */ }
    }
    for (const node of this.nodes) node.disconnect();
    this.sources.length = 0; this.nodes.length = 0;
  }
}
