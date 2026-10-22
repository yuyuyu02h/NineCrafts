import type * as THREE from 'three';
import { BLOCK_DEFS } from './blocks';
import type { VoxelWorld } from './world';

export const WALK_SPEED = 4.3;
export const SPRINT_SPEED = 5.6;
export const SNEAK_SPEED = 1.3;

/** Substeps also protect drops/jumps at low frame rates. Snap to contact instead of bouncing back. */
export function movePlayer(world: VoxelWorld, position: THREE.Vector3, velocity: THREE.Vector3, delta: number,
  body: { radius: number; height: number }, sneak = false, grounded = false) {
  const solid = (x: number, y: number, z: number) => {
    const id = world.getBlock(x, y, z); return !!(id && BLOCK_DEFS[id]?.isSolid);
  };
  const overlaps = () => {
    for (let x = Math.floor(position.x - body.radius + 1e-6); x <= Math.floor(position.x + body.radius - 1e-6); x++)
      for (let y = Math.floor(position.y - body.height + 1e-6); y <= Math.floor(position.y + 0.1 - 1e-6); y++)
        for (let z = Math.floor(position.z - body.radius + 1e-6); z <= Math.floor(position.z + body.radius - 1e-6); z++)
          if (solid(x, y, z)) return true;
    return false;
  };
  const supported = () => {
    const y = Math.floor(position.y - body.height - 0.08);
    for (const x of [position.x - body.radius, position.x + body.radius])
      for (const z of [position.z - body.radius, position.z + body.radius]) if (solid(x, y, z)) return true;
    return false;
  };
  let onGround = false;
  const count = Math.max(1, Math.ceil(Math.max(Math.abs(velocity.x), Math.abs(velocity.y), Math.abs(velocity.z)) * delta / 0.25));
  for (let i = 0; i < count; i++) for (const axis of ['x', 'z', 'y'] as const) {
    const previous = position[axis], amount = velocity[axis] * delta / count;
    if (!amount) continue;
    position[axis] += amount;
    const collision = overlaps();
    if (collision || (axis !== 'y' && sneak && grounded && !supported())) {
      // Binary search finds the closest free point, including ledge support while sneaking.
      let lo = 0, hi = 1;
      for (let attempt = 0; attempt < 12; attempt++) {
        const mid = (lo + hi) / 2; position[axis] = previous + amount * mid;
        if (overlaps() || (axis !== 'y' && sneak && grounded && !supported())) hi = mid; else lo = mid;
      }
      position[axis] = previous + amount * lo;
      if (axis === 'y' && amount < 0 && collision) onGround = true;
      velocity[axis] = 0;
    }
  }
  return onGround;
}
