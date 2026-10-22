// Isolated visual fixture: all writes stay in memory, never in the user's IndexedDB.
import { createRoot } from 'react-dom/client';
import App from '../src/App';
import { BLOCKS } from '../src/blocks';
import { initialItems, stack } from '../src/items';
import { findSafeSpawn } from '../src/simulation';
import { world } from './world-fixture';
import { parseSave, SAVE_VERSION, type GameSave } from '../src/save';
import '../src/index.css';
const query = new URLSearchParams(location.search);
const items = initialItems(); items.inventory[5] = stack('wood_pickaxe', 1, 42);
let current: GameSave = { ...items, version: SAVE_VERSION, savedAt: 1, world: { seed: 9, edits: [] },
  player: { position: findSafeSpawn(world(9)).toArray() as [number, number, number], rotation: [0, -1.2, 0], health: 20, hunger: 18, oxygen: 10, flying: false },
  timeOfDay: Math.PI / 2, activeSlot: 5, primedTnt: [], achievements: [], drops: [], settings: { gameMode: 'survival', soundEnabled: false, musicEnabled: false, fov: 75, renderDist: 2, peaceful: true } };
if (query.get('screen') === 'placement') {
  current.settings.renderDist = 1;
  current.activeSlot = 0;
  current.player.position = [8.5, 42.62, 8.5];
  current.player.rotation = [-0.45, 0, 0];
  for (let x = 4; x <= 12; x++) for (let z = 1; z <= 12; z++) current.world.edits.push({ x, y: 40, z, type: BLOCKS.STONE });
}
createRoot(document.getElementById('root')!).render(<App storage={{ load: async () => structuredClone(current), save: async data => { current = parseSave(data); } }} />);
if (query.get('screen')) {
  const timer = setInterval(() => {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
    const start = buttons.find(el => el.textContent === 'ゲームを開始 / 再開' && !el.disabled);
    if (!start) return;
    clearInterval(timer);
    buttons.find(el => el.textContent === 'タッチ操作: OFF')?.click();
    setTimeout(() => {
      start.click();
      setTimeout(() => {
        const target = query.get('screen') === 'inventory' ? '持ち物' : query.get('screen') === 'settings' ? '一時停止' : query.get('screen') === 'help' ? 'Help & Controls' : '';
        const menu = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(el => el.textContent === target || el.title === target);
        menu?.click();
      }, 80);
    }, 80);
  }, 50);
}
