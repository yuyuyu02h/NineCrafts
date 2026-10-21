import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MobManager } from '../src/mobs';
import type { VoxelWorld } from '../src/world';

function manager() {
  const floor = { atlas: { textures: { stone: new THREE.Texture() } }, getBlock: (_x: number, y: number) => Math.floor(y) <= 0 ? 3 : null } as unknown as VoxelWorld;
  return new MobManager(new THREE.Scene(), floor);
}
test('rejected nearby drops remain on the ground, even while inventory is full for three minutes', () => {
  const mobs = manager(); mobs.spawnDroppedItem('wood', 5, new THREE.Vector3(0, 1, 0));
  for (let i = 0; i < 12_000; i++) mobs.update(1 / 60, new THREE.Vector3(0, 2, 0), () => {}, () => 0, true);
  assert.equal(mobs.droppedItems.length, 1); assert.equal(mobs.droppedItems[0].count, 5);
});
test('partial pickup keeps exactly the remainder and preserves wear information', () => {
  const mobs = manager(); mobs.spawnDroppedItem('wood', 5, new THREE.Vector3(0, 1, 0));
  mobs.update(1 / 60, new THREE.Vector3(0, 2, 0), () => {}, () => 2, true);
  assert.equal(mobs.droppedItems[0].count, 3);
  mobs.update(1 / 60, new THREE.Vector3(0, 2, 0), () => {}, () => 3, true);
  assert.equal(mobs.droppedItems.length, 0);
  mobs.spawnDroppedItem('wood_pickaxe', 1, new THREE.Vector3(0, 1, 0), 2);
  mobs.update(1 / 60, new THREE.Vector3(0, 2, 0), () => {}, (_id, _count, durability) => { assert.equal(durability, 2); return 0; }, true);
  assert.equal(mobs.droppedItems.length, 1);
});
