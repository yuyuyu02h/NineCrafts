import { ITEMS } from './blocks';
import { SMELTING_RECIPES } from './recipes';
import type { InventorySlot } from './types';

export interface FurnaceState {
  input: InventorySlot;
  fuel: InventorySlot;
  output: InventorySlot;
  /** Seconds of work on the current input. */
  progress: number;
  fuelTime: number;
}
export const FUEL_SECONDS: Readonly<Record<string, number>> = { coal: 28, wood: 7, planks: 3.5, stick: 1.75 };
export const emptySlot = (): InventorySlot => ({ itemId: null, count: 0 });
export const emptyFurnace = (): FurnaceState => ({ input: emptySlot(), fuel: emptySlot(), output: emptySlot(), progress: 0, fuelTime: 0 });
export const consumeSlot = (slot: InventorySlot, count = 1): InventorySlot =>
  slot.count > count ? { ...slot, count: slot.count - count } : emptySlot();
export const smeltingRecipe = (id: string | null) => SMELTING_RECIPES.find(r => r.input === id);

/** Productive-time fuel: blocked output/input preserves fuel and partial work. No offline catch-up. */
export function stepFurnace(state: FurnaceState, delta: number): FurnaceState {
  if (!Number.isFinite(delta) || delta <= 0) return state;
  const recipe = smeltingRecipe(state.input.itemId);
  if (!recipe || state.input.count <= 0 || (state.output.itemId && state.output.itemId !== recipe.output) ||
    state.output.count >= ITEMS[recipe.output].maxStack) return state;
  const next = { ...state };
  let remaining = Math.min(delta, 1);
  let changed = false;
  while (remaining > 1e-9 && next.input.count > 0 && next.output.count < ITEMS[recipe.output].maxStack) {
    if (next.fuelTime <= 1e-9) {
      const fuelDuration = next.fuel.itemId ? FUEL_SECONDS[next.fuel.itemId] : 0;
      if (!fuelDuration || next.fuel.count <= 0) break;
      next.fuel = consumeSlot(next.fuel);
      next.fuelTime = fuelDuration;
      changed = true;
    }
    const elapsed = Math.min(remaining, next.fuelTime, Math.max(0, recipe.cookTime - next.progress));
    next.progress += elapsed;
    next.fuelTime = Math.max(0, next.fuelTime - elapsed);
    remaining -= elapsed;
    changed ||= elapsed > 0;
    if (next.progress + 1e-9 >= recipe.cookTime) {
      next.input = consumeSlot(next.input);
      next.output = { itemId: recipe.output, count: next.output.count + 1 };
      next.progress = 0;
      changed = true;
    }
    if (elapsed <= 0 && next.progress !== 0) break;
  }
  return changed ? next : state;
}
