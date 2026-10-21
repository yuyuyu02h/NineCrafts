// Development-only fixture. No IndexedDB writes and no production-game mutations.
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { useItems } from '../src/useItems';
import { ItemMenu } from '../src/ItemMenu';
import { stack, ensureFurnace, clickInventory, clickFurnaceSlot, collectFurnace, returnCursor } from '../src/items';
import { emptySlot, stepFurnace } from '../src/furnace';
import { buildGameTextures } from '../src/textures';
import '../src/index.css';

const atlas = buildGameTextures();
function Fixture() {
  const { items, updateItems } = useItems();
  const [message, setMessage] = useState('検証専用です。本体のセーブには触れません。');
  const [shown, setShown] = useState(true);
  useEffect(() => {
    updateItems(state => {
      const inventory = Array.from({ length: 36 }, emptySlot);
      inventory[0] = stack('iron_ore', 3); inventory[1] = stack('coal', 1);
      return ensureFurnace({ ...state, inventory }, '0,0,0');
    });
    const tick = window.setInterval(() => updateItems(state => ({ ...state, furnaces: { ...state.furnaces, '0,0,0': stepFurnace(state.furnaces['0,0,0'], 0.1) } })), 100);
    return () => window.clearInterval(tick);
  }, []);
  return <div className="relative w-full h-[100dvh] text-white">
    <nav className="absolute top-0 left-0 z-[60] flex gap-2 bg-neutral-800 p-1 text-xs">
      <button className="min-h-11 px-2 border" onClick={() => updateItems(state => ({ ...state, inventory: Array.from({ length: 36 }, () => stack('stone', 64)) }))}>検証: 所持品を満杯に</button>
      <button className="min-h-11 px-2 border" onClick={() => updateItems(state => { const inventory = state.inventory.slice(); inventory[0] = emptySlot(); return { ...state, inventory }; })}>検証: 1枠空ける</button>
      {!shown && <button onClick={() => setShown(true)}>再表示</button>}
    </nav>
    {shown && <ItemMenu mode="furnace" items={items} activeSlot={0} creative={false} furnaceKey="0,0,0" textures={atlas.dataUrls} message={message}
      onClose={() => setShown(false)} onInventory={index => updateItems(state => clickInventory(state, index))}
      onCell={() => {}} onCraft={() => {}} onQuick={() => {}}
      onFurnace={kind => {
        updateItems(state => kind === 'output' ? collectFurnace(state, '0,0,0') : clickFurnaceSlot(state, '0,0,0', kind));
        setMessage('移動後の数量を確認してください。');
      }} onReturnCursor={() => updateItems(returnCursor)} />}
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
