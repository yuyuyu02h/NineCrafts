import * as THREE from 'three';

export const viewFog = (distance: number) => ({ near: distance * 9, far: distance * 16 + 6 });

/** Upload once; animation moves the entire layer without uploading instance matrices. */
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
