import * as THREE from 'three';
import type { MobEntity } from './types';
export const HOSTILE_LIMIT = 12;
export const ANIMAL_LIMIT = 12;
export const ACTIVE_MOB_RADIUS = 48;
export const DESPAWN_MOB_RADIUS = 80;
export const mobHeight = (type: MobEntity['type']) => type === 'spider' ? 0.75 : ['pig', 'sheep'].includes(type) ? 1.25 : 1.9;
export function bodyBox(feet: THREE.Vector3, height: number, radius = 0.4) {
  return new THREE.Box3(new THREE.Vector3(feet.x - radius, feet.y, feet.z - radius), new THREE.Vector3(feet.x + radius, feet.y + height, feet.z + radius));
}
export function canMelee(mob: Pick<MobEntity, 'position' | 'type'>, eye: THREE.Vector3, reach = 1.6) {
  return Math.hypot(mob.position.x - eye.x, mob.position.z - eye.z) < reach &&
    mob.position.y < eye.y + 0.1 && mob.position.y + mobHeight(mob.type) > eye.y - 1.62;
}
