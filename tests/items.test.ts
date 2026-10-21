import test from 'node:test';
import assert from 'node:assert/strict';
import { initialItems, stack, insertStack, clickInventory, returnCursor, clickCraftCell, craftGrid, quickCraft, ensureFurnace, clickFurnaceSlot, collectFurnace, wearTool } from '../src/items';
import { emptySlot, emptyFurnace, stepFurnace } from '../src/furnace';
import { CRAFTING_RECIPES } from '../src/recipes';
import { miningRule, toolSignature } from '../src/mining';
import { BLOCKS } from '../src/blocks';

const full = () => Array.from({ length: 36 }, () => stack('stone', 64));
const blank = () => ({ ...initialItems(), inventory: Array.from({ length: 36 }, emptySlot) });
const recipe = (id: string) => CRAFTING_RECIPES.find(r => r.id === id)!;

test('full and partial pickup returns exact accepted/remaining amounts without mutating input', () => {
  const inventory = full();
  assert.deepEqual(insertStack(inventory, stack('wood', 5)), { inventory, accepted: 0, remaining: 5 });
  inventory[0] = stack('wood', 63);
  const result = insertStack(inventory, stack('wood', 5));
  assert.equal(result.accepted, 1); assert.equal(result.remaining, 4);
  assert.equal(result.inventory[0].count, 64); assert.equal(inventory[0].count, 63);
});

test('cursor close preserves leftovers and tool swaps preserve durability', () => {
  const state = { ...blank(), inventory: full(), cursorItem: stack('wood', 5) };
  assert.equal(returnCursor(state), state);
  state.inventory[0] = stack('wood', 63);
  const next = returnCursor(state);
  assert.equal(next.cursorItem?.count, 4);
  assert.equal(next.inventory[0].count, 64);
  const tools = { ...blank(), cursorItem: stack('wood_pickaxe', 1, 2) };
  tools.inventory[0] = stack('iron_pickaxe', 1, 9);
  const swapped = clickInventory(tools, 0);
  assert.equal(swapped.inventory[0].durability, 2);
  assert.equal(swapped.cursorItem?.durability, 9);
});

test('a blocked crafting result preserves the whole grid and repeated clicks cannot duplicate output', () => {
  const state = { ...blank(), inventory: full(), craft2x2: [['wood', null], [null, null]] };
  assert.equal(craftGrid(state, 2), state);
  state.inventory[0] = emptySlot();
  const next = craftGrid(state, 2);
  assert.equal(next.inventory[0].itemId, 'planks'); assert.equal(next.inventory[0].count, 4);
  assert.equal(craftGrid(next, 2), next);
  assert.equal(next.craft2x2.flat().filter(Boolean).length, 0);
});

test('craft-cell swaps reject missing capacity without losing the old ingredient or cursor', () => {
  const state = { ...blank(), inventory: full(), cursorItem: stack('wood', 2), craft2x2: [['planks', null], [null, null]] };
  assert.equal(clickCraftCell(state, 0, 0, 2, 0), state);
  const holdingTool = { ...blank(), cursorItem: stack('wood_pickaxe', 1, 2) };
  assert.equal(clickCraftCell(holdingTool, 0, 0, 2, 0), holdingTool);
});

test('quick crafting consumes ingredients once, rejects shortage, and rolls back blocked output', () => {
  const inventory = blank().inventory; inventory[0] = stack('wood', 1);
  const once = quickCraft(inventory, recipe('planks'));
  assert.equal(once.reason, ''); assert.equal(once.inventory[0].itemId, 'planks'); assert.equal(once.inventory[0].count, 4);
  assert.notEqual(quickCraft(once.inventory, recipe('planks')).reason, '');
  assert.equal(inventory[0].count, 1);
  const blocked = full(); blocked[0] = stack('wood', 2);
  const rejected = quickCraft(blocked, recipe('planks'));
  assert.equal(rejected.inventory, blocked); assert.equal(blocked[0].count, 2);
  blocked[0] = stack('wood', 1);
  assert.equal(quickCraft(blocked, recipe('planks')).reason, '', 'consuming the final ingredient may free output space');
});

test('quick crafting can consume materials across stacks; creative bypass is explicit', () => {
  const inventory = blank().inventory;
  inventory[0] = stack('planks', 2); inventory[1] = stack('planks', 2);
  const next = quickCraft(inventory, recipe('crafting_table'));
  assert.equal(next.reason, ''); assert.equal(next.inventory.filter(s => s.itemId === 'planks').length, 0);
  assert.notEqual(quickCraft(blank().inventory, recipe('diamond_pickaxe')).reason, '');
  assert.equal(quickCraft(blank().inventory, recipe('diamond_pickaxe'), true).reason, '');
});

test('furnace input and fuel move from inventory through cursor without copying', () => {
  let state = blank(); state.inventory[0] = stack('iron_ore', 5); state.inventory[1] = stack('coal', 1);
  state = ensureFurnace(state, '1,2,3');
  state = clickFurnaceSlot(clickInventory(state, 0), '1,2,3', 'input');
  assert.equal(state.inventory[0].itemId, null); assert.equal(state.cursorItem, null);
  assert.equal(state.furnaces['1,2,3'].input.count, 5);
  state = clickFurnaceSlot(clickInventory(state, 1), '1,2,3', 'fuel');
  assert.equal(state.inventory[1].itemId, null); assert.equal(state.furnaces['1,2,3'].fuel.count, 1);
  const removed = clickFurnaceSlot(state, '1,2,3', 'input');
  assert.equal(removed.cursorItem?.count, 5); assert.equal(removed.furnaces['1,2,3'].input.count, 0);
});

test('furnace uses cookTime and fuel only while productive, including depleted fuel', () => {
  let furnace = { ...emptyFurnace(), input: stack('iron_ore', 9), fuel: stack('coal', 1) };
  for (let i = 0; i < 34; i++) furnace = stepFurnace(furnace, 0.1);
  assert.equal(furnace.output.count, 0);
  furnace = stepFurnace(furnace, 0.1);
  assert.equal(furnace.output.count, 1); assert.equal(furnace.input.count, 8); assert.equal(furnace.fuel.count, 0);
  for (let i = 0; i < 1000; i++) furnace = stepFurnace(furnace, 0.1);
  assert.equal(furnace.output.count, 8); assert.equal(furnace.input.count, 1); assert.equal(furnace.fuelTime, 0);
});

test('missing fuel, mismatched/full output and pause never consume resources', () => {
  const noFuel = { ...emptyFurnace(), input: stack('sand', 3) };
  assert.equal(stepFurnace(noFuel, 1), noFuel);
  for (const output of [stack('iron_ingot', 1), stack('glass', 64)]) {
    const blocked = { ...noFuel, output, fuel: stack('coal', 2), fuelTime: 7, progress: 1 };
    assert.equal(stepFurnace(blocked, 1), blocked);
  }
  const ready = { ...noFuel, fuel: stack('coal', 1) };
  assert.equal(stepFurnace(ready, 0), ready);
});

test('furnace output collection leaves the unaccepted remainder and separate furnaces stay independent', () => {
  let state = ensureFurnace(ensureFurnace({ ...blank(), inventory: full() }, '0,0,0'), '1,0,0');
  state.furnaces['0,0,0'] = { ...emptyFurnace(), output: stack('iron_ingot', 5) };
  assert.equal(collectFurnace(state, '0,0,0'), state);
  state.inventory[0] = stack('iron_ingot', 63);
  const next = collectFurnace(state, '0,0,0');
  assert.equal(next.inventory[0].count, 64); assert.equal(next.furnaces['0,0,0'].output.count, 4);
  assert.equal(next.furnaces['1,0,0'].output.count, 0);
});

test('legacy furnace contents are attached to exactly one placed furnace', () => {
  const legacy = { ...emptyFurnace(), input: stack('sand', 3) };
  let state = ensureFurnace({ ...blank(), legacyFurnace: legacy }, '0,0,0');
  state = ensureFurnace(state, '1,0,0');
  assert.equal(state.legacyFurnace, null); assert.equal(state.furnaces['0,0,0'].input.count, 3);
  assert.equal(state.furnaces['1,0,0'].input.count, 0);
});

test('tool progression gates stone/iron/diamond and suitable tools accelerate mining', () => {
  assert.equal(miningRule(BLOCKS.STONE, emptySlot()).allowed, false);
  assert.equal(miningRule(BLOCKS.STONE, stack('wood_pickaxe', 1)).allowed, true);
  assert.equal(miningRule(BLOCKS.IRON_ORE, stack('wood_pickaxe', 1)).allowed, false);
  assert.equal(miningRule(BLOCKS.IRON_ORE, stack('stone_pickaxe', 1)).allowed, true);
  assert.equal(miningRule(BLOCKS.DIAMOND_ORE, stack('stone_pickaxe', 1)).allowed, false);
  assert.equal(miningRule(BLOCKS.DIAMOND_ORE, stack('iron_pickaxe', 1)).allowed, true);
  assert.ok(miningRule(BLOCKS.WOOD, stack('wood_axe', 1)).seconds < miningRule(BLOCKS.WOOD, emptySlot()).seconds);
  assert.equal(miningRule(BLOCKS.BEDROCK, stack('diamond_pickaxe', 1), true).allowed, false);
});

test('durability decreases per completed use, breaks at zero, and participates in mining cancellation', () => {
  const inventory = blank().inventory; inventory[0] = stack('wood_pickaxe', 1, 2);
  const worn = wearTool(inventory, 0); assert.equal(worn[0].durability, 1); assert.equal(inventory[0].durability, 2);
  assert.notEqual(toolSignature(0, inventory[0]), toolSignature(0, worn[0]));
  assert.notEqual(toolSignature(0, inventory[0]), toolSignature(1, inventory[0]));
  assert.deepEqual(wearTool(worn, 0)[0], emptySlot());
});

test('mixed inventory/cursor/grid/furnace moves conserve every material across 2000 operations', () => {
  let state = blank();
  state.inventory[0] = stack('wood', 64); state.inventory[1] = stack('planks', 32);
  state.inventory[2] = stack('coal', 7); state.inventory[3] = stack('iron_ore', 12);
  state.inventory[4] = stack('wood_pickaxe', 1, 3);
  state = ensureFurnace(state, '0,0,0');
  const tally = (value: typeof state) => {
    const counts: Record<string, number> = {};
    const add = (id: string | null, n: number) => { if (id) counts[id] = (counts[id] ?? 0) + n; };
    value.inventory.forEach(s => add(s.itemId, s.count));
    if (value.cursorItem) add(value.cursorItem.itemId, value.cursorItem.count);
    [...value.craft2x2.flat(), ...value.craft3x3.flat()].forEach(id => add(id, 1));
    Object.values(value.furnaces).forEach(f => [f.input, f.fuel, f.output].forEach(s => add(s.itemId, s.count)));
    return Object.entries(counts).filter(([, count]) => count > 0).sort(([a], [b]) => a.localeCompare(b));
  };
  const expected = tally(state);
  let seed = 42;
  const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let i = 0; i < 2000; i++) {
    switch (random(5)) {
      case 0: state = clickInventory(state, random(36)); break;
      case 1: state = returnCursor(state); break;
      case 2: state = clickCraftCell(state, random(2), random(2), 2, random(5)); break;
      case 3: state = clickFurnaceSlot(state, '0,0,0', random(2) ? 'input' : 'fuel'); break;
      case 4: state = collectFurnace(state, '0,0,0'); break;
    }
    assert.deepEqual(tally(state), expected, `quantity changed on operation ${i}`);
  }
});
