import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VoxelWorld, MAX_WATER_QUEUE, MAX_FLOWING_WATER, MAX_TORCH_LIGHTS, MAX_DEBRIS } from '../src/world';
import { BLOCKS } from '../src/blocks';
import { world } from './world-fixture';

test('natural lakes sleep, water queues deduplicate and spreading never resets its horizontal budget', () => {
  const w = world(); w.generateChunk(0, 0);
  assert.equal(w.pendingWaterFlow.length, 0);
  const dedup = world(), capped = world();
  for (let i = 0; i < 10000; i++) dedup.queueWater(1, 40, 1, 0);
  assert.equal(dedup.pendingWaterFlow.length, 1);
  for (let i = 0; i < 10000; i++) capped.queueWater(i, 40, 1, 0);
  assert.equal(capped.pendingWaterFlow.length, MAX_WATER_QUEUE);
  w.addBlock(8, 25, 8, BLOCKS.WATER, false);
  for (let i = 0; i < 600; i++) w.updateWaterPhysics(0.35);
  assert.ok(w.waterLevels.size <= MAX_FLOWING_WATER);
  for (const [key, spread] of w.waterLevels) { const [x, , z] = key.split(',').map(Number); assert.ok(Math.abs(x - 8) + Math.abs(z - 8) <= 3); assert.ok(spread <= 3); }
  assert.equal(w.pendingWaterFlow.length, 0);
  const restored = world(); restored.importSaveData(w.exportSaveData()); restored.generateChunk(0, 0);
  for (let i = 0; i < 200; i++) restored.updateWaterPhysics(0.35);
  assert.equal(restored.waterLevels.size, w.waterLevels.size, 'reload must not turn every stream cell into a source');
});
test('explosion performs one mesh rebuild, caps fragments, and invokes equipment removal exactly once', () => {
  const w = world(); w.generateChunk(0, 0); let rebuilds = 0, equipment = 0;
  w.updateInstancedMeshes = () => { rebuilds++; };
  w.addBlock(8, 3, 8, BLOCKS.CHEST, false);
  // Use a guaranteed empty high position for equipment notification.
  w.addBlock(8, 40, 8, BLOCKS.CHEST, false);
  w.onBlockRemoved = (_x, y, _z, type) => { if (y === 40 && type === BLOCKS.CHEST) equipment++; };
  w.explode(8, 39, 8, 3.5);
  assert.equal(rebuilds, 1); assert.equal(equipment, 1); assert.ok(w.debrisList.length <= MAX_DEBRIS);
  w.updateDebris(2); assert.equal(w.debrisList.length, 0);
});
test('long exploration evicts natural chunks and lights, then regenerates placed/mined edits exactly', () => {
  const w = world(9); w.renderDistance = 1;
  w.updateInstancedMeshes = (position?: THREE.Vector3) => { if (position) w.lastPlayerPos.copy(position); w.syncTorchLights(); };
  w.updateChunks(new THREE.Vector3(8, 4, 8));
  const ground = w.getTerrainHeight(8, 8).height; w.removeBlock(8, ground, 8, false);
  w.addBlock(8, 30, 8, BLOCKS.BRICK, false);
  for (let i = 0; i < 20; i++) w.addBlock(4 + i, 15, 8, BLOCKS.TORCH, false);
  w.lastPlayerPos.set(8, 15, 8); w.syncTorchLights(); assert.equal(w.torchLights.size, MAX_TORCH_LIGHTS);
  let maxCells = 0;
  for (let i = 1; i <= 20; i++) {
    w.updateChunks(new THREE.Vector3(i * 160, 15, 8));
    assert.ok(w.generatedChunks.size <= 25); assert.ok(w.chunkData.size <= 25); assert.ok(w.chunkRenderData.size <= 25);
    maxCells = Math.max(maxCells, w.worldData.size); assert.ok(w.worldData.size < 200000); assert.equal(w.torchLights.size, 0);
  }
  w.updateChunks(new THREE.Vector3(8, 15, 8));
  assert.equal(w.getBlock(8, ground, 8), null); assert.equal(w.getBlock(8, 30, 8), BLOCKS.BRICK);
  assert.ok(w.torchLights.size <= MAX_TORCH_LIGHTS); assert.ok(maxCells > 0);
});
