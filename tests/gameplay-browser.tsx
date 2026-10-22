// Development-only entry. Refuses to overwrite any existing world on this origin.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { initialItems } from '../src/items';
import { loadGame, saveGame } from '../src/storage';
import { SAVE_VERSION, type GameSave } from '../src/save';
import { BLOCKS } from '../src/blocks';
function Fixture() {
  const [status, setStatus] = useState('検証用の空のオリジンだけで実行してください。既存セーブがあれば上書きせず停止します。');
  return <main style={{ fontFamily: 'sans-serif', padding: 24 }}>
    <h1>死亡・復活のローカル検証</h1><p>{status}</p>
    <button style={{ minHeight: 48 }} onClick={async () => {
      try {
        if (await loadGame()) { setStatus('既存セーブがあるため停止しました。別の未使用ローカルオリジンを使用してください。'); return; }
        const edits: GameSave['world']['edits'] = [];
        for (let x = 6; x <= 10; x++) for (let z = 6; z <= 10; z++) {
          edits.push({ x, y: 40, z, type: BLOCKS.STONE });
          for (let y = 41; y <= 44; y++) edits.push({ x, y, z, type: BLOCKS.WATER });
        }
        const data: GameSave = { ...initialItems(), version: SAVE_VERSION, savedAt: Date.now(), world: { seed: 5678, edits },
          player: { position: [8.5, 42.63, 8.5], rotation: [0, 0, 0.35], health: 2, hunger: 20, oxygen: 0, flying: false },
          timeOfDay: Math.PI / 2, activeSlot: 0, primedTnt: [], achievements: [], drops: [],
          settings: { gameMode: 'survival', soundEnabled: false, musicEnabled: false, fov: 75, renderDist: 1, peaceful: true } };
        await saveGame(data, null); location.assign('/');
      } catch (error) { setStatus(String(error)); }
    }}>水中から開始（HP2・酸素0・旧視界の傾きあり）</button>
    <p>開始画面でタッチ操作ON→開始。死亡画面→安全な場所にリスポーン→水平な乾いた視界・HP20・酸素回復を確認。</p>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
