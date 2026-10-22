import * as THREE from 'three';
import { VoxelWorld } from '../src/world';
// Exercise actual generation/edit/restore code, without creating a WebGL renderer or 25 GPU buffers.
export function world(seed = 1234): VoxelWorld {
  const value = Object.create(VoxelWorld.prototype) as VoxelWorld;
  Object.assign(value, {
    seed, generating: false, blockEdits: new Map(), worldData: new Map(), chunkData: new Map(),
    generatedChunks: new Set(), chunkRenderData: new Map(), dirtyChunks: new Set(),
    pendingWaterFlow: [], waterFlowTimer: 0, waterQueued: new Set(), waterLevels: new Map(), editsByChunk: new Map(), primedTnt: [], torchPositions: new Map(), lastLightPos: new THREE.Vector3(), lastRenderDistance: -1, torchLights: new Map(), debrisList: [],
    lastPlayerPos: new THREE.Vector3(), lastPlayerChunkX: null, lastPlayerChunkZ: null,
    atlas: { textures: { stone: new THREE.Texture() }, crackTextures: [] }, scene: new THREE.Scene(), renderDistance: 1, instancedMeshes: {},
    targetBoxMesh: new THREE.LineSegments(), crackMesh: new THREE.Mesh(),
  });
  value.updateInstancedMeshes = () => {};
  return value;
}
