import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VoxelWorld } from '../src/world';
import { BLOCKS } from '../src/blocks';

// Exercise actual generation/edit/restore code, without creating a WebGL renderer or 25 GPU buffers.
function world(seed: number): VoxelWorld {
  const value = Object.create(VoxelWorld.prototype) as VoxelWorld;
  Object.assign(value, {
    seed, generating: false, blockEdits: new Map(), worldData: new Map(), chunkData: new Map(),
    generatedChunks: new Set(), chunkRenderData: new Map(), dirtyChunks: new Set(),
    pendingWaterFlow: [], waterFlowTimer: 0, torchLights: new Map(), debrisList: [],
    lastPlayerPos: new THREE.Vector3(), lastPlayerChunkX: null, lastPlayerChunkZ: null,
    scene: new THREE.Scene(), renderDistance: 1, instancedMeshes: {},
    targetBoxMesh: new THREE.LineSegments(), crackMesh: new THREE.Mesh(),
  });
  value.updateInstancedMeshes = () => {};
  return value;
}
const cells = (value: VoxelWorld) => Array.from(value.worldData).sort(([a], [b]) => a.localeCompare(b));

test('seeded terrain and cross-border trees are independent of chunk visit order', () => {
  const first = world(1234), second = world(1234);
  const chunks = [[-1, -1], [0, -1], [-1, 0], [0, 0], [1, 0]];
  for (const [x, z] of chunks) first.generateChunk(x, z);
  for (const [x, z] of [...chunks].reverse()) second.generateChunk(x, z);
  assert.deepEqual(cells(first), cells(second));
  assert.equal(first.blockEdits.size, 0, 'natural terrain must not be saved as edits');
});

test('different seeds change deposits or flora without changing terrain height logic', () => {
  const first = world(1), second = world(2);
  first.generateChunk(0, 0); second.generateChunk(0, 0);
  assert.deepEqual(first.getTerrainHeight(8, 8), second.getTerrainHeight(8, 8));
  assert.notDeepEqual(cells(first), cells(second));
});

test('mined negative-coordinate cells and placed blocks survive reload and regeneration', () => {
  const original = world(789);
  original.generateChunk(-1, 0); original.generateChunk(0, 0);
  const groundY = original.getTerrainHeight(-1, 0).height;
  original.removeBlock(-1, groundY, 0, false);
  original.addBlock(-1, 40, 0, BLOCKS.BRICK, false);
  original.addBlock(0, 40, 0, BLOCKS.TORCH, false);
  const snapshot = original.exportSaveData();
  assert.equal(snapshot.edits.length, 3);
  const restored = world(0);
  restored.chunkRenderData.set('old', []);
  restored.pendingWaterFlow.push({ x: 0, y: 0, z: 0, spread: 0 });
  restored.importSaveData(snapshot);
  assert.equal(restored.seed, 789);
  assert.equal(restored.chunkRenderData.size, 0);
  assert.equal(restored.pendingWaterFlow.length, 0);
  restored.generateChunk(0, 0); restored.generateChunk(-1, 0);
  assert.equal(restored.getBlock(-1, groundY, 0), null);
  assert.equal(restored.getBlock(-1, 40, 0), BLOCKS.BRICK);
  assert.equal(restored.torchLights.size, 1);
  assert.deepEqual(cells(restored), cells(original));
});

test('replacing natural terrain stores the final block type, not the generated original', () => {
  const original = world(12); original.generateChunk(0, 0);
  const y = original.getTerrainHeight(8, 8).height;
  original.removeBlock(8, y, 8, false);
  original.addBlock(8, y, 8, BLOCKS.GLASS, false);
  const restored = world(0); restored.importSaveData(original.exportSaveData()); restored.generateChunk(0, 0);
  assert.equal(restored.getBlock(8, y, 8), BLOCKS.GLASS);
  assert.equal(restored.blockEdits.size, 1);
});
