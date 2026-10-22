import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MobManager } from '../src/mobs';
import { FixedStepper } from '../src/simulation';
import { HOSTILE_LIMIT, ANIMAL_LIMIT } from '../src/combat';
import { BLOCKS } from '../src/blocks';
import { world } from './world-fixture';
function flat(wall = false) {
  const w = world();
  w.getTerrainHeight = () => ({ height: 0, biome: 'plains' });
  w.getBlock = (x, y, _z) => Math.floor(y) <= 0 || (wall && Math.floor(x) === 1 && y < 4) ? BLOCKS.STONE : null;
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) w.generatedChunks.add(w.getChunkKey(x, z));
  return new MobManager(new THREE.Scene(), w);
}
test('actual zombie travel is equal at 30/60/144Hz, with a speed cap in world units/second', () => {
  const positions = [30, 60, 144].map(hz => {
    const manager = flat(); const zombie = manager.spawnMob('zombie', 0, 1, 0);
    const clock = new FixedStepper();
    for (let i = 0; i < hz * 3; i++) clock.advance(1 / hz, true, dt => manager.update(dt, new THREE.Vector3(14, 2.62, 0), () => {}, () => 0, true));
    const x = zombie.position.x; assert.ok(x > 8 && x <= zombie.speed * 3); manager.dispose(); return x;
  });
  assert.ok(Math.max(...positions) - Math.min(...positions) < 1e-9);
});
test('flat-ground melee hits the player body at intervals, and walls block it', () => {
  const manager = flat(); manager.spawnMob('zombie', 0, 1, 0);
  let hits = 0; for (let i = 0; i < 120; i++) manager.update(1 / 60, new THREE.Vector3(1.4, 2.62, 0), () => hits++, () => 0, true);
  assert.ok(hits >= 2 && hits <= 3);
  const blocked = flat(true); blocked.spawnMob('zombie', 0, 1, 0);
  let blockedHits = 0; for (let i = 0; i < 20; i++) blocked.update(1 / 60, new THREE.Vector3(1.4, 2.62, 0), () => blockedHits++, () => 0, true);
  assert.equal(blockedHits, 0); manager.dispose(); blocked.dispose();
});
test('animals cannot fill hostile slots, spawn timers use seconds, peaceful removes existing threats', () => {
  const manager = flat();
  for (let i = 0; i < ANIMAL_LIMIT; i++) manager.spawnMob('cow', 0, 1, i);
  for (let i = 0; i < 60 * 40; i++) manager.handleSpawning(new THREE.Vector3(0, 2.62, 0), true, false, 1 / 60);
  assert.equal(manager.mobs.filter(m => !m.isHostile).length, ANIMAL_LIMIT);
  assert.equal(manager.mobs.filter(m => m.isHostile).length, HOSTILE_LIMIT);
  manager.shootArrow(new THREE.Vector3(), new THREE.Vector3(1, 0, 0), false);
  manager.setPeaceful(true); assert.equal(manager.mobs.length, ANIMAL_LIMIT); assert.equal(manager.arrows.length, 0);
  manager.dispose();
});
test('far mobs sleep/despawn and killed meshes and collected drops release owned GPU resources', () => {
  const manager = flat(); const mob = manager.spawnMob('cow', 55, 1, 0); const pos = mob.position.clone();
  manager.update(1 / 60, new THREE.Vector3(0, 2.62, 0), () => {}, () => 0, true);
  assert.deepEqual(mob.position, pos); assert.equal(mob.mesh.visible, false);
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  mob.mesh.traverse(c => { const mesh = c as THREE.Mesh; if (mesh.geometry) geometries.add(mesh.geometry); if (mesh.material) materials.add(mesh.material as THREE.Material); });
  let freedGeometry = 0, freedMaterial = 0;
  for (const g of geometries) g.addEventListener('dispose', () => freedGeometry++);
  for (const m of materials) m.addEventListener('dispose', () => freedMaterial++);
  manager.update(1 / 60, new THREE.Vector3(-40, 2.62, 0), () => {}, () => 0, true);
  assert.equal(manager.mobs.length, 0); assert.equal(freedGeometry, geometries.size); assert.equal(freedMaterial, materials.size);
  manager.spawnDroppedItem('wood', 1, new THREE.Vector3(0, 1, 0)); let disposed = 0;
  (manager.droppedItems[0].mesh.children[0] as THREE.Mesh).geometry.addEventListener('dispose', () => disposed++);
  manager.update(1 / 60, new THREE.Vector3(0, 2, 0), () => {}, () => 1, true);
  assert.equal(disposed, 1); manager.dispose();
});
test('an arrow sweeps the entire segment and cannot pass a wall to damage a mob', () => {
  const manager = flat(true); const mob = manager.spawnMob('cow', 3, 1, 0);
  manager.shootArrow(new THREE.Vector3(0, 2, 0), new THREE.Vector3(1, 0, 0), true, 100);
  manager.update(0.04, new THREE.Vector3(0, 2.62, 5), () => {}, () => 0, true);
  assert.equal(manager.arrows.length, 0); assert.equal(mob.hp, mob.maxHp); manager.dispose();
});
