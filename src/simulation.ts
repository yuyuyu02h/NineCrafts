import * as THREE from 'three';
import { BLOCKS, BLOCK_DEFS } from './blocks';
import type { VoxelWorld } from './world';

export const FIXED_STEP = 1 / 60;
export const normalizeYaw = (angle: number) => THREE.MathUtils.euclideanModulo(angle + Math.PI, Math.PI * 2) - Math.PI;
export class FixedStepper {
  private accumulator = 0;
  advance(delta: number, active: boolean, step: (dt: number) => void) {
    if (!active) { this.accumulator = 0; return; }
    this.accumulator += Math.max(0, Math.min(Number.isFinite(delta) ? delta : 0, 0.1));
    while (this.accumulator + 1e-9 >= FIXED_STEP) {
      this.accumulator -= FIXED_STEP;
      step(FIXED_STEP);
    }
  }
}
export type GamePhase = 'playing' | 'paused' | 'dead';
export class GameSession {
  phase: GamePhase = 'paused';
  health = 20;
  hunger = 20;
  oxygen = 10;
  elapsed = 0;
  hurtUntil = 0;
  attackUntil = 0;
  deathReason = '';
  private exhaustion = 0;
  private regenerationTimer = 0;
  private starvationTimer = 0;
  exhaust(amount: number) {
    this.exhaustion += Math.max(0, amount);
    while (this.exhaustion >= 4) { this.exhaustion -= 4; this.hunger = Math.max(0, this.hunger - 1); }
  }
  survival(delta: number, speed: number, sprinting: boolean, damage: (amount: number, reason: string) => void) {
    if (this.phase !== 'playing') return;
    this.exhaust(delta * (0.005 + speed * (sprinting ? 0.1 : 0.01)));
    if (this.hunger >= 18 && this.health < 20) {
      this.regenerationTimer += delta;
      if (this.regenerationTimer >= 4) { this.regenerationTimer -= 4; this.health = Math.min(20, this.health + 1); this.exhaust(3); }
    } else this.regenerationTimer = 0;
    if (this.hunger <= 0 && this.health > 1) {
      this.starvationTimer += delta;
      if (this.starvationTimer >= 4) { this.starvationTimer -= 4; damage(1, '空腹'); }
    } else this.starvationTimer = 0;
  }
  play() { if (this.phase !== 'dead') this.phase = 'playing'; }
  pause() { if (this.phase !== 'dead') this.phase = 'paused'; }
  advance(delta: number) { if (this.phase === 'playing') this.elapsed += delta; }
  attack(seconds = 0.4) {
    if (this.phase !== 'playing' || this.elapsed + 1e-9 < this.attackUntil) return false;
    this.attackUntil = this.elapsed + seconds; return true;
  }
  damage(amount: number, reason: string, creative: boolean) {
    if (creative || this.phase !== 'playing' || this.elapsed < this.hurtUntil || amount <= 0) return false;
    this.hurtUntil = this.elapsed + 0.5;
    this.health = Math.max(0, this.health - amount);
    if (this.health === 0) { this.phase = 'dead'; this.deathReason = reason; }
    return true;
  }
  respawn() {
    this.health = 20; this.hunger = 20; this.oxygen = 10;
    this.phase = 'paused'; this.hurtUntil = this.elapsed + 2;
    this.attackUntil = this.elapsed; this.deathReason = '';
    this.exhaustion = 0; this.regenerationTimer = 0; this.starvationTimer = 0;
  }
}

/** Dry support with enough space for the complete player body; never spawn in water or a roof. */
export function findSafeSpawn(world: VoxelWorld, origin = new THREE.Vector3(8, 0, 8)) {
  for (let ring = 0; ring <= 32; ring++) {
    for (let dx = -ring; dx <= ring; dx++) for (let dz = -ring; dz <= ring; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
      const x = Math.floor(origin.x) + dx, z = Math.floor(origin.z) + dz;
      world.generateChunk(Math.floor(x / 16), Math.floor(z / 16));
      const column = world.chunkData.get(world.getChunkKey(Math.floor(x / 16), Math.floor(z / 16))) ?? [];
      let top = world.getTerrainHeight(x, z).height;
      for (const b of column) if (b.x === x && b.z === z) top = Math.max(top, b.y);
      for (let y = top; y >= -13; y--) {
        const support = world.getBlock(x, y, z);
        if (!support || !BLOCK_DEFS[support]?.isSolid || support === BLOCKS.LEAVES) continue;
        if ([1, 2, 3].some(dy => { const b = world.getBlock(x, y + dy, z); return b === BLOCKS.WATER || !!(b && BLOCK_DEFS[b]?.isSolid); })) break;
        return new THREE.Vector3(x + 0.5, y + 1 + 1.62 + 0.01, z + 0.5);
      }
    }
  }
  // If a player flooded/filled the entire search area, a small deterministic refuge is safe.
  const x = Math.floor(origin.x), z = Math.floor(origin.z);
  const y = Math.max(world.getTerrainHeight(x, z).height + 2, 4);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    for (let dy = 0; dy <= 3; dy++) world.removeBlock(x + dx, y + dy, z + dz, false, false);
    world.addBlock(x + dx, y, z + dz, BLOCKS.STONE, false);
  }
  world.updateInstancedMeshes();
  return new THREE.Vector3(x + 0.5, y + 2.63, z + 0.5);
}
export function resetPlayerView(camera: THREE.PerspectiveCamera, player: { velocity: THREE.Vector3; onGround: boolean; flying: boolean }) {
  camera.rotation.set(0, 0, 0, 'YXZ');
  player.velocity.set(0, 0, 0); player.onGround = false; player.flying = false;
}
