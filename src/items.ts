import { ITEMS } from './blocks';
import { matchRecipe, type CraftingRecipe } from './recipes';
import { consumeSlot, emptyFurnace, emptySlot, FUEL_SECONDS, smeltingRecipe, type FurnaceState } from './furnace';
import type { InventorySlot } from './types';

export interface ItemState {
  inventory: InventorySlot[];
  cursorItem: InventorySlot | null;
  craft2x2: (string | null)[][];
  craft3x3: (string | null)[][];
  furnaces: Record<string, FurnaceState>;
  legacyFurnace: FurnaceState | null;
  chests: Record<string, InventorySlot[]>;
  legacyChest: InventorySlot[] | null;
}
export const emptyGrid = (size: number): (string | null)[][] => Array.from({ length: size }, () => Array(size).fill(null));
export function initialItems(): ItemState {
  const inventory = Array.from({ length: 36 }, emptySlot);
  inventory.splice(0, 5, stack('wood', 16), stack('planks', 32), stack('water_bucket', 1), stack('torch', 16), stack('apple', 8));
  return { inventory, cursorItem: null, craft2x2: emptyGrid(2), craft3x3: emptyGrid(3), furnaces: {}, legacyFurnace: null, chests: {}, legacyChest: null };
}
export function stack(itemId: string, count: number, durability?: number): InventorySlot {
  const max = ITEMS[itemId]?.durability;
  return { itemId, count, ...(max ? { durability: durability ?? max } : {}) };
}
export const sameStack = (a: InventorySlot, b: InventorySlot) => a.itemId === b.itemId &&
  (a.durability ?? ITEMS[a.itemId ?? '']?.durability) === (b.durability ?? ITEMS[b.itemId ?? '']?.durability);

export function insertStack(inventory: InventorySlot[], incoming: InventorySlot) {
  const def = incoming.itemId ? ITEMS[incoming.itemId] : null;
  if (!def || !Number.isInteger(incoming.count) || incoming.count <= 0) return { inventory, accepted: 0, remaining: incoming.count };
  const next = inventory.slice();
  let remaining = incoming.count;
  for (let pass = 0; pass < 2 && remaining > 0; pass++) {
    for (let i = 0; i < next.length && remaining > 0; i++) {
      const slot = next[i];
      if (pass === 0 ? !slot.itemId || !sameStack(slot, incoming) : !!slot.itemId) continue;
      const count = Math.min(remaining, def.maxStack - (slot.itemId ? slot.count : 0));
      if (count <= 0) continue;
      next[i] = stack(incoming.itemId!, (slot.itemId ? slot.count : 0) + count, incoming.durability);
      remaining -= count;
    }
  }
  return { inventory: remaining === incoming.count ? inventory : next, accepted: incoming.count - remaining, remaining };
}

export function clickInventory(state: ItemState, index: number, secondary = false): ItemState {
  const slot = state.inventory[index];
  if (!slot) return state;
  const cursor = state.cursorItem;
  const inventory = state.inventory.slice();
  if (!cursor?.itemId) {
    if (!slot.itemId) return state;
    const count = secondary ? Math.ceil(slot.count / 2) : slot.count;
    inventory[index] = consumeSlot(slot, count);
    return { ...state, inventory, cursorItem: { ...slot, count } };
  }
  if (secondary && (!slot.itemId || sameStack(slot, cursor))) {
    if (slot.count >= ITEMS[cursor.itemId].maxStack) return state;
    inventory[index] = { ...cursor, count: slot.count + 1 };
    return { ...state, inventory, cursorItem: cursor.count > 1 ? consumeSlot(cursor) : null };
  }
  if (slot.itemId && sameStack(slot, cursor)) {
    const add = Math.min(cursor.count, ITEMS[cursor.itemId].maxStack - slot.count);
    if (add <= 0) return state;
    inventory[index] = { ...slot, count: slot.count + add };
    return { ...state, inventory, cursorItem: cursor.count > add ? { ...cursor, count: cursor.count - add } : null };
  }
  inventory[index] = cursor;
  return { ...state, inventory, cursorItem: slot.itemId ? slot : null };
}

export function returnCursor(state: ItemState): ItemState {
  if (!state.cursorItem?.itemId) return state;
  const result = insertStack(state.inventory, state.cursorItem);
  if (!result.accepted) return state;
  return { ...state, inventory: result.inventory, cursorItem: result.remaining ? { ...state.cursorItem, count: result.remaining } : null };
}

export function clickCraftCell(state: ItemState, row: number, col: number, size: 2 | 3, active: number): ItemState {
  const name = size === 2 ? 'craft2x2' : 'craft3x3';
  const grid = state[name];
  if (!grid[row] || col < 0 || col >= size) return state;
  const cell = grid[row][col];
  let inventory = state.inventory;
  let cursorItem = state.cursorItem;
  const next = grid.map(r => r.slice());
  if (!cursorItem?.itemId && cell) {
    next[row][col] = null;
    return { ...state, [name]: next, cursorItem: stack(cell, 1) };
  }
  const source = cursorItem?.itemId ? cursorItem : inventory[active];
  // Recipe cells store one material ID, never a tool's wear information.
  if (!source?.itemId || source.count <= 0 || ITEMS[source.itemId].durability || source.itemId === cell) return state;
  if (cell) {
    const returned = insertStack(inventory, stack(cell, 1));
    if (returned.remaining) return state;
    inventory = returned.inventory;
  }
  next[row][col] = source.itemId;
  if (cursorItem?.itemId) cursorItem = cursorItem.count > 1 ? consumeSlot(cursorItem) : null;
  else { inventory = inventory.slice(); inventory[active] = consumeSlot(inventory[active]); }
  return { ...state, inventory, cursorItem, [name]: next };
}

export function craftGrid(state: ItemState, size: 2 | 3): ItemState {
  const name = size === 2 ? 'craft2x2' : 'craft3x3';
  const matched = matchRecipe(state[name], size);
  if (!matched) return state;
  const result = insertStack(state.inventory, stack(matched.result.itemId, matched.result.count));
  if (result.remaining) return state;
  return { ...state, inventory: result.inventory, [name]: emptyGrid(size) };
}

export function recipeMaterials(recipe: CraftingRecipe): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const id of recipe.pattern.flat()) if (id) counts[id] = (counts[id] ?? 0) + 1;
  return counts;
}
export function quickCraft(inventory: InventorySlot[], recipe: CraftingRecipe, creative = false): { inventory: InventorySlot[]; reason: string } {
  let next = inventory.slice();
  if (!creative) {
    for (const [id, required] of Object.entries(recipeMaterials(recipe))) {
      if (inventory.reduce((sum, s) => sum + (s.itemId === id ? s.count : 0), 0) < required) {
        return { inventory, reason: `${ITEMS[id].name}が不足しています` };
      }
      let left = required;
      next = next.map(slot => {
        if (slot.itemId !== id || !left) return slot;
        const count = Math.min(left, slot.count); left -= count;
        return consumeSlot(slot, count);
      });
    }
  }
  const result = insertStack(next, stack(recipe.result.itemId, recipe.result.count));
  return result.remaining ? { inventory, reason: '完成品を入れる空きがありません' } : { inventory: result.inventory, reason: '' };
}

export function ensureFurnace(state: ItemState, key: string): ItemState {
  if (Object.hasOwn(state.furnaces, key)) return state;
  return { ...state, furnaces: { ...state.furnaces, [key]: state.legacyFurnace ?? emptyFurnace() }, legacyFurnace: null };
}
export function clickFurnaceSlot(state: ItemState, key: string, kind: 'input' | 'fuel', secondary = false): ItemState {
  const furnace = state.furnaces[key];
  if (!furnace) return state;
  const held = state.cursorItem;
  const slot = furnace[kind];
  if (held?.itemId && !(kind === 'input' ? smeltingRecipe(held.itemId) : FUEL_SECONDS[held.itemId])) return state;
  if (secondary) {
    const moved = clickInventory({ ...state, inventory: [slot] }, 0, true);
    const target = moved.inventory[0];
    return { ...state, cursorItem: moved.cursorItem, furnaces: { ...state.furnaces, [key]: {
      ...furnace, [kind]: target, progress: kind === 'input' && target.itemId !== slot.itemId ? 0 : furnace.progress,
    } } };
  }
  if (!held?.itemId && !slot.itemId) return state;
  let cursorItem: InventorySlot | null;
  let target: InventorySlot;
  if (held?.itemId && slot.itemId && sameStack(held, slot)) {
    const moved = Math.min(held.count, ITEMS[held.itemId].maxStack - slot.count);
    if (!moved) return state;
    target = { ...slot, count: slot.count + moved };
    cursorItem = held.count > moved ? consumeSlot(held, moved) : null;
  } else { target = held ?? emptySlot(); cursorItem = slot.itemId ? slot : null; }
  const progress = kind === 'input' && target.itemId !== slot.itemId ? 0 : furnace.progress;
  return { ...state, cursorItem, furnaces: { ...state.furnaces, [key]: { ...furnace, [kind]: target, progress } } };
}
export function collectFurnace(state: ItemState, key: string): ItemState {
  const furnace = state.furnaces[key];
  if (!furnace?.output.itemId) return state;
  const result = insertStack(state.inventory, furnace.output);
  if (!result.accepted) return state;
  return { ...state, inventory: result.inventory, furnaces: { ...state.furnaces, [key]: { ...furnace, output: consumeSlot(furnace.output, result.accepted) } } };
}

export function wearTool(inventory: InventorySlot[], index: number): InventorySlot[] {
  const slot = inventory[index];
  const max = slot?.itemId ? ITEMS[slot.itemId]?.durability : undefined;
  if (!max) return inventory;
  const durability = (slot.durability ?? max) - 1;
  const next = inventory.slice();
  next[index] = durability > 0 ? { ...slot, durability } : emptySlot();
  return next;
}

export function ensureChest(state: ItemState, key: string): ItemState {
  if (Object.hasOwn(state.chests, key)) return state;
  return { ...state, chests: { ...state.chests, [key]: state.legacyChest ?? Array.from({ length: 27 }, emptySlot) }, legacyChest: null };
}
export function clickChest(state: ItemState, key: string, index: number, secondary = false): ItemState {
  const slots = state.chests[key];
  if (!slots || !slots[index]) return state;
  const container = { ...state, inventory: slots };
  const moved = clickInventory(container, index, secondary);
  return moved === container ? state : { ...state, cursorItem: moved.cursorItem, chests: { ...state.chests, [key]: moved.inventory } };
}

/** Shift-click transfers only the accepted amount, never dropping leftovers. */
export function quickMoveInventory(state: ItemState, index: number, chestKey?: string | null, furnaceKey?: string | null): ItemState {
  const source = state.inventory[index];
  if (!source?.itemId) return state;
  const finish = (accepted: number) => {
    const inventory = state.inventory.slice(); inventory[index] = consumeSlot(source, accepted); return inventory;
  };
  if (chestKey && state.chests[chestKey]) {
    const result = insertStack(state.chests[chestKey], source);
    return result.accepted ? { ...state, inventory: finish(result.accepted), chests: { ...state.chests, [chestKey]: result.inventory } } : state;
  }
  if (furnaceKey && state.furnaces[furnaceKey]) {
    const furnace = state.furnaces[furnaceKey];
    const kind = smeltingRecipe(source.itemId) ? 'input' : FUEL_SECONDS[source.itemId] ? 'fuel' : null;
    if (!kind) return state;
    const result = insertStack([furnace[kind]], source);
    return result.accepted ? { ...state, inventory: finish(result.accepted), furnaces: { ...state.furnaces, [furnaceKey]: {
      ...furnace, [kind]: result.inventory[0], progress: kind === 'input' && furnace.input.itemId !== source.itemId ? 0 : furnace.progress,
    } } } : state;
  }
  const start = index < 9 ? 9 : 0, end = index < 9 ? 36 : 9;
  const result = insertStack(state.inventory.slice(start, end), source);
  if (!result.accepted) return state;
  const inventory = finish(result.accepted); inventory.splice(start, end - start, ...result.inventory);
  return { ...state, inventory };
}
export function collectChestSlot(state: ItemState, key: string, index: number): ItemState {
  const slot = state.chests[key]?.[index];
  if (!slot?.itemId) return state;
  const result = insertStack(state.inventory, slot);
  if (!result.accepted) return state;
  const slots = state.chests[key].slice(); slots[index] = consumeSlot(slot, result.accepted);
  return { ...state, inventory: result.inventory, chests: { ...state.chests, [key]: slots } };
}
