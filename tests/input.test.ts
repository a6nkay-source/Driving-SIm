// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { Input } from '../src/input/Input';

let input: Input | null = null;
afterEach(() => {
  input?.dispose();
  input = null;
});

function key(type: 'keydown' | 'keyup', code: string, target: EventTarget = window): KeyboardEvent {
  const e = new KeyboardEvent(type, { code, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

describe('input', () => {
  it('maps WASD and arrow keys to driving actions', () => {
    input = new Input(window);
    input.enabled = true;
    key('keydown', 'KeyW');
    key('keydown', 'ArrowLeft');
    key('keydown', 'Space');
    const axes = input.update(1, 1, 0);
    expect(axes.throttle).toBe(1);
    expect(axes.steer).toBeGreaterThan(0.5);
    expect(axes.handbrake).toBe(1);
    key('keyup', 'KeyW');
    key('keyup', 'ArrowLeft');
    key('keyup', 'Space');
    key('keydown', 'ArrowDown');
    const axes2 = input.update(1, 1, 0);
    expect(axes2.throttle).toBe(0);
    expect(axes2.brake).toBe(1);
    expect(axes2.steer).toBe(0);
  });

  it('prevents page scrolling for arrows and space while driving', () => {
    input = new Input(window);
    input.enabled = true;
    expect(key('keydown', 'ArrowDown').defaultPrevented).toBe(true);
    expect(key('keydown', 'Space').defaultPrevented).toBe(true);
    input.enabled = false;
    key('keyup', 'ArrowDown');
    key('keyup', 'Space');
    expect(key('keydown', 'ArrowDown').defaultPrevented).toBe(false);
  });

  it('reports edge-triggered presses once per keydown', () => {
    input = new Input(window);
    input.enabled = true;
    key('keydown', 'KeyC');
    expect(input.consume('camera')).toBe(true);
    expect(input.consume('camera')).toBe(false);
    // Auto-repeat while held does not re-trigger.
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC', repeat: true }));
    expect(input.consume('camera')).toBe(false);
    key('keyup', 'KeyC');
    key('keydown', 'KeyC');
    expect(input.consume('camera')).toBe(true);
  });

  it('binds every documented control', () => {
    input = new Input(window);
    input.enabled = true;
    const expected: [string, Parameters<Input['consume']>[0]][] = [
      ['KeyC', 'camera'],
      ['KeyH', 'horn'],
      ['KeyL', 'lights'],
      ['KeyM', 'mute'],
      ['KeyR', 'reset'],
      ['Escape', 'pause'],
    ];
    for (const [code, action] of expected) {
      key('keydown', code);
      expect(input.consume(action)).toBe(true);
      key('keyup', code);
    }
  });

  it('ignores typing in text fields and releases keys on blur', () => {
    input = new Input(window);
    input.enabled = true;
    const field = document.createElement('input');
    document.body.appendChild(field);
    key('keydown', 'KeyW', field);
    expect(input.update(1).throttle).toBe(0);
    key('keydown', 'KeyW');
    expect(input.isHeld('accelerate')).toBe(true);
    window.dispatchEvent(new Event('blur'));
    expect(input.isHeld('accelerate')).toBe(false);
    field.remove();
  });

  it('still lets Escape through when driving controls are disabled (menus)', () => {
    input = new Input(window);
    input.enabled = false;
    key('keydown', 'KeyW');
    expect(input.isHeld('accelerate')).toBe(false);
    key('keydown', 'Escape');
    expect(input.consume('pause')).toBe(true);
  });
});
