import test from 'node:test';
import assert from 'node:assert/strict';
import { initialItems, ensureChest, clickInventory, clickChest, collectChestSlot, returnCursor, stack } from '../src/items';

test('chests are independent, preserve durability, and full inventory leaves contents/cursor untouched', () => {
  let state = initialItems();
  state.legacyChest = Array.from({ length: 27 }, () => ({ itemId: null, count: 0 }));
  state.legacyChest[0] = stack('wood_pickaxe', 1, 2);
  state = ensureChest(ensureChest(state, '-1,2,3'), '0,2,3');
  assert.equal(state.legacyChest, null); assert.equal(state.chests['-1,2,3'][0].durability, 2); assert.equal(state.chests['0,2,3'][0].itemId, null);
  state = clickChest(state, '-1,2,3', 0); state = clickChest(state, '0,2,3', 0);
  assert.equal(state.chests['0,2,3'][0].durability, 2); assert.equal(state.cursorItem, null);
  state.inventory = Array.from({ length: 36 }, () => stack('stone', 64));
  assert.equal(collectChestSlot(state, '0,2,3', 0), state);
  state = clickChest(state, '0,2,3', 0); const full = state;
  state = returnCursor(state); assert.equal(state, full); assert.equal(state.cursorItem!.durability, 2);
  state = clickChest(state, '-1,2,3', 26); assert.equal(state.chests['-1,2,3'][26].durability, 2);
});
test('partial chest collection and repeated inventory/chest moves conserve counts', () => {
  let state = ensureChest(initialItems(), '0,0,0');
  state.inventory = Array.from({ length: 36 }, () => stack('wood', 64)); state.inventory[0] = stack('wood', 63);
  state.chests['0,0,0'][0] = stack('wood', 5);
  state = collectChestSlot(state, '0,0,0', 0);
  assert.equal(state.inventory[0].count, 64); assert.equal(state.chests['0,0,0'][0].count, 4);
  const total = () => [...state.inventory, ...state.chests['0,0,0'], ...(state.cursorItem ? [state.cursorItem] : [])].reduce((n, s) => n + s.count, 0);
  const before = total();
  for (let i = 0; i < 500; i++) { state = clickInventory(state, i % 36); state = clickChest(state, '0,0,0', i % 27); state = returnCursor(state); assert.equal(total(), before); }
});
