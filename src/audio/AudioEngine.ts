/**
 * Procedural audio. Every sound — engine, turbo, tyres, horn, impacts and the
 * Mumbai street ambience — is synthesised with the Web Audio API, so the game
 * ships no recorded samples and has no audio licensing constraints.
 *
 * Browsers only allow audio after a user gesture: call unlock() from a click.
 */
import type { Settings } from '../core/settings';

export interface EngineSoundState {
  rpm: number;
  throttle: number;
  boost: number;
  speed: number;
  squeal: number;
  gear: number;
  onDeck: boolean;
}

export interface AmbienceState {
  sea: number;
  traffic: number;
  night: number;
  rain: number;
}

function makeNoiseBuffer(ctx: AudioContext, seconds: number, brown = false): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w;
  }
  return buf;
}

function softClipCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return curve;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineBus!: GainNode;
  private fxBus!: GainNode;
  private ambBus!: GainNode;
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  private settings: Settings | null = null;
  private driving = false;
  private paused = false;

  // Engine voice.
  private oscs: OscillatorNode[] = [];
  private oscMult: number[] = [];
  private engFilter!: BiquadFilterNode;
  private engGain!: GainNode;
  private intakeFilter!: BiquadFilterNode;
  private intakeGain!: GainNode;
  private turbo!: OscillatorNode;
  private turboGain!: GainNode;
  private squealGain!: GainNode;
  private squealFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private hornGain!: GainNode;
  private lastBoost = 0;
  private lastGear = 1;

  // Ambience.
  private seaGain!: GainNode;
  private trafficGain!: GainNode;
  private rainGain!: GainNode;
  private nextHornAt = 0;
  private nextCrowAt = 0;
  private nextThunderAt = 0;

  async unlock(): Promise<boolean> {
    try {
      if (!this.ctx) this.init();
      if (this.ctx!.state === 'suspended') await this.ctx!.resume();
      return this.ctx!.state === 'running';
    } catch (err) {
      console.warn('Audio unavailable', err);
      return false;
    }
  }

  get running(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  private init(): void {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.noise = makeNoiseBuffer(ctx, 2);
    this.brown = makeNoiseBuffer(ctx, 4, true);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.connect(comp).connect(ctx.destination);
    this.engineBus = ctx.createGain();
    this.fxBus = ctx.createGain();
    this.ambBus = ctx.createGain();
    for (const b of [this.engineBus, this.fxBus, this.ambBus]) b.connect(this.master);
    this.buildEngine();
    this.buildAmbience();
    if (this.settings) this.applySettings(this.settings);
    this.engineBus.gain.value = 0;
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  private loopNoise(buf = this.noise): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.start();
    return src;
  }

  private buildEngine(): void {
    const ctx = this.ctx!;
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClipCurve(2.2);
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.Q.value = 1.4;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0.0;
    const mix = ctx.createGain();
    mix.gain.value = 0.32;
    const defs: [OscillatorType, number, number][] = [
      ['sawtooth', 1, 0.55],
      ['square', 0.5, 0.35],
      ['sawtooth', 2.005, 0.22],
      ['triangle', 3, 0.12],
    ];
    for (const [type, mult, gain] of defs) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 45 * mult;
      this.oscMult.push(mult);
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(mix);
      o.start();
      this.oscs.push(o);
    }
    mix.connect(shaper).connect(this.engFilter).connect(this.engGain).connect(this.engineBus);

    // Intake / exhaust roar: band-passed noise that follows the firing frequency.
    this.intakeFilter = ctx.createBiquadFilter();
    this.intakeFilter.type = 'bandpass';
    this.intakeFilter.Q.value = 1.2;
    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0;
    this.loopNoise().connect(this.intakeFilter).connect(this.intakeGain).connect(this.engineBus);

    // Turbo whistle.
    this.turbo = ctx.createOscillator();
    this.turbo.type = 'sine';
    this.turbo.frequency.value = 2500;
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turbo.connect(this.turboGain).connect(this.engineBus);
    this.turbo.start();

    // Tyre squeal.
    this.squealFilter = ctx.createBiquadFilter();
    this.squealFilter.type = 'bandpass';
    this.squealFilter.frequency.value = 1100;
    this.squealFilter.Q.value = 9;
    const sq2 = ctx.createBiquadFilter();
    sq2.type = 'peaking';
    sq2.frequency.value = 1700;
    sq2.gain.value = 10;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 7;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain).connect(this.squealFilter.frequency);
    lfo.start();
    this.loopNoise().connect(this.squealFilter).connect(sq2).connect(this.squealGain).connect(this.fxBus);

    // Wind / road noise.
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 400;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.loopNoise(this.brown).connect(this.windFilter).connect(this.windGain).connect(this.fxBus);

    // Horn: two detuned squares through a band-pass (classic dual-tone).
    this.hornGain = ctx.createGain();
    this.hornGain.gain.value = 0;
    const hornFilter = ctx.createBiquadFilter();
    hornFilter.type = 'bandpass';
    hornFilter.frequency.value = 900;
    hornFilter.Q.value = 0.9;
    for (const f of [415, 523]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(hornFilter);
      o.start();
    }
    hornFilter.connect(this.hornGain).connect(this.fxBus);
  }

  private buildAmbience(): void {
    const ctx = this.ctx!;
    // Distant traffic rumble.
    const tf = ctx.createBiquadFilter();
    tf.type = 'lowpass';
    tf.frequency.value = 320;
    this.trafficGain = ctx.createGain();
    this.trafficGain.gain.value = 0;
    this.loopNoise(this.brown).connect(tf).connect(this.trafficGain).connect(this.ambBus);
    // Sea waves: low-passed noise with a slow swell.
    const sf = ctx.createBiquadFilter();
    sf.type = 'lowpass';
    sf.frequency.value = 650;
    const swell = ctx.createGain();
    swell.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.12;
    const lg = ctx.createGain();
    lg.gain.value = 0.45;
    lfo.connect(lg).connect(swell.gain);
    lfo.start();
    this.seaGain = ctx.createGain();
    this.seaGain.gain.value = 0;
    this.loopNoise().connect(sf).connect(swell).connect(this.seaGain).connect(this.ambBus);
    // Monsoon rain.
    const rh = ctx.createBiquadFilter();
    rh.type = 'highpass';
    rh.frequency.value = 900;
    const rl = ctx.createBiquadFilter();
    rl.type = 'lowpass';
    rl.frequency.value = 7000;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    this.loopNoise().connect(rh).connect(rl).connect(this.rainGain).connect(this.ambBus);
  }

  applySettings(s: Settings): void {
    this.settings = s;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.masterVolume, t, 0.05);
    this.engineBus.gain.setTargetAtTime(this.driving && !this.paused ? s.engineVolume : 0, t, 0.08);
    this.fxBus.gain.setTargetAtTime(this.paused ? 0 : s.effectsVolume, t, 0.08);
    this.ambBus.gain.setTargetAtTime(s.ambienceVolume * (this.paused ? 0.35 : 1), t, 0.2);
  }

  startDrive(): void {
    this.driving = true;
    this.paused = false;
    if (this.settings) this.applySettings(this.settings);
  }

  stopDrive(): void {
    this.driving = false;
    this.horn(false);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engineBus.gain.setTargetAtTime(0, t, 0.1);
    this.squealGain.gain.setTargetAtTime(0, t, 0.05);
    this.windGain.gain.setTargetAtTime(0, t, 0.1);
    this.seaGain.gain.setTargetAtTime(0, t, 0.3);
    this.rainGain.gain.setTargetAtTime(0, t, 0.3);
    this.trafficGain.gain.setTargetAtTime(0, t, 0.3);
  }

  setPaused(p: boolean): void {
    this.paused = p;
    if (p) this.horn(false);
    if (this.settings) this.applySettings(this.settings);
  }

  toggleMute(): boolean {
    if (!this.settings) return false;
    return !this.settings.muted;
  }

  updateEngine(s: EngineSoundState): void {
    const ctx = this.ctx;
    if (!ctx || !this.driving) return;
    const t = ctx.currentTime;
    const fire = (s.rpm / 60) * 3;
    this.oscs.forEach((o, i) => o.frequency.setTargetAtTime(fire * this.oscMult[i], t, 0.025));
    const load = 0.35 + 0.65 * s.throttle;
    this.engFilter.frequency.setTargetAtTime(260 + s.rpm * 0.32 + s.throttle * 1800, t, 0.05);
    const limiter = s.rpm > 7050 ? 0.55 + 0.45 * Math.sin(t * 90) : 1;
    this.engGain.gain.setTargetAtTime((0.22 + 0.5 * load) * limiter, t, 0.04);
    this.intakeFilter.frequency.setTargetAtTime(fire * 3.5, t, 0.05);
    this.intakeGain.gain.setTargetAtTime(0.03 + s.throttle * 0.16 * (s.rpm / 7000), t, 0.05);
    this.turbo.frequency.setTargetAtTime(1800 + s.boost * 3200 + s.rpm * 0.2, t, 0.1);
    this.turboGain.gain.setTargetAtTime(s.boost * s.throttle * 0.018, t, 0.08);
    // Blow-off valve when the throttle snaps shut under boost.
    if (this.lastBoost > 0.6 && s.throttle < 0.1) this.burst(0.18, 2600, 0.22, 'bandpass', 1.5);
    this.lastBoost = s.throttle > 0.1 ? s.boost : 0;
    if (s.gear !== this.lastGear && s.gear > 0 && this.lastGear > 0) {
      // Shift: a brief dip and a crackle on up-shifts.
      this.engGain.gain.setValueAtTime(this.engGain.gain.value * 0.35, t);
      if (s.gear > this.lastGear) this.burst(0.05, 900, 0.12, 'lowpass', 1);
    }
    this.lastGear = s.gear;
    const v = Math.abs(s.speed);
    this.squealGain.gain.setTargetAtTime(Math.pow(s.squeal, 1.5) * 0.32 * Math.min(1, v / 8), t, 0.04);
    this.squealFilter.frequency.setTargetAtTime(950 + Math.min(600, v * 6), t, 0.1);
    this.windFilter.frequency.setTargetAtTime(200 + v * 22, t, 0.2);
    this.windGain.gain.setTargetAtTime(Math.min(0.5, (v / 70) ** 2 * 0.5) + (s.onDeck ? 0.02 : 0), t, 0.2);
  }

  setAmbience(a: AmbienceState): void {
    const ctx = this.ctx;
    if (!ctx || !this.driving) return;
    const t = ctx.currentTime;
    this.seaGain.gain.setTargetAtTime(a.sea * 0.5, t, 0.5);
    this.trafficGain.gain.setTargetAtTime(0.08 + a.traffic * 0.2, t, 0.5);
    this.rainGain.gain.setTargetAtTime(a.rain * 0.28, t, 0.5);
    if (this.paused) return;
    // Mumbai: somebody is always honking somewhere.
    if (t > this.nextHornAt) {
      this.nextHornAt = t + 1.2 + Math.random() * (5 - a.traffic * 3);
      if (a.traffic > 0.05) this.distantHorn(0.03 + Math.random() * 0.05 * a.traffic);
    }
    if (a.night < 0.5 && a.rain < 0.3 && t > this.nextCrowAt) {
      this.nextCrowAt = t + 6 + Math.random() * 14;
      this.crow();
    }
    if (a.rain > 0.5 && a.night > 0.3 && t > this.nextThunderAt) {
      this.nextThunderAt = t + 18 + Math.random() * 30;
      this.burst(2.5, 120, 0.5, 'lowpass', 0.7);
    }
  }

  horn(on: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.hornGain.gain.setTargetAtTime(on && !this.paused ? 0.2 : 0, ctx.currentTime, 0.015);
  }

  collision(intensity: number): void {
    if (!this.ctx || intensity < 0.05) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this.burst(0.25 + intensity * 0.3, 700, Math.min(0.9, 0.25 + intensity), 'lowpass', 0.8);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(1, intensity), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g).connect(this.fxBus);
    o.start(t);
    o.stop(t + 0.4);
  }

  /** Short UI feedback sounds for menus. */
  ui(kind: 'hover' | 'click' | 'back'): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    const f = kind === 'hover' ? 1400 : kind === 'click' ? 880 : 520;
    o.frequency.setValueAtTime(f, t);
    if (kind === 'click') o.frequency.exponentialRampToValueAtTime(1320, t + 0.06);
    g.gain.setValueAtTime(kind === 'hover' ? 0.025 : 0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'hover' ? 0.05 : 0.12));
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.15);
  }

  private burst(dur: number, freq: number, gain: number, type: BiquadFilterType, q: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = type === 'lowpass' && freq < 200 ? this.brown : this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.fxBus);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private distantHorn(level: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const base = 330 + Math.random() * 380;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 2 - 1;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 800;
    f.Q.value = 0.7;
    const g = ctx.createGain();
    const beeps = 1 + Math.floor(Math.random() * 3);
    g.gain.setValueAtTime(0, t);
    let at = t;
    for (let i = 0; i < beeps; i++) {
      const len = 0.12 + Math.random() * 0.35;
      g.gain.setValueAtTime(level, at);
      g.gain.setValueAtTime(0, at + len);
      at += len + 0.08;
    }
    for (const mult of [1, 1.26]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = base * mult;
      o.connect(f);
      o.start(t);
      o.stop(at + 0.05);
    }
    f.connect(g).connect(pan).connect(this.ambBus);
  }

  private crow(): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    const caws = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < caws; i++) {
      const at = t + i * 0.42;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(620, at);
      o.frequency.exponentialRampToValueAtTime(380, at + 0.22);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1300;
      f.Q.value = 3;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.03, at + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.26);
      o.connect(f).connect(g).connect(pan);
      o.start(at);
      o.stop(at + 0.3);
    }
    pan.connect(this.ambBus);
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
  }
}
