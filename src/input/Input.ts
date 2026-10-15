/**
 * Keyboard + gamepad input mapped to driving actions. Uses KeyboardEvent.code so
 * bindings are layout-independent, and prevents the page from scrolling on
 * arrow keys / space while the game has focus.
 */
export type Action =
  | 'accelerate'
  | 'brake'
  | 'left'
  | 'right'
  | 'handbrake'
  | 'camera'
  | 'horn'
  | 'lights'
  | 'mute'
  | 'reset'
  | 'pause'
  | 'map';

export const DEFAULT_BINDINGS: Record<string, Action> = {
  KeyW: 'accelerate',
  ArrowUp: 'accelerate',
  KeyS: 'brake',
  ArrowDown: 'brake',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'handbrake',
  KeyC: 'camera',
  KeyH: 'horn',
  KeyL: 'lights',
  KeyM: 'mute',
  KeyR: 'reset',
  Escape: 'pause',
  KeyP: 'pause',
  Tab: 'map',
};

/** Keys whose browser default (scrolling, focus change) must be suppressed. */
export const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab', 'PageUp', 'PageDown']);

export interface DriveAxes {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: number;
}

function isTextTarget(t: EventTarget | null): boolean {
  if (!t || !(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

export class Input {
  private held = new Set<Action>();
  private pressedQueue = new Set<Action>();
  private keysDown = new Map<string, Action>();
  /** When false, keys are observed but driving actions are not captured (menus). */
  enabled = false;
  readonly axes: DriveAxes = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
  /** Touch / on-screen controls write here (−1..1 steer, 0..1 pedals). */
  readonly virtual: DriveAxes = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
  private steerSmooth = 0;
  private gamepadActive = false;
  private padPrev = new Set<Action>();

  constructor(
    private readonly target: Window | HTMLElement = window,
    private readonly bindings: Record<string, Action> = DEFAULT_BINDINGS,
  ) {
    target.addEventListener('keydown', this.onKeyDown as EventListener, { passive: false });
    target.addEventListener('keyup', this.onKeyUp as EventListener);
    window.addEventListener('blur', this.onBlur);
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown as EventListener);
    this.target.removeEventListener('keyup', this.onKeyUp as EventListener);
    window.removeEventListener('blur', this.onBlur);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (isTextTarget(e.target)) return;
    const action = this.bindings[e.code];
    if (!action) return;
    if (this.enabled && SCROLL_KEYS.has(e.code)) e.preventDefault();
    if (!this.enabled && action !== 'pause') return;
    if (!e.repeat && !this.keysDown.has(e.code)) this.pressedQueue.add(action);
    this.keysDown.set(e.code, action);
    this.held.add(action);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const action = this.keysDown.get(e.code);
    this.keysDown.delete(e.code);
    if (!action) return;
    // Another key bound to the same action may still be down.
    for (const a of this.keysDown.values()) if (a === action) return;
    this.held.delete(action);
  };

  private onBlur = () => {
    this.keysDown.clear();
    this.held.clear();
  };

  isHeld(a: Action): boolean {
    return this.held.has(a);
  }

  /** Edge-triggered: true once per key press. */
  consume(a: Action): boolean {
    if (this.pressedQueue.has(a)) {
      this.pressedQueue.delete(a);
      return true;
    }
    return false;
  }

  clearPressed(): void {
    this.pressedQueue.clear();
  }

  releaseAll(): void {
    this.onBlur();
    this.pressedQueue.clear();
  }

  /** Simulates a key press (used by on-screen buttons and tests). */
  press(a: Action): void {
    this.pressedQueue.add(a);
  }

  /** Updates analog axes. `sensitivity` scales how quickly keyboard steering ramps. */
  update(dt: number, sensitivity = 1, speed = 0): DriveAxes {
    let throttle = this.held.has('accelerate') ? 1 : 0;
    let brake = this.held.has('brake') ? 1 : 0;
    let handbrake = this.held.has('handbrake') ? 1 : 0;
    const left = this.held.has('left') ? 1 : 0;
    const right = this.held.has('right') ? 1 : 0;
    const target = left - right;

    // Keyboard steering ramps in, faster at low speed, and returns quickly.
    const speedFactor = 1 / (1 + Math.abs(speed) / 30);
    const rampIn = (2.2 + 3.2 * speedFactor) * sensitivity;
    const rampOut = 6.5;
    const rate = target === 0 || Math.sign(target) !== Math.sign(this.steerSmooth) ? rampOut : rampIn;
    const diff = target - this.steerSmooth;
    this.steerSmooth += Math.sign(diff) * Math.min(Math.abs(diff), rate * dt);

    let steer = this.steerSmooth;
    const pad = this.pollGamepad();
    if (pad) {
      throttle = Math.max(throttle, pad.throttle);
      brake = Math.max(brake, pad.brake);
      handbrake = Math.max(handbrake, pad.handbrake);
      if (Math.abs(pad.steer) > 0.05) steer = pad.steer * Math.min(1.5, sensitivity);
    }
    if (this.virtual.throttle || this.virtual.brake || this.virtual.steer || this.virtual.handbrake) {
      throttle = Math.max(throttle, this.virtual.throttle);
      brake = Math.max(brake, this.virtual.brake);
      handbrake = Math.max(handbrake, this.virtual.handbrake);
      if (this.virtual.steer) steer = this.virtual.steer;
    }
    this.axes.throttle = throttle;
    this.axes.brake = brake;
    this.axes.handbrake = handbrake;
    this.axes.steer = Math.max(-1, Math.min(1, steer));
    return this.axes;
  }

  private pollGamepad(): DriveAxes | null {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find((p) => p && p.connected);
    if (!gp) {
      this.gamepadActive = false;
      return null;
    }
    const dead = (v: number) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
    const steer = -dead(gp.axes[0] ?? 0);
    const rt = gp.buttons[7]?.value ?? 0;
    const lt = gp.buttons[6]?.value ?? 0;
    const btn = (i: number) => !!gp.buttons[i]?.pressed;
    const now = new Set<Action>();
    if (btn(3)) now.add('camera');
    if (btn(1)) now.add('horn');
    if (btn(2)) now.add('lights');
    if (btn(9)) now.add('pause');
    if (btn(8)) now.add('reset');
    if (this.enabled) {
      for (const a of now) if (!this.padPrev.has(a)) this.pressedQueue.add(a);
      if (now.has('horn')) this.held.add('horn');
      else if (this.padPrev.has('horn')) this.held.delete('horn');
    }
    this.padPrev = now;
    if (rt > 0.05 || lt > 0.05 || Math.abs(steer) > 0.05 || btn(0)) this.gamepadActive = true;
    if (!this.gamepadActive) return null;
    return { throttle: rt, brake: lt, steer, handbrake: btn(0) ? 1 : 0 };
  }
}
