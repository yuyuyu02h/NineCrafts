import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { initializeClouds, updateClouds } from '../src/environmentSettings';
import { evaluatePlacement } from '../src/placement';
import { applyGraphics } from '../src/graphics';
import { world } from './world-fixture';
import { BLOCKS } from '../src/blocks';

test('clouds stay fixed when walking, wind has no 80-block jump, distant wrapping covers negative coordinates', () => {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 196);
  initializeClouds(mesh, () => 0.5);
  const matrix = new THREE.Matrix4();
  const center = 7 * 14 + 6;
  updateClouds(mesh, 79.9, new THREE.Vector3()); mesh.getMatrixAt(center, matrix);
  const before = new THREE.Vector3().setFromMatrixPosition(matrix).add(mesh.position);
  updateClouds(mesh, 79.9, new THREE.Vector3(3, 4, 2)); mesh.getMatrixAt(center, matrix);
  assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(matrix).add(mesh.position), before);
  updateClouds(mesh, 80.1, new THREE.Vector3(3, 4, 2)); mesh.getMatrixAt(center, matrix);
  const after = new THREE.Vector3().setFromMatrixPosition(matrix).add(mesh.position);
  assert.ok(Math.abs(after.x - before.x - 0.2) < 1e-6);
  for (const x of [-10000, -225, 0, 225, 10000]) {
    const player = new THREE.Vector3(x, 20, -x); updateClouds(mesh, 80.1, player);
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix); const p = new THREE.Vector3().setFromMatrixPosition(matrix).add(mesh.position);
      assert.ok(Math.abs(p.x - player.x) <= 112.001 && Math.abs(p.z - player.z) <= 112.001);
      assert.ok(p.y >= 65);
    }
  }
  initializeClouds(mesh, () => 0.5); mesh.instanceMatrix.clearUpdateRanges();
  const original = mesh.instanceMatrix.array.slice();
  updateClouds(mesh, 0, new THREE.Vector3(20, 0, 0));
  updateClouds(mesh, 0, new THREE.Vector3(20, 0, 20));
  for (let i = 0; i < mesh.count; i++) {
    if (original[i * 16 + 12] === mesh.instanceMatrix.array[i * 16 + 12] && original[i * 16 + 14] === mesh.instanceMatrix.array[i * 16 + 14]) continue;
    assert.ok(mesh.instanceMatrix.updateRanges.some(range => range.start <= i * 16 && range.start + range.count >= (i + 1) * 16),
      'all changed matrices must be uploaded even when two simulation steps precede a render');
  }
  mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); mesh.dispose();
});

test('lake interiors are culled, but surfaces and edges against glass stay visible', () => {
  const w = world();
  for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) for (let z = 0; z < 12; z++) w.addBlock(x, y, z, BLOCKS.WATER, false);
  let visible = 0;
  for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) for (let z = 0; z < 12; z++) if (!w.isBlockOccluded(x, y, z)) visible++;
  assert.equal(visible, 728, 'only the outer shell needs drawing (was 1728 cubes)');
  assert.equal(w.isBlockOccluded(5, 11, 5), false);
  assert.equal(w.isBlockOccluded(5, 5, 5), true);
  w.removeBlock(6, 5, 5, false, false); w.addBlock(6, 5, 5, BLOCKS.GLASS, false);
  assert.equal(w.isBlockOccluded(5, 5, 5), false);
});

test('placement rejects body overlap, occupied and unloaded cells; exact contact is allowed', () => {
  const w = world(); w.generatedChunks.add('0,0');
  const eye = new THREE.Vector3(8.5, 3.62, 8.5), body = { radius: 0.32, height: 1.62 };
  const at = (x: number, y: number, z: number) => evaluatePlacement(w, new THREE.Vector3(x, y, z), eye, body);
  assert.equal(at(8, 2, 8).reason, '自分と重なっています');
  assert.equal(at(8, 1, 8).allowed, true);
  assert.equal(at(16, 2, 8).reason, '地形を読み込み中です');
  w.addBlock(9, 2, 8, BLOCKS.STONE, false);
  assert.equal(at(9, 2, 8).reason, '別のブロックがあります');
  assert.equal(w.blockEdits.size, 1, 'checking preview must not modify world or inventory');
});

test('graphics switches apply resolution, particle and shadow budgets and release resized maps', () => {
  let ratio = 0, disposed = 0;
  const renderer = { setPixelRatio: (value: number) => { ratio = value; }, shadowMap: { enabled: true } } as unknown as THREE.WebGLRenderer;
  const light = new THREE.DirectionalLight(), particles = new THREE.Points();
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.map = { dispose: () => { disposed++; } } as THREE.WebGLRenderTarget;
  applyGraphics(renderer, light, particles, 'low', false, 2);
  assert.equal(ratio, 0.85); assert.equal(light.shadow.mapSize.x, 512); assert.equal(disposed, 1);
  assert.equal(renderer.shadowMap.enabled, false); assert.equal(light.castShadow, false); assert.equal(particles.visible, false);
  applyGraphics(renderer, light, particles, 'high', true, 2);
  assert.equal(ratio, 1.75); assert.equal(light.shadow.mapSize.x, 2048); assert.equal(renderer.shadowMap.enabled, true);
  applyGraphics(renderer, light, particles, 'balanced', true, 1);
  assert.equal(ratio, 1); assert.equal(particles.visible, true);
});
