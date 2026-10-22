import type { Vector3 } from 'three';
import type { VoxelWorld } from './world';

export interface Placement {
  position: Vector3;
  allowed: boolean;
  reason: string;
}

/** One rule shared by the ghost and the actual placement, before inventory is consumed. */
export function evaluatePlacement(world: Pick<VoxelWorld, 'getBlock' | 'isChunkLoaded'>, position: Vector3,
  eye: Vector3, body: { radius: number; height: number }): Placement {
  let reason = '';
  if (!world.isChunkLoaded(position.x, position.z)) reason = '地形を読み込み中です';
  else if (world.getBlock(position.x, position.y, position.z) !== null) reason = '別のブロックがあります';
  else if (eye.x - body.radius < position.x + 1 && eye.x + body.radius > position.x &&
    eye.y - body.height < position.y + 1 && eye.y + 0.1 > position.y &&
    eye.z - body.radius < position.z + 1 && eye.z + body.radius > position.z) reason = '自分と重なっています';
  return { position, allowed: !reason, reason };
}
