// Run automatically in a real browser. Test data uses unique databases; production saves are untouched.
import { createRoot, type Root } from 'react-dom/client';
import App from '../src/App';
import { loadGame, saveGame, type GameStorage } from '../src/storage';
import { initialItems, stack } from '../src/items';
import { SAVE_VERSION, type GameSave } from '../src/save';
import { BLOCKS } from '../src/blocks';
import { findSafeSpawn } from '../src/simulation';
import { world } from './world-fixture';
import '../src/index.css';

const runId = `ninecrafts-test-${Date.now()}-${crypto.randomUUID()}`;
const dbName = `${runId}-app`;
const storage: GameStorage = { load: () => loadGame(dbName), save: (data, expected) => saveGame(data, expected, dbName) };
const results: string[] = [];
const status = document.createElement('pre');
status.id = 'test-results'; status.setAttribute('role', 'status');
Object.assign(status.style, { position: 'fixed', top: '4px', left: '4px', zIndex: '1000', maxWidth: '90vw', maxHeight: '30vh', overflow: 'auto', padding: '8px', background: '#111e', color: '#fff', fontSize: '11px', pointerEvents: 'none', whiteSpace: 'pre-wrap' });
document.body.append(status);
const update = () => { status.textContent = results.join('\n'); };
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
async function until<T>(find: () => T, message = '待機条件を満たしませんでした'): Promise<NonNullable<T>> {
  for (let i = 0; i < 150; i++) { const result = find(); if (result) return result as NonNullable<T>; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error(message);
}
const button = (name: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(el => (el.getAttribute('aria-label') ?? el.textContent ?? '') === name);
const named = (prefix: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(el => el.getAttribute('aria-label')?.startsWith(prefix));
const click = async (name: string) => { const target = await until(() => button(name), `ボタンがありません: ${name}`); target.click(); await new Promise(resolve => setTimeout(resolve, 50)); };
async function check(name: string, action: () => Promise<void>) { await action(); results.push(`PASS ${name}`); update(); }
function fixture(): GameSave {
  const items = initialItems(); items.inventory[5] = stack('wood_pickaxe', 1, 7);
  return { ...items, version: SAVE_VERSION, savedAt: Date.now(), world: { seed: 9, edits: [{ x: -1, y: 40, z: 0, type: BLOCKS.AIR }] },
    player: { position: findSafeSpawn(world(9)).toArray() as [number, number, number], rotation: [0, 0, 0], health: 20, hunger: 20, oxygen: 10, flying: false }, timeOfDay: Math.PI / 2,
    activeSlot: 0, primedTnt: [], achievements: [], drops: [], settings: { gameMode: 'survival', soundEnabled: false, musicEnabled: false, fov: 75, renderDist: 1, peaceful: true } };
}
async function rawWrite(name: string, value: unknown) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open(name, 1); req.onupgradeneeded = () => req.result.createObjectStore('worlds'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('worlds', 'readwrite'); tx.objectStore('worlds').put(value, 'active'); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); }
  finally { db.close(); }
}
let root: Root | undefined;
async function main() {
  results.push('実ブラウザで検証中（通常のセーブには触れません）'); update();
  await check('IndexedDB保存→再読込（掘削差分・耐久・所持品）', async () => {
    assert(await storage.load() === null, '新規DBが空ではありません');
    const data = fixture(); await storage.save(data, null); const read = await storage.load();
    assert(JSON.stringify(read) === JSON.stringify(data), '保存の往復でデータが変化しました');
  });
  await check('別タブ相当の競合保存を拒否して既存データを保持', async () => {
    const first = (await storage.load())!, second = structuredClone(first); second.savedAt += 1; second.inventory[0].count = 12;
    await storage.save(second, first.savedAt);
    let rejected = false; try { await storage.save(first, first.savedAt); } catch { rejected = true; }
    assert(rejected && (await storage.load())!.inventory[0].count === 12, '競合データが上書きされました');
    // Prepare the App's initial world through the same validated storage path.
    const next = fixture(); next.savedAt = second.savedAt + 1; await storage.save(next, second.savedAt);
  });
  await check('容量不足のトランザクション中断でも前回保存を保持', async () => {
    const current = (await storage.load())!, next = structuredClone(current); next.savedAt += 1;
    const original = IDBObjectStore.prototype.put;
    let rejected = false;
    try {
      IDBObjectStore.prototype.put = function () { throw new DOMException('Test quota', 'QuotaExceededError'); };
      try { await storage.save(next, current.savedAt); } catch { rejected = true; }
    } finally { IDBObjectStore.prototype.put = original; }
    assert(rejected && (await storage.load())!.savedAt === current.savedAt, '中断された保存が既存データを変更しました');
  });
  await check('未知の保存バージョンを読み込まず、上書きもしない', async () => {
    const name = `${runId}-future`, data = { ...fixture(), version: 999 };
    await rawWrite(name, { current: data, previous: null });
    let loadRejected = false, saveRejected = false;
    try { await loadGame(name); } catch { loadRejected = true; }
    try { await saveGame(fixture(), null, name); } catch { saveRejected = true; }
    assert(loadRejected && saveRejected, '未知バージョンが受け入れられました');
  });
  await check('ワールド初期化失敗を表示し、再試行で正常起動', async () => {
    let failOnce = true;
    const recoverableStorage: GameStorage = { save: storage.save, load: async () => {
      if (failOnce) { failOnce = false; return { ...fixture(), world: { seed: 9, edits: null } } as unknown as GameSave; }
      return storage.load();
    } };
    root = createRoot(document.getElementById('root')!); root.render(<App storage={recoverableStorage} />);
    await until(() => document.querySelector('[role="alertdialog"]'), '初期化失敗の画面がありません');
    await click('再試行');
    await until(() => { const start = button('ゲームを開始 / 再開'); return start && !start.disabled; });
  });
  await check('実際のゲーム起動・タッチ開始・右クリックとShift移動', async () => {
    await until(() => { const start = button('ゲームを開始 / 再開'); return start && !start.disabled; }, 'ゲーム初期化が完了しません');
    if (button('タッチ操作: OFF')) await click('タッチ操作: OFF');
    await click('ゲームを開始 / 再開'); await click('持ち物');
    named('所持品1 ')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await until(() => document.body.textContent?.includes('持ち運び中: 原木 ×8'));
    named('所持品7 ')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await until(() => named('所持品7 原木 ×1'));
    named('所持品1 ')!.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    await until(() => named('所持品10 原木 ×8'));
  });
  await check('描画中断→再試行で未保存のカーソルと所持品を復元', async () => {
    const oldCanvas = document.querySelector('canvas')!;
    oldCanvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    await until(() => document.querySelector('[role="alertdialog"]'));
    await click('再試行');
    await until(() => { const start = button('ゲームを開始 / 再開'); return start && !start.disabled; });
    assert(document.querySelector('canvas') !== oldCanvas, 'Canvasが再生成されていません');
    await click('ゲームを開始 / 再開'); await click('持ち物');
    assert(document.body.textContent?.includes('持ち運び中: 原木 ×7'), '未保存のカーソルを失いました');
    assert(named('所持品7 原木 ×1') && named('所持品10 原木 ×8'), '未保存の所持品を失いました');
    await click('閉じてゲームへ戻る');
  });
  await check('設定のフォーカス循環・Escape終了・手動保存', async () => {
    await click('一時停止'); const dialog = document.querySelector('[role="dialog"]')!;
    const buttons = dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    buttons[0].focus(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    assert(document.activeElement === buttons[buttons.length - 1], 'Shift+Tabでフォーカスが背景へ抜けました');
    await until(() => { const save = button('今すぐ保存'); return save && !save.disabled; });
    await click('今すぐ保存'); await until(() => document.body.textContent?.includes('保存しました'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    await until(() => !document.querySelector('[role="dialog"]'));
  });
  await check('再マウントでも耐久値と移動後のアイテム総数を保持', async () => {
    const read = (await storage.load())!;
    assert(read.inventory[5].durability === 7, '耐久値が失われました');
    assert(read.inventory.reduce((n, s) => n + (s.itemId === 'wood' ? s.count : 0), 0) === 16, '原木の総数が変わりました');
    root!.unmount(); root = createRoot(document.getElementById('root')!); root.render(<App storage={storage} />);
    await until(() => { const start = button('ゲームを開始 / 再開'); return start && !start.disabled; });
  });
  results.push('完了: 9 / 9 PASS'); document.documentElement.dataset.testStatus = 'passed'; update();
}
void main().catch(error => { results.push(`FAIL ${error instanceof Error ? error.message : String(error)}`); document.documentElement.dataset.testStatus = 'failed'; update(); console.error(error); });
