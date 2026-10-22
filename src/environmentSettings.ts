import * as THREE from 'three';

export const viewFog = (distance: number) => ({ near: distance * 9, far: distance * 16 + 6 });

const CLOUD_SPAN = 14 * 16;
const cloudMatrix = new THREE.Matrix4();

/** Wind moves the layer. Only clouds beyond the horizon wrap; nearby clouds stay in world space. */
export function updateClouds(mesh: THREE.InstancedMesh, wind: number, player: THREE.Vector3) {
  mesh.position.x = wind;
  let changed = false;
  // Multiple fixed steps may run before a render. Keep all pending ranges until Three.js uploads them.
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, cloudMatrix);
    const e = cloudMatrix.elements;
    const dx = Math.floor((player.x - wind - e[12] + CLOUD_SPAN / 2) / CLOUD_SPAN) * CLOUD_SPAN;
    const dz = Math.floor((player.z - e[14] + CLOUD_SPAN / 2) / CLOUD_SPAN) * CLOUD_SPAN;
    if (!dx && !dz) continue;
    e[12] += dx; e[14] += dz;
    mesh.setMatrixAt(i, cloudMatrix);
    mesh.instanceMatrix.addUpdateRange(i * 16, 16);
    changed = true;
  }
  if (changed) { mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); }
}

/** Initialize every cloud; subsequent updates upload only recycled instances. */
export function initializeClouds(mesh: THREE.InstancedMesh, random = Math.random) {
  const dummy = new THREE.Object3D();
  for (let index = 0; index < mesh.count; index++) {
    dummy.position.set((index % 14) * 16 - 104 + random() * 5, 65 + random() * 4, Math.floor(index / 14) * 16 - 104);
    dummy.scale.set(8 + random() * 12, 2 + random() * 2, 8 + random() * 12);
    dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
}
