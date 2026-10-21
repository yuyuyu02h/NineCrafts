import test from 'node:test';
import assert from 'node:assert/strict';
import { joystickVector } from '../src/TouchControls';

test('joystick center is neutral, directions are consistent, and diagonal input is capped', () => {
  assert.deepEqual(joystickVector(0, 0), { x: 0, z: 0 });
  assert.deepEqual(joystickVector(42, 0), { x: 1, z: 0 });
  assert.deepEqual(joystickVector(0, -42), { x: 0, z: -1 });
  const diagonal = joystickVector(1000, -1000);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.z) - 1) < 1e-9);
  assert.equal(diagonal.x, -diagonal.z);
  assert.equal(joystickVector(21, 0).x, 0.5, 'analog strength must survive instead of always becoming full speed');
});
