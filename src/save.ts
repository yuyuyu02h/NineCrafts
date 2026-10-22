import { BLOCKS, ITEMS, type BlockId } from './blocks';
import type { GameMode, InventorySlot } from './types';
import { SMELTING_RECIPES } from './recipes';
import type { FurnaceState } from './furnace';

export const SAVE_VERSION = 3;
export const MAX_EDITS = 500_000;
export interface WorldSave {
  seed: number;
  waterLevels?: Array<{ x: number; y: number; z: number; spread: number }>;
  edits: Array<{ x: number; y: number; z: number; type: BlockId }>;
}
export interface GameSave {
  version: typeof SAVE_VERSION;
  savedAt: number;
  world: WorldSave;
  player: {
    position: [number, number, number];
    rotation: [number, number, number];
    health: number;
    hunger: number;
    oxygen: number;
    flying: boolean;
  };
  timeOfDay: number;
  inventory: InventorySlot[];
  activeSlot: number;
  cursorItem: InventorySlot | null;
  craft2x2: (string | null)[][];
  craft3x3: (string | null)[][];
  furnaces: Record<string, FurnaceState>;
  legacyFurnace: FurnaceState | null;
  chests: Record<string, InventorySlot[]>;
  legacyChest: InventorySlot[] | null;
  primedTnt: Array<{ x: number; y: number; z: number; remaining: number }>;
  achievements: string[];
  drops: Array<{ itemId: string; count: number; durability?: number; position: [number, number, number]; velocity: [number, number, number]; life: number }>;
  settings: {
    gameMode: GameMode;
    soundEnabled: boolean;
    musicEnabled: boolean;
    fov: number;
    renderDist: number;
    peaceful: boolean;
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const numberIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const integerIn = (v: unknown, min: number, max: number): v is number => numberIn(v, min, max) && Number.isInteger(v);
const itemId = (v: unknown): v is string => typeof v === 'string' && Object.hasOwn(ITEMS, v);
function slot(v: unknown): v is InventorySlot {
  if (!isRecord(v)) return false;
  if (v.itemId === null) return v.count === 0 && v.durability === undefined;
  if (!itemId(v.itemId) || !integerIn(v.count, 1, ITEMS[v.itemId].maxStack)) return false;
  const maxDurability = ITEMS[v.itemId].durability;
  return v.durability === undefined || (!!maxDurability && integerIn(v.durability, 1, maxDurability));
}
const slots = (v: unknown, size: number): v is InventorySlot[] => Array.isArray(v) && v.length === size && v.every(slot);
const grid = (v: unknown, size: number): boolean => Array.isArray(v) && v.length === size &&
  v.every(row => Array.isArray(row) && row.length === size && row.every(cell => cell === null || itemId(cell)));
const triple = (v: unknown, min: number, max: number): boolean =>
  Array.isArray(v) && v.length === 3 && v.every(n => numberIn(n, min, max));

function validFurnace(value: unknown, legacy = false): value is FurnaceState {
  return isRecord(value) && slot(value.input) && slot(value.fuel) && slot(value.output) &&
    numberIn(value.progress, 0, legacy ? 110 : Math.max(...SMELTING_RECIPES.map(r => r.cookTime))) && numberIn(value.fuelTime, 0, 1_000_000);
}
function validFurnaces(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length <= 10_000 && Object.entries(value).every(([key, data]) =>
    /^-?\d+,-?\d+,-?\d+$/.test(key) && key.split(',').map(Number).join(',') === key &&
    key.split(',').every(n => integerIn(Number(n), -10_000_000, 10_000_000)) && validFurnace(data));
}

const coordinateKey = (key: string) => /^-?\d+,-?\d+,-?\d+$/.test(key) && key.split(',').map(Number).join(',') === key && key.split(',').every(n => integerIn(Number(n), -10_000_000, 10_000_000));
function validChests(value: unknown) {
  return isRecord(value) && Object.keys(value).length <= 10_000 && Object.entries(value).every(([key, data]) => coordinateKey(key) && slots(data, 27));
}
function validTnt(value: unknown) {
  return Array.isArray(value) && value.length <= 128 && value.every(t => isRecord(t) && [t.x, t.y, t.z].every(n => integerIn(n, -10_000_000, 10_000_000)) && numberIn(t.remaining, 0, 1.5));
}

// Validate before any live-world mutation. Unknown versions are never reset or overwritten.
export function parseSave(value: unknown): GameSave {
  if (!isRecord(value) || ![1, 2, SAVE_VERSION].includes(value.version as number)) throw new Error('未対応の保存形式です。保存データは上書きしていません。');
  const { world, player, settings } = value;
  const legacy = value.version === 1;
  if (!isRecord(world) || !integerIn(world.seed, 0, 0xffffffff) || !Array.isArray(world.edits) || world.edits.length > MAX_EDITS) {
    throw new Error('ワールドの保存データが壊れています。');
  }
  const blockIds = new Set<number>(Object.values(BLOCKS));
  const seen = new Set<string>();
  for (const b of world.edits) {
    if (!isRecord(b) || !integerIn(b.x, -10_000_000, 10_000_000) || !integerIn(b.y, -10_000_000, 10_000_000) ||
      !integerIn(b.z, -10_000_000, 10_000_000) || typeof b.type !== 'number' || !blockIds.has(b.type)) {
      throw new Error('ブロックの保存データが壊れています。');
    }
    const key = `${b.x},${b.y},${b.z}`;
    if (seen.has(key)) throw new Error('ブロックの保存データが重複しています。');
    seen.add(key);
  }
  if (!isRecord(player) || !triple(player.position, -10_000_000, 10_000_000) || !triple(player.rotation, -Math.PI * 2, Math.PI * 2) ||
    !numberIn(player.health, 0, 20) || !numberIn(player.hunger, 0, 20) || !numberIn(player.oxygen, 0, 10) || typeof player.flying !== 'boolean' ||
    !numberIn(value.timeOfDay, 0, Math.PI * 2) || !numberIn(value.savedAt, 0, 8.64e15) ||
    !slots(value.inventory, 36) || !integerIn(value.activeSlot, 0, 8) || !(value.cursorItem === null || slot(value.cursorItem)) ||
    !grid(value.craft2x2, 2) || !grid(value.craft3x3, 3) ||
    !(value.version !== SAVE_VERSION ? slots(value.chestSlots, 27) : validChests(value.chests) && (value.legacyChest === null || slots(value.legacyChest, 27)) && validTnt(value.primedTnt)) ||
    !Array.isArray(value.achievements) || value.achievements.length > 64 ||
    !value.achievements.every(id => typeof id === 'string' && /^[a-z_]{1,40}$/.test(id)) ||
    !Array.isArray(value.drops) || value.drops.length > 10_000 || !value.drops.every(drop =>
      isRecord(drop) && slot({ itemId: drop.itemId, count: drop.count, durability: drop.durability }) &&
      triple(drop.position, -10_000_000, 10_000_000) && triple(drop.velocity, -10_000, 10_000) && numberIn(drop.life, 0, 180)) ||
    !(legacy ? validFurnace(value.furnace, true) : validFurnaces(value.furnaces) && (value.legacyFurnace === null || validFurnace(value.legacyFurnace))) ||
    !isRecord(settings) || (settings.gameMode !== 'survival' && settings.gameMode !== 'creative') ||
    !numberIn(settings.fov, 60, 100) || !integerIn(settings.renderDist, 1, 4) ||
    !['soundEnabled', 'musicEnabled', 'peaceful'].every(key => typeof settings[key] === 'boolean')) {
    throw new Error('プレイヤー・所持品の保存データが壊れています。');
  }
  if (world.waterLevels !== undefined) {
    const water = new Set(world.edits.filter(b => isRecord(b) && b.type === BLOCKS.WATER).map(b => { const cell = b as Record<string, unknown>; return `${cell.x},${cell.y},${cell.z}`; }));
    const seenWater = new Set<string>();
    if (!Array.isArray(world.waterLevels) || world.waterLevels.length > MAX_EDITS || !world.waterLevels.every(b => {
      if (!isRecord(b) || ![b.x, b.y, b.z].every(n => integerIn(n, -10_000_000, 10_000_000)) || !integerIn(b.spread, 0, 3)) return false;
      const key = `${b.x},${b.y},${b.z}`;
      if (!water.has(key) || seenWater.has(key)) return false;
      seenWater.add(key); return true;
    })) throw new Error('水流の保存データが壊れています。');
  }
  const result = structuredClone(value);
  if (legacy) {
    const old = result.furnace as FurnaceState;
    const recipe = SMELTING_RECIPES.find(r => r.input === old.input.itemId);
    const hasContents = [old.input, old.fuel, old.output].some(s => s.itemId) || old.fuelTime > 0;
    result.legacyFurnace = hasContents ? { ...old, progress: recipe ? Math.min(1, old.progress / 100) * recipe.cookTime : 0 } : null;
    result.furnaces = {};
    result.version = SAVE_VERSION;
    delete result.furnace;
  }
  if (value.version !== SAVE_VERSION) {
    const old = result.chestSlots as InventorySlot[];
    result.chests = {}; result.legacyChest = old.some(slot => slot.itemId) ? old : null;
    result.primedTnt = []; delete result.chestSlots;
    result.version = SAVE_VERSION;
  }
  return result as unknown as GameSave;
}
