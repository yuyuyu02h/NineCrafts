import * as THREE from 'three';

export type BlockType = number;

export interface ItemDef {
  id: string;
  name: string;
  isBlock: boolean;
  blockType?: BlockType;
  maxStack: number;
  textureId: string;
  toolType?: 'pickaxe' | 'axe' | 'sword' | 'shovel' | 'bow';
  toolTier?: number; // 1: wood, 2: stone, 3: iron, 4: diamond
  damage?: number;
  durability?: number;
  foodRestore?: { health: number; hunger: number };
  description?: string;
}

export interface InventorySlot {
  itemId: string | null;
  count: number;
  durability?: number;
}

export type GameMode = 'survival' | 'creative';

export interface MobEntity {
  id: number;
  type: 'pig' | 'cow' | 'sheep' | 'zombie' | 'creeper' | 'skeleton' | 'spider';
  name: string;
  mesh: THREE.Group;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotation: number;
  hp: number;
  maxHp: number;
  isHostile: boolean;
  speed: number;
  attackCooldown: number;
  exploding?: boolean;
  fuseTime?: number;
  hurtTimer?: number;
}

export interface ArrowEntity {
  mesh: THREE.Mesh;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  fromPlayer: boolean;
  life: number;
}

export interface DebrisParticle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
}

export interface TorchLight {
  light: THREE.PointLight;
  x: number;
  y: number;
  z: number;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  unlocked: boolean;
}
