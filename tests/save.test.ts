import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSave, type GameSave } from '../src/save';
import { BLOCKS } from '../src/blocks';
import { loadGame, saveGame } from '../src/storage';

function fixture(): GameSave {
  const empty = () => ({ itemId: null, count: 0 });
  return {
    version: 3, savedAt: 1_000, world: { seed: 123, edits: [{ x: -1, y: 2, z: 16, type: 0 }] },
    player: { position: [-1, 4.62, 16], rotation: [0, 1, 0], health: 17, hunger: 12.3, oxygen: 9.5, flying: false },
    timeOfDay: 3, inventory: Array.from({ length: 36 }, empty), activeSlot: 4,
    cursorItem: { itemId: 'wood', count: 3 },
    craft2x2: [['wood', null], [null, null]], craft3x3: Array.from({ length: 3 }, () => [null, null, null]),
    furnaces: { '-1,2,16': { input: { itemId: 'iron_ore', count: 2 }, fuel: empty(), output: { itemId: 'iron_ingot', count: 1 }, progress: 1.5, fuelTime: 0 } }, legacyFurnace: null,
    chests: {}, legacyChest: Array.from({ length: 27 }, empty), primedTnt: [], achievements: ['wood'],
    drops: [{ itemId: 'stick', count: 2, position: [-1, 5, 16], velocity: [1, -2, 1], life: 120 }],
    settings: { gameMode: 'survival', soundEnabled: false, musicEnabled: false, fov: 90, renderDist: 2, peaceful: false },
  };
}

test('a complete save round-trips without losing cursor, crafting, equipment or drops', () => {
  const input = fixture();
  input.inventory[0] = { itemId: 'wood_pickaxe', count: 1, durability: 27 };
  input.legacyChest![26] = { itemId: 'diamond', count: 12 };
  const result = parseSave(JSON.parse(JSON.stringify(input)));
  assert.deepEqual(result, input);
  result.inventory[0].count = 0;
  assert.equal(input.inventory[0].count, 1, 'validated data must not alias live state');
});

test('optional graphics settings preserve old v3 saves and validate new preferences', () => {
  const old = fixture(); assert.deepEqual(parseSave(old), old);
  const data = fixture();
  Object.assign(data.settings, { graphicsQuality: 'low', shadowsEnabled: false, cameraShake: false });
  assert.deepEqual(parseSave(JSON.parse(JSON.stringify(data))), data);
  for (const settings of [{ graphicsQuality: 'ultra' }, { shadowsEnabled: 0 }, { cameraShake: 'false' }]) {
    assert.throws(() => parseSave({ ...old, settings: { ...old.settings, ...settings } }));
  }
});

test('unknown versions and malformed documents are rejected, not reset', () => {
  for (const value of [null, [], {}, { ...fixture(), version: 99 }, { ...fixture(), version: '1' }]) {
    assert.throws(() => parseSave(value));
  }
});

test('unknown items, impossible stack sizes and invalid durability cannot enter live state', () => {
  for (const item of [
    { itemId: '__proto__', count: 1 }, { itemId: 'diamond', count: 65 },
    { itemId: 'wood', count: -1 }, { itemId: 'wood', count: 1.5 },
    { itemId: null, count: 3 }, { itemId: 'wood_pickaxe', count: 1, durability: 61 },
  ]) {
    const data = fixture(); data.inventory[0] = item;
    assert.throws(() => parseSave(data));
  }
});

test('nonfinite/out-of-range coordinates, duplicate edits and invalid blocks are rejected', () => {
  for (const edit of [
    { x: NaN, y: 0, z: 0, type: 1 }, { x: Infinity, y: 0, z: 0, type: 1 },
    { x: 0.5, y: 0, z: 0, type: 1 }, { x: 0, y: 0, z: 0, type: 999 },
  ]) {
    const data = fixture();
    assert.throws(() => parseSave({ ...data, world: { ...data.world, edits: [edit] } }));
  }
  const duplicate = fixture(); duplicate.world.edits.push({ ...duplicate.world.edits[0] });
  assert.throws(() => parseSave(duplicate));
});

test('container dimensions and state limits are validated', () => {
  const badInventory = fixture(); badInventory.inventory.pop();
  const badGrid = fixture(); badGrid.craft3x3[0] = [null];
  const badPlayer = fixture(); badPlayer.player.health = 21;
  const badSettings = fixture(); badSettings.settings.renderDist = 99;
  const badDrops = fixture(); badDrops.drops[0].life = Infinity;
  for (const data of [badInventory, badGrid, badPlayer, badSettings, badDrops]) assert.throws(() => parseSave(data));
  assert.throws(() => parseSave({ ...fixture(), settings: { ...fixture().settings, gameMode: new String('survival') } }));
});

test('storage-unavailable failures are explicit and do not pretend to save', async () => {
  assert.equal(typeof indexedDB, 'undefined');
  await assert.rejects(loadGame(), /保存機能を利用できません/);
  await assert.rejects(saveGame(fixture(), null), /保存機能を利用できません/);
});

test('v1 saves migrate furnace contents and cooking progress without throwing away items', () => {
  const { furnaces, legacyFurnace, ...base } = fixture();
  const legacy = { ...base, chestSlots: base.legacyChest, version: 1, furnace: { ...furnaces['-1,2,16'], progress: 45 } };
  const migrated = parseSave(legacy);
  assert.equal(migrated.version, 3);
  assert.deepEqual(migrated.furnaces, {});
  assert.equal(migrated.legacyFurnace?.input.count, 2);
  assert.equal(migrated.legacyFurnace?.output.count, 1);
  assert.ok(Math.abs(migrated.legacyFurnace!.progress - 1.575) < 1e-9);
  assert.deepEqual(migrated.inventory, legacy.inventory);
});

test('current saves validate independent furnace coordinates and tool-drop durability', () => {
  const valid = fixture();
  valid.drops = [{ itemId: 'wood_pickaxe', count: 1, durability: 2, position: [0, 2, 0], velocity: [0, 0, 0], life: 180 }];
  assert.equal(parseSave(valid).drops[0].durability, 2);
  assert.throws(() => parseSave({ ...valid, furnaces: { invalid: valid.furnaces['-1,2,16'] } }));
  valid.drops[0].durability = 500;
  assert.throws(() => parseSave(valid));
});

test('v2 chest data migrates once and v3 persists independent chests, wear, water and TNT', () => {
  const current = fixture();
  const old = { ...current, version: 2, chestSlots: current.legacyChest };
  old.chestSlots![0] = { itemId: 'wood', count: 9 };
  const migrated = parseSave(old);
  assert.equal(migrated.version, 3); assert.equal(migrated.legacyChest![0].count, 9);
  assert.deepEqual(migrated.chests, {}); assert.deepEqual(migrated.primedTnt, []);
  const v3 = fixture();
  v3.chests = { '-1,2,16': Array.from({ length: 27 }, () => ({ itemId: null, count: 0 })) };
  v3.chests['-1,2,16'][0] = { itemId: 'wood_pickaxe', count: 1, durability: 2 };
  v3.primedTnt = [{ x: 1, y: 2, z: 3, remaining: 0.7 }];
  v3.world.edits.push({ x: 1, y: 2, z: 3, type: BLOCKS.WATER });
  v3.world.waterLevels = [{ x: 1, y: 2, z: 3, spread: 2 }];
  assert.deepEqual(parseSave(v3), v3);
  assert.throws(() => parseSave({ ...v3, chests: JSON.parse('{"__proto__": []}') }));
  assert.throws(() => parseSave({ ...v3, chests: { invalid: v3.chests['-1,2,16'] } }));
  assert.throws(() => parseSave({ ...v3, primedTnt: [{ ...v3.primedTnt[0], remaining: -1 }] }));
  assert.throws(() => parseSave({ ...v3, world: { ...v3.world, waterLevels: [{ ...v3.world.waterLevels![0], spread: 4 }] } }));
});
