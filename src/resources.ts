import * as THREE from 'three';
/** Meshes own geometry/materials. Shared atlas textures are owned by the scene, not each mesh. */
export function disposeObjects(objects: THREE.Object3D[], textures = false) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), maps = new Set<THREE.Texture>();
  for (const object of objects) {
    object.removeFromParent();
    object.traverse(child => {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      for (const material of Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []) {
        materials.add(material);
        if (textures) for (const value of Object.values(material)) if (value instanceof THREE.Texture) maps.add(value);
      }
      if (child instanceof THREE.Light) child.dispose();
      if (child instanceof THREE.InstancedMesh) child.dispose();
    });
  }
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const map of maps) map.dispose();
}
