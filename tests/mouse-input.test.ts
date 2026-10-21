import test from 'node:test';
import assert from 'node:assert/strict';
import { bindGameMouse } from '../src/mouseInput';

function fixture() {
  const canvas = new EventTarget();
  const window = new EventTarget();
  let playing = true;
  let held = false;
  let uses = 0;
  const dispose = bindGameMouse(canvas, window, () => playing, value => { held = value; }, () => { uses++; });
  const mouse = (target: EventTarget, type: string, button: number) => {
    const event = new Event(type);
    Object.defineProperty(event, 'button', { value: button });
    target.dispatchEvent(event);
  };
  return { canvas, window, dispose, mouse, setPlaying: (value: boolean) => { playing = value; }, get held() { return held; }, get uses() { return uses; } };
}

test('canvas MouseEvents start mining and use items, including right click while left is held', () => {
  const f = fixture();
  f.mouse(f.canvas, 'mousedown', 0);
  assert.equal(f.held, true);
  f.mouse(f.canvas, 'mousedown', 2);
  assert.equal(f.uses, 1);
  f.mouse(f.window, 'mouseup', 2);
  assert.equal(f.held, true, 'releasing right click must not stop left-held mining');
  f.mouse(f.window, 'mouseup', 0);
  assert.equal(f.held, false, 'release outside the canvas must end mining');
  f.dispose();
});

test('UI clicks, paused input, and middle button do not perform game actions', () => {
  const f = fixture();
  f.mouse(f.window, 'mousedown', 0);
  f.mouse(f.window, 'mousedown', 2);
  f.mouse(f.canvas, 'mousedown', 1);
  assert.equal(f.held, false);
  assert.equal(f.uses, 0);
  f.setPlaying(false);
  f.mouse(f.canvas, 'mousedown', 0);
  f.mouse(f.canvas, 'mousedown', 2);
  assert.equal(f.held, false);
  assert.equal(f.uses, 0);
  f.dispose();
});

test('blur, cancellation, and cleanup release held mining and remove listeners', () => {
  const f = fixture();
  for (const type of ['blur', 'pointercancel']) {
    f.mouse(f.canvas, 'mousedown', 0);
    f.window.dispatchEvent(new Event(type));
    assert.equal(f.held, false);
  }
  f.mouse(f.canvas, 'mousedown', 0);
  f.dispose();
  assert.equal(f.held, false);
  f.mouse(f.canvas, 'mousedown', 0);
  f.mouse(f.canvas, 'mousedown', 2);
  assert.equal(f.held, false);
  assert.equal(f.uses, 0);
});
