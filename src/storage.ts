import { parseSave, type GameSave } from './save';

const DB_NAME = 'ninecrafts';
const STORE = 'worlds';
const SAVE_KEY = 'active';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('このブラウザでは保存機能を利用できません。')); return; }
    const request = indexedDB.open(DB_NAME, 1);
    let blocked = false;
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
    request.onerror = () => reject(new Error('保存領域を開けません。ブラウザの設定や空き容量を確認してください。'));
    request.onblocked = () => { blocked = true; reject(new Error('ほかのタブを閉じて再読み込みしてください。')); };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

function readRecord(db: IDBDatabase): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get(SAVE_KEY);
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(new Error('保存データを読み込めませんでした。'));
    transaction.onerror = () => reject(new Error('保存データを読み込めませんでした。'));
  });
}

export async function loadGame(): Promise<GameSave | null> {
  const db = await openDatabase();
  try {
    const record = await readRecord(db);
    if (record === undefined) return null;
    // Do not silently load an older backup or overwrite a future-version/current corrupt save.
    if (!record || typeof record !== 'object' || !('current' in record)) throw new Error('保存データが壊れています。上書きを停止しました。');
    return parseSave(record.current);
  } finally { db.close(); }
}

export async function saveGame(save: GameSave, expectedSavedAt: number | null): Promise<void> {
  const validated = parseSave(save);
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      const read = store.get(SAVE_KEY);
      let abortMessage = '保存できませんでした。既存の保存は保持しています。空き容量・保存データを確認してください。';
      read.onsuccess = () => {
        const old = read.result;
        // A different tab may have replaced the record since this tab was opened.
        try {
          if (old !== undefined) {
            if (!old || typeof old !== 'object' || !('current' in old)) throw new Error();
            const current = parseSave(old.current);
            if (current.savedAt !== expectedSavedAt) {
              abortMessage = '別のタブで保存が更新されています。この画面からは上書きせず、再読み込みして確認してください。';
              throw new Error();
            }
          } else if (expectedSavedAt !== null) {
            abortMessage = '保存データが変更されています。再読み込みして確認してください。';
            throw new Error();
          }
          store.put({ current: validated, previous: old?.current ?? null }, SAVE_KEY);
        } catch { transaction.abort(); }
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(new Error(abortMessage));
      transaction.onerror = () => reject(new Error('保存できませんでした。既存の保存は保持しています。'));
    });
  } finally { db.close(); }
}
