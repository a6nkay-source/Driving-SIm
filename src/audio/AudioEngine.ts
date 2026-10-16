/**
 * Procedural audio. Every sound — engine, turbo, tyres, horn, impacts and the
 * Mumbai street ambience — is synthesised with the Web Audio API, so the game
 * ships no recorded samples and has no audio licensing constraints.
 *
 * Browsers only allow audio after a user gesture: call unlock() from a click.
 */
import type { Settings } from '../core/settings';
import type { EngineProfile, PlayerVehicleId } from '../vehicle/fleet';

interface ProfileDef {
  /** Firing events per crankshaft revolution. */
  fires: number;
  oscs: [OscillatorType, number, number][];
  filter: [number, number, number];
  /** Depth of the per-firing amplitude chop (single-cylinder putt, diesel clatter). */
  chop: number;
  turbo: number;
  limiter: number;
  intake: number;
}

const PROFILES: Record<EngineProfile, ProfileDef> = {
  v6tt: {
    fires: 3,
    oscs: [
      ['sawtooth', 1, 0.55],
      ['square', 0.5, 0.35],
      ['sawtooth', 2.005, 0.22],
      ['triangle', 3, 0.12],
    ],
    filter: [260, 0.32, 1800],
    chop: 0,
    turbo: 1,
    limiter: 7050,
    intake: 1,
  },
  // Auto-rickshaw single: a raspy putt-putt.
  twostroke: {
    fires: 0.5,
    oscs: [
      ['sawtooth', 2, 0.5],
      ['square', 4, 0.32],
      ['sawtooth', 6.03, 0.24],
      ['square', 1, 0.3],
    ],
    filter: [650, 0.3, 1500],
    chop: 0.75,
    turbo: 0,
    limiter: 5500,
    intake: 1.6,
  },
  // Premier Padmini 1.1 L four.
  inline4: {
    fires: 2,
    oscs: [
      ['sawtooth', 1, 0.5],
      ['square', 0.5, 0.3],
      ['sawtooth', 2, 0.22],
      ['triangle', 3, 0.1],
    ],
    filter: [300, 0.28, 1100],
    chop: 0.12,
    turbo: 0,
    limiter: 5300,
    intake: 0.8,
  },
  // BEST bus six-cylinder diesel: low, clattery, a little turbo whistle.
  diesel: {
    fires: 3,
    oscs: [
      ['square', 1, 0.5],
      ['sawtooth', 0.5, 0.45],
      ['square', 2, 0.16],
      ['sawtooth', 4.1, 0.12],
    ],
    filter: [170, 0.24, 650],
    chop: 0.35,
    turbo: 0.35,
    limiter: 2550,
    intake: 0.7,
  },
};

const HORNS: Record<PlayerVehicleId, { f: [number, number]; filter: number; q: number; gain: number }> = {
  gtr: { f: [415, 523], filter: 900, q: 0.9, gain: 0.2 },
  auto: { f: [610, 616], filter: 1500, q: 2.2, gain: 0.16 },
  taxi: { f: [370, 440], filter: 800, q: 1, gain: 0.2 },
  bus: { f: [196, 247], filter: 520, q: 0.8, gain: 0.3 },
};

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
  /** People nearby (0..1): crowd murmur. */
  crowd?: number;
  /** Railway nearby (0..1): local-train rumble. */
  rail?: number;
}

export type HonkKind = 'car' | 'taxi' | 'bus' | 'bus1' | 'auto' | 'bike' | 'truck';

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
  private hornOscs: OscillatorNode[] = [];
  private hornFilter!: BiquadFilterNode;
  private hornLevel = 0.2;
  private chop!: GainNode;
  private chopLfo!: OscillatorNode;
  private chopDepth!: GainNode;
  private profile: ProfileDef = PROFILES.v6tt;
  private profileId: EngineProfile = 'v6tt';
  private hornId: PlayerVehicleId = 'gtr';
  private lastBoost = 0;
  private lastGear = 1;

  // Ambience.
  private seaGain!: GainNode;
  private trafficGain!: GainNode;
  private rainGain!: GainNode;
  private crowdGain!: GainNode;
  private railGain!: GainNode;
  private honkCount = 0;
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
      (o as unknown as { __gain?: GainNode }).__gain = g;
      this.oscs.push(o);
    }
    // Per-firing amplitude chop (the putt of a single, the clatter of a diesel).
    this.chop = ctx.createGain();
    this.chop.gain.value = 1;
    this.chopLfo = ctx.createOscillator();
    this.chopLfo.type = 'square';
    this.chopLfo.frequency.value = 20;
    this.chopDepth = ctx.createGain();
    this.chopDepth.gain.value = 0;
    this.chopLfo.connect(this.chopDepth).connect(this.chop.gain);
    this.chopLfo.start();
    mix.connect(shaper).connect(this.engFilter).connect(this.chop).connect(this.engGain).connect(this.engineBus);

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
      this.hornOscs.push(o);
    }
    this.hornFilter = hornFilter;
    hornFilter.connect(this.hornGain).connect(this.fxBus);
    this.applyProfile();
  }

  /** Switches the engine and horn voice to match the player's vehicle. */
  setVehicle(engine: EngineProfile, horn: PlayerVehicleId): void {
    this.profileId = engine;
    this.hornId = horn;
    this.profile = PROFILES[engine];
    this.applyProfile();
  }

  private applyProfile(): void {
    if (!this.ctx || !this.oscs.length) return;
    const p = PROFILES[this.profileId];
    this.profile = p;
    p.oscs.forEach(([type, mult, gain], i) => {
      const o = this.oscs[i];
      if (!o) return;
      o.type = type;
      this.oscMult[i] = mult;
      const g = (o as unknown as { __gain?: GainNode }).__gain;
      if (g) g.gain.value = gain;
    });
    this.chopDepth.gain.value = p.chop * 0.5;
    this.chop.gain.value = 1 - p.chop * 0.35;
    const h = HORNS[this.hornId];
    this.hornOscs.forEach((o, i) => (o.frequency.value = h.f[i]));
    this.hornFilter.frequency.value = h.filter;
    this.hornFilter.Q.value = h.q;
    this.hornLevel = h.gain;
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
    // Crowd murmur: voice-band noise with a syllabic flutter.
    const c1 = ctx.createBiquadFilter();
    c1.type = 'bandpass';
    c1.frequency.value = 520;
    c1.Q.value = 0.7;
    const c2 = ctx.createBiquadFilter();
    c2.type = 'peaking';
    c2.frequency.value = 1600;
    c2.gain.value = 6;
    const flutter = ctx.createGain();
    flutter.gain.value = 0.6;
    const syl = ctx.createOscillator();
    syl.frequency.value = 3.7;
    const sylDepth = ctx.createGain();
    sylDepth.gain.value = 0.3;
    syl.connect(sylDepth).connect(flutter.gain);
    syl.start();
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0;
    this.loopNoise().connect(c1).connect(c2).connect(flutter).connect(this.crowdGain).connect(this.ambBus);
    // Local-train rumble with the clack of rail joints.
    const rf = ctx.createBiquadFilter();
    rf.type = 'lowpass';
    rf.frequency.value = 180;
    const clack = ctx.createGain();
    clack.gain.value = 0.7;
    const cl = ctx.createOscillator();
    cl.type = 'square';
    cl.frequency.value = 3.1;
    const clDepth = ctx.createGain();
    clDepth.gain.value = 0.3;
    cl.connect(clDepth).connect(clack.gain);
    cl.start();
    this.railGain = ctx.createGain();
    this.railGain.gain.value = 0;
    this.loopNoise(this.brown).connect(rf).connect(clack).connect(this.railGain).connect(this.ambBus);
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
    this.crowdGain.gain.setTargetAtTime(0, t, 0.3);
    this.railGain.gain.setTargetAtTime(0, t, 0.3);
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
    const P = this.profile;
    const fire = (s.rpm / 60) * P.fires;
    this.oscs.forEach((o, i) => o.frequency.setTargetAtTime(fire * this.oscMult[i], t, 0.025));
    this.chopLfo.frequency.setTargetAtTime(Math.max(4, fire), t, 0.03);
    const load = 0.35 + 0.65 * s.throttle;
    this.engFilter.frequency.setTargetAtTime(P.filter[0] + s.rpm * P.filter[1] + s.throttle * P.filter[2], t, 0.05);
    const limiter = s.rpm > P.limiter ? 0.55 + 0.45 * Math.sin(t * 90) : 1;
    this.engGain.gain.setTargetAtTime((0.22 + 0.5 * load) * limiter, t, 0.04);
    this.intakeFilter.frequency.setTargetAtTime(Math.max(120, fire * 3.5), t, 0.05);
    this.intakeGain.gain.setTargetAtTime((0.03 + s.throttle * 0.16 * Math.min(1.2, s.rpm / P.limiter)) * P.intake, t, 0.05);
    this.turbo.frequency.setTargetAtTime(1800 + s.boost * 3200 + s.rpm * 0.2, t, 0.1);
    this.turboGain.gain.setTargetAtTime(s.boost * s.throttle * 0.018 * P.turbo, t, 0.08);
    // Blow-off valve when the throttle snaps shut under boost.
    if (P.turbo >= 1 && this.lastBoost > 0.6 && s.throttle < 0.1) this.burst(0.18, 2600, 0.22, 'bandpass', 1.5);
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
    this.crowdGain.gain.setTargetAtTime((a.crowd ?? 0) * 0.16, t, 0.6);
    this.railGain.gain.setTargetAtTime((a.rail ?? 0) * 0.35, t, 0.6);
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
    this.hornGain.gain.setTargetAtTime(on && !this.paused ? this.hornLevel : 0, ctx.currentTime, 0.015);
  }

  /** Output chain for a positioned one-shot: distance gain, air absorption and stereo pan. */
  private spatial(right: number, fwd: number, level: number, bus: GainNode = this.fxBus): { input: AudioNode; t: number } | null {
    const ctx = this.ctx;
    if (!ctx || this.paused || !this.driving) return null;
    const d = Math.hypot(right, fwd);
    const g = ctx.createGain();
    g.gain.value = level / (1 + d / 14);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 9000 / (1 + d / 35);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-0.9, Math.min(0.9, right / Math.max(4, d)));
    lp.connect(g).connect(pan).connect(bus);
    // Disconnect the chain once the sound has finished.
    setTimeout(() => pan.disconnect(), 6000);
    return { input: lp, t: ctx.currentTime };
  }

  /**
   * A traffic horn at a position relative to the listener (metres to the right
   * and ahead). Autos peep, buses blare, trucks play "Horn OK Please" tunes.
   */
  honkAt(right: number, fwd: number, kind: HonkKind): void {
    const d = Math.hypot(right, fwd);
    if (d > 150 || this.honkCount > 5) return;
    const out = this.spatial(right, fwd, kind === 'bus' || kind === 'bus1' || kind === 'truck' ? 0.4 : 0.28);
    if (!out) return;
    const ctx = this.ctx!;
    const { input, t } = out;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1;
    const env = ctx.createGain();
    env.gain.value = 0;
    f.connect(env).connect(input);
    const notes: [number, number, number][] = []; // [freq, start, length]
    let tones: number[];
    if (kind === 'auto' || kind === 'bike') {
      f.frequency.value = kind === 'auto' ? 1400 : 1700;
      f.Q.value = 2;
      tones = [kind === 'auto' ? 600 + Math.random() * 80 : 760 + Math.random() * 60];
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) notes.push([1, i * 0.16, 0.1]);
    } else if (kind === 'truck') {
      f.frequency.value = 1100;
      tones = [1];
      const tune = Math.random() < 0.5 ? [523, 659, 784, 659, 523] : [440, 554, 659, 554, 880];
      tune.forEach((fr, i) => notes.push([fr, i * 0.19, 0.17]));
    } else if (kind === 'bus' || kind === 'bus1') {
      f.frequency.value = 520;
      tones = [196, 247];
      notes.push([1, 0, 0.55 + Math.random() * 0.5]);
    } else {
      f.frequency.value = 900;
      const base = 380 + Math.random() * 160;
      tones = [base, base * 1.26];
      const n = 1 + Math.floor(Math.random() * 3);
      let at = 0;
      for (let i = 0; i < n; i++) {
        const len = 0.1 + Math.random() * 0.3;
        notes.push([1, at, len]);
        at += len + 0.07;
      }
    }
    let end = 0;
    if (kind === 'truck') {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      for (const [fr, st, len] of notes) {
        o.frequency.setValueAtTime(fr, t + st);
        env.gain.setValueAtTime(1, t + st);
        env.gain.setValueAtTime(0.0001, t + st + len);
        end = Math.max(end, st + len);
      }
      o.connect(f);
      o.start(t);
      o.stop(t + end + 0.05);
    } else {
      for (const [, st, len] of notes) {
        env.gain.setValueAtTime(1, t + st);
        env.gain.setValueAtTime(0.0001, t + st + len);
        end = Math.max(end, st + len);
      }
      for (const fr of tones) {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = fr;
        o.connect(f);
        o.start(t);
        o.stop(t + end + 0.05);
      }
    }
    this.honkCount++;
    setTimeout(() => this.honkCount--, (end + 0.2) * 1000);
  }

  /** Temple ghanta (bright, inharmonic) or church bell (deep), struck a few times. */
  bell(right: number, fwd: number, church = false): void {
    const out = this.spatial(right, fwd, church ? 0.5 : 0.32, this.ambBus);
    if (!out) return;
    const ctx = this.ctx!;
    const f0 = church ? 300 + Math.random() * 40 : 720 + Math.random() * 180;
    const partials = church ? [1, 2, 2.4, 3, 4.2, 5.4] : [1, 2.76, 5.4, 8.93];
    const strikes = church ? 4 : 3 + Math.floor(Math.random() * 4);
    for (let k = 0; k < strikes; k++) {
      const at = out.t + k * (church ? 1.1 : 0.42);
      partials.forEach((m, i) => {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f0 * m;
        const g = ctx.createGain();
        const decay = (church ? 3.2 : 2.2) / (1 + i * 0.6);
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(0.5 / (1 + i), at + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
        o.connect(g).connect(out.input);
        o.start(at);
        o.stop(at + decay + 0.05);
      });
    }
  }

  /** A Mumbai local's two-tone horn in the distance. */
  trainHorn(right: number, fwd: number): void {
    const out = this.spatial(right, fwd, 0.55, this.ambBus);
    if (!out) return;
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 850;
    f.Q.value = 0.8;
    const env = ctx.createGain();
    env.gain.value = 0;
    f.connect(env).connect(out.input);
    const t = out.t;
    const blasts: [number, number][] = [
      [0, 1.1],
      [1.25, 0.55],
    ];
    for (const [st, len] of blasts) {
      env.gain.setValueAtTime(0, t + st);
      env.gain.linearRampToValueAtTime(1, t + st + 0.05);
      env.gain.setValueAtTime(1, t + st + len - 0.08);
      env.gain.linearRampToValueAtTime(0, t + st + len);
    }
    for (const fr of [349, 440, 523]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = fr;
      o.connect(f);
      o.start(t);
      o.stop(t + 1.9);
    }
  }

  /** The conductor's bell cord: "ting-ting" (go) on a BEST bus. */
  busBell(times = 2): void {
    const out = this.spatial(0.5, 2, 0.5);
    if (!out) return;
    const ctx = this.ctx!;
    for (let k = 0; k < times; k++) {
      const at = out.t + k * 0.32;
      for (const [m, a] of [
        [1, 0.5],
        [2.4, 0.2],
        [5.2, 0.08],
      ]) {
        const o = ctx.createOscillator();
        o.frequency.value = 1850 * m;
        const g = ctx.createGain();
        g.gain.setValueAtTime(a, at);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.6);
        o.connect(g).connect(out.input);
        o.start(at);
        o.stop(at + 0.65);
      }
    }
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
