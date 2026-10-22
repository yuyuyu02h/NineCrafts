import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FixedStepper, GameSession, findSafeSpawn, resetPlayerView, normalizeYaw } from '../src/simulation';
import { BLOCKS, BLOCK_DEFS } from '../src/blocks';
import { world } from './world-fixture';
import { emptyFurnace, stepFurnace, type FurnaceState } from '../src/furnace';

test('repeated touch rotations remain saveable and preserve view direction', () => {
  for (const angle of [-100 * Math.PI - 0.3, 0.4, 200 * Math.PI + 0.7]) {
    const yaw = normalizeYaw(angle);
    assert.ok(yaw >= -Math.PI && yaw <= Math.PI);
    assert.ok(Math.abs(Math.sin(yaw) - Math.sin(angle)) < 1e-10);
    assert.ok(Math.abs(Math.cos(yaw) - Math.cos(angle)) < 1e-10);
  }
});

test('fixed simulation performs the same number of steps at 30/60/144Hz and never catches up paused time', () => {
  for (const hz of [30, 60, 144]) {
    const stepper = new FixedStepper(); let steps = 0;
    for (let i = 0; i < hz * 10; i++) stepper.advance(1 / hz, true, () => steps++);
    assert.equal(steps, 600);
    stepper.advance(3600, false, () => steps++);
    assert.equal(steps, 600);
    stepper.advance(1 / 60, true, () => steps++); assert.equal(steps, 601);
    stepper.advance(3600, true, () => steps++); assert.ok(steps <= 607, 'catch-up is bounded');
  }
});
test('one clock pauses TNT and furnace work together, including partial progress across pause', () => {
  const w = world(); let blasts = 0; w.explode = () => { blasts++; return []; };
  w.primeTnt(0, 5, 0);
  let furnace: FurnaceState = { ...emptyFurnace(), input: { itemId: 'iron_ore', count: 2 }, fuel: { itemId: 'coal', count: 1 } };
  const clock = new FixedStepper();
  const run = (active: boolean, frames: number) => {
    for (let i = 0; i < frames; i++) clock.advance(1 / 60, active, dt => { w.updateTnt(dt); furnace = stepFurnace(furnace, dt); });
  };
  run(true, 30); const progress = furnace.progress, remaining = w.primedTnt[0].remaining;
  run(false, 3600); assert.equal(furnace.progress, progress); assert.equal(w.primedTnt[0].remaining, remaining); assert.equal(blasts, 0);
  run(true, 61); assert.equal(blasts, 1); assert.equal(w.primedTnt.length, 0); assert.ok(furnace.progress > progress);
});
test('death transitions once, blocks resume/attack, creative damage is rejected and respawn restores vitals', () => {
  const state = new GameSession(); state.play();
  assert.equal(state.damage(100, '溺死', true), false); assert.equal(state.health, 20);
  assert.equal(state.attack(), true); assert.equal(state.attack(), false);
  state.advance(0.4); assert.equal(state.attack(), true);
  assert.equal(state.damage(100, '溺死', false), true); assert.equal(state.phase, 'dead');
  state.play(); state.pause(); assert.equal(state.phase, 'dead'); assert.equal(state.damage(100, 'again', false), false);
  assert.equal(state.attack(), false);
  state.respawn(); assert.equal(state.phase, 'paused'); assert.equal(state.health, 20); assert.equal(state.oxygen, 10);
  state.play(); assert.equal(state.damage(3, 'enemy', false), false, 'spawn grace prevents immediate death');
});
test('BUG-001: respawn view is level and velocity/flight reset; dry spawn excludes water and body collisions', () => {
  const w = world(); w.generateChunk(0, 0);
  const y = w.getTerrainHeight(8, 8).height;
  for (let h = y + 1; h < y + 30; h++) { w.removeBlock(8, h, 8, false); w.addBlock(8, h, 8, BLOCKS.WATER, false); }
  const spawn = findSafeSpawn(w);
  assert.notDeepEqual([Math.floor(spawn.x), Math.floor(spawn.z)], [8, 8]);
  const support = w.getBlock(spawn.x, spawn.y - 1.63 - 0.01, spawn.z);
  assert.ok(support && BLOCK_DEFS[support].isSolid);
  for (let h = spawn.y - 1.62; h <= spawn.y + 0.1; h += 0.2) { const b = w.getBlock(spawn.x, h, spawn.z); assert.ok(!b || (!BLOCK_DEFS[b].isSolid && b !== BLOCKS.WATER)); }
  const camera = new THREE.PerspectiveCamera(); camera.rotation.set(0.4, 1, 0.5);
  const player = { velocity: new THREE.Vector3(4, -10, 2), onGround: true, flying: true };
  resetPlayerView(camera, player);
  assert.equal(camera.rotation.z, 0); assert.equal(camera.rotation.order, 'YXZ'); assert.equal(player.velocity.length(), 0); assert.equal(player.flying, false);
});
