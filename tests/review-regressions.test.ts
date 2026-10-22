import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { world } from './world-fixture';
import { MobManager } from '../src/mobs';
import { BLOCKS } from '../src/blocks';
import { clickInventory, quickMoveInventory, ensureChest, ensureFurnace, initialItems, stack } from '../src/items';
import { GameSession } from '../src/simulation';
import { movePlayer } from '../src/playerMotion';
import { viewFog, initializeClouds } from '../src/environmentSettings';
import { SoundEngine } from '../src/audio';
import { CleanupScope } from '../src/lifecycle';

test('unloaded drops freeze position, velocity and lifetime, then resume and remain collectible', () => {
  const w = world(9); w.updateChunks(new THREE.Vector3(8, 15, 8));
  const manager = new MobManager(new THREE.Scene(), w), floor = w.getTerrainHeight(8, 8).height;
  manager.spawnDroppedItem('diamond', 1, new THREE.Vector3(8, floor + 1, 8));
  const drop = manager.droppedItems[0]; drop.velocity.set(0, 0, 0);
  const position = drop.position.clone(), velocity = drop.velocity.clone(), life = drop.life;
  w.updateChunks(new THREE.Vector3(160, 15, 8));
  for (let i = 0; i < 12000; i++) manager.update(1 / 60, new THREE.Vector3(160, 15, 8), () => {}, () => 0, false);
  assert.deepEqual(drop.position, position); assert.deepEqual(drop.velocity, velocity); assert.equal(drop.life, life); assert.equal(drop.mesh.visible, false);
  w.updateChunks(new THREE.Vector3(8, 15, 8));
  manager.update(1 / 60, drop.position.clone(), () => {}, () => 1, false);
  assert.equal(manager.droppedItems.length, 0); manager.dispose();
});
test('right click splits odd stacks and places one; shift transfers conserve materials and durability', () => {
  let state = initialItems(); state.inventory[0] = stack('wood', 15);
  state = clickInventory(state, 0, true); assert.equal(state.cursorItem?.count, 8); assert.equal(state.inventory[0].count, 7);
  state = clickInventory(state, 5, true); assert.equal(state.inventory[5].count, 1); assert.equal(state.cursorItem?.count, 7);
  state = clickInventory(state, 0, true); assert.equal(state.inventory[0].count, 8); assert.equal(state.cursorItem?.count, 6);
  state = quickMoveInventory(state, 0); assert.equal(state.inventory[9].count, 8); assert.equal(state.inventory[0].count, 0);
  state = quickMoveInventory(state, 9); assert.equal(state.inventory[9].count, 0); assert.equal(state.inventory.slice(0, 9).reduce((n, s) => n + (s.itemId === 'wood' ? s.count : 0), 0), 9);
  state = ensureChest(state, '0,0,0'); state.inventory[6] = stack('wood_pickaxe', 1, 7);
  state = quickMoveInventory(state, 6, '0,0,0'); assert.equal(state.chests['0,0,0'][0].durability, 7); assert.equal(state.inventory[6].count, 0);
  state = ensureFurnace(state, '1,0,0'); state.inventory[7] = stack('iron_ore', 4);
  state = quickMoveInventory(state, 7, null, '1,0,0'); assert.equal(state.furnaces['1,0,0'].input.count, 4);
  state.inventory[7] = stack('sand', 3); const rejected = quickMoveInventory(state, 7, null, '1,0,0'); assert.equal(rejected, state);
});
test('player movement cannot tunnel through a thin floor or wall, sneaking stops at a ledge', () => {
  const w = world(); w.getBlock = (x, y) => Math.floor(y) === 0 || Math.floor(x) === 2 ? BLOCKS.STONE : null;
  const body = { radius: .3, height: 1.62 }, position = new THREE.Vector3(0, 20, 0), velocity = new THREE.Vector3(0, -300, 0);
  assert.equal(movePlayer(w, position, velocity, .1, body), true); assert.ok(Math.abs(position.y - 2.62) < .001);
  velocity.set(300, 0, 0); movePlayer(w, position, velocity, .1, body); assert.ok(position.x < 1.701);
  w.getBlock = (x, y) => Math.floor(y) === 0 && Math.floor(x) === 0 ? BLOCKS.STONE : null;
  position.set(.5, 2.62, .5); velocity.set(6, -.01, 0); movePlayer(w, position, velocity, 1, body, true, true);
  assert.ok(position.x < 1.31); assert.ok(position.y >= 2.619);
});
test('hunger uses distance/time, natural healing costs food, starvation pauses with the session', () => {
  const walking = new GameSession(), sprinting = new GameSession(); walking.play(); sprinting.play();
  for (let i = 0; i < 3600; i++) { walking.survival(1 / 60, 4.3, false, () => {}); sprinting.survival(1 / 60, 5.6, true, () => {}); }
  assert.ok(sprinting.hunger < walking.hunger);
  walking.health = 18; walking.hunger = 20;
  for (let i = 0; i < 481; i++) walking.survival(1 / 60, 0, false, () => {});
  assert.equal(walking.health, 20); assert.ok(walking.hunger < 20);
  walking.hunger = 0; let hits = 0; walking.pause(); walking.survival(10, 0, false, () => hits++); assert.equal(hits, 0);
  walking.play(); walking.survival(4, 0, false, () => hits++); assert.equal(hits, 1);
});
test('view distance is consistent and every cloud has a distinct elevated transform', () => {
  assert.deepEqual(viewFog(1), { near: 9, far: 22 }); assert.deepEqual(viewFog(4), { near: 36, far: 70 });
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 196);
  initializeClouds(mesh, () => .5);
  const positions = new Set<string>(), matrix = new THREE.Matrix4(), vector = new THREE.Vector3();
  for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, matrix); vector.setFromMatrixPosition(matrix); assert.ok(vector.y >= 65); positions.add(vector.toArray().join(',')); }
  assert.equal(positions.size, 196); assert.ok(mesh.boundingSphere!.radius > 0); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); mesh.dispose();
});
test('BGM OFF clears timers and ON starts a fresh schedule, including initially disabled music', () => {
  const timers = new Map<number, () => void>(); let id = 0;
  const oldWindow = globalThis.window;
  globalThis.window = { AudioContext: class { state = 'running'; }, setTimeout: (fn: () => void) => { timers.set(++id, fn); return id; }, clearTimeout: (id: number) => timers.delete(id) } as unknown as Window & typeof globalThis;
  try {
    const audio = new SoundEngine(); audio.unlock(); assert.equal(timers.size, 1);
    audio.musicEnabled = false; assert.equal(timers.size, 0);
    audio.musicEnabled = true; assert.equal(timers.size, 1); audio.unlock(); assert.equal(timers.size, 1);
    audio.stopMusic(); assert.equal(timers.size, 0);
    const initiallyOff = new SoundEngine(); initiallyOff.musicEnabled = false; initiallyOff.unlock(); assert.equal(timers.size, 0);
    initiallyOff.musicEnabled = true; assert.equal(timers.size, 1); initiallyOff.stopMusic();
  } finally { globalThis.window = oldWindow; }
});
test('partial initialization owns exactly one reverse-order cleanup, late resources are also released', () => {
  const scope = new CleanupScope(), calls: number[] = [];
  scope.own(() => calls.push(1)); scope.own(() => calls.push(2)); scope.dispose(); scope.dispose(); scope.own(() => calls.push(3));
  assert.deepEqual(calls, [2, 1, 3]);
});
