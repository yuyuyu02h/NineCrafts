import { useEffect, useRef } from 'react';
import { ITEMS } from './blocks';
import { CRAFTING_RECIPES, matchRecipe } from './recipes';
import { emptyFurnace, smeltingRecipe, type FurnaceState } from './furnace';
import { quickCraft, recipeMaterials, type ItemState } from './items';
import type { InventorySlot } from './types';

interface Props {
  mode: 'inventory' | 'workbench' | 'furnace';
  items: ItemState;
  activeSlot: number;
  creative: boolean;
  furnaceKey: string | null;
  textures: Record<string, string>;
  message: string;
  onClose: () => void;
  onInventory: (index: number) => void;
  onCell: (row: number, col: number, size: 2 | 3) => void;
  onCraft: (size: 2 | 3) => void;
  onQuick: (id: string) => void;
  onFurnace: (kind: 'input' | 'fuel' | 'output') => void;
  onReturnCursor: () => void;
}
function ItemIcon({ slot, textures }: { slot: InventorySlot; textures: Record<string, string> }) {
  const def = slot.itemId ? ITEMS[slot.itemId] : null;
  return <>
    {def && textures[def.textureId] && <img draggable={false} src={textures[def.textureId]} alt="" className="w-7 h-7 object-contain pointer-events-none [image-rendering:pixelated]" />}
    {slot.count > 1 && <span className="absolute bottom-0 right-1 text-xs font-bold">{slot.count}</span>}
    {def?.durability && <span className="absolute bottom-1 left-1 right-1 h-1 bg-neutral-700"><span className="block h-full bg-emerald-400" style={{ width: `${100 * (slot.durability ?? def.durability) / def.durability}%` }} /></span>}
  </>;
}
const slotClass = 'relative min-w-11 min-h-11 aspect-square rounded-lg border border-white/20 bg-neutral-950 flex items-center justify-center hover:border-amber-400 focus-visible:outline-2 focus-visible:outline-amber-300';

export function ItemMenu(p: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, [p.mode]);
  const size = p.mode === 'workbench' ? 3 : 2;
  const grid = size === 2 ? p.items.craft2x2 : p.items.craft3x3;
  const result = matchRecipe(grid, size)?.result;
  const furnace = (p.furnaceKey && p.items.furnaces[p.furnaceKey]) || emptyFurnace();
  const recipe = smeltingRecipe(furnace.input.itemId);
  const percent = recipe ? Math.min(100, Math.floor(furnace.progress / recipe.cookTime * 100)) : 0;
  const cursor = p.items.cursorItem;
  return <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4">
    <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="item-menu-title"
      onKeyDown={e => {
        if (e.key !== 'Tab') return;
        const controls = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
        if (e.shiftKey && document.activeElement === controls[0]) { e.preventDefault(); controls.at(-1)?.focus(); }
        else if (!e.shiftKey && document.activeElement === controls.at(-1)) { e.preventDefault(); controls[0]?.focus(); }
      }}
      className="bg-neutral-900 border border-white/20 p-3 sm:p-5 rounded-2xl shadow-2xl max-w-xl w-full space-y-4 max-h-[calc(100dvh-1rem)] overflow-y-auto overscroll-contain">
      <header className="flex items-center justify-between gap-2 border-b border-white/10 pb-2">
        <h2 id="item-menu-title" className="font-bold">{p.mode === 'furnace' ? '🔥 かまど' : p.mode === 'workbench' ? '🛠️ 作業台' : '🎒 インベントリ'}</h2>
        <button ref={closeRef} aria-label="閉じてゲームへ戻る" onClick={p.onClose} className="min-w-11 min-h-11 rounded-lg hover:bg-white/10 text-xl">×</button>
      </header>
      <p role="status" className="text-xs text-amber-200 min-h-4">{p.message || '所持品をタップで持ち、別の枠をタップで移動します。'}</p>
      <div className="flex items-center justify-between gap-2 rounded-lg bg-neutral-950 p-2 text-xs">
        <span>{cursor?.itemId ? `持ち運び中: ${ITEMS[cursor.itemId].name} ×${cursor.count}` : '持ち運び中のアイテムなし'}</span>
        <button disabled={!cursor?.itemId} onClick={p.onReturnCursor} className="min-h-11 shrink-0 px-2 rounded-lg bg-neutral-800 disabled:opacity-40">所持品へ戻す</button>
      </div>
      {p.mode === 'furnace' ? <>
        <p className="text-xs text-neutral-400">所持品を持って材料・燃料枠へ。枠をタップすると取り出せます。完成品は所持品の空き分だけ回収します。</p>
        <div className="flex items-center justify-around gap-3 p-3 bg-neutral-950 rounded-xl">
          <div className="space-y-2">
            {(['input', 'fuel'] as const).map(kind => <div key={kind} className="text-center">
              <span className="text-xs text-neutral-400">{kind === 'input' ? '材料' : '燃料'}</span>
              <button aria-label={`${kind === 'input' ? '精錬材料を移す' : '燃料を移す'} ${furnace[kind].itemId ? `${ITEMS[furnace[kind].itemId!].name} ×${furnace[kind].count}` : '空'}`} onClick={() => p.onFurnace(kind)} className={`${slotClass} w-14`}><ItemIcon slot={furnace[kind]} textures={p.textures} /></button>
            </div>)}
          </div>
          <div className="text-center space-y-2 text-xs">
            <div>{percent}% →</div>
            <progress aria-label="精錬の進み具合" value={percent} max={100} className="w-16 accent-orange-400" />
            <div className="text-neutral-400">残燃料 {furnace.fuelTime.toFixed(1)}秒</div>
          </div>
          <div className="text-center"><span className="text-xs text-neutral-400">完成品</span><button aria-label={`精錬の完成品を回収 ${furnace.output.itemId ? `${ITEMS[furnace.output.itemId].name} ×${furnace.output.count}` : '空'}`} onClick={() => p.onFurnace('output')} className={`${slotClass} w-16 border-orange-400/50`}><ItemIcon slot={furnace.output} textures={p.textures} /></button></div>
        </div>
        <p className="text-xs text-neutral-400">燃料: 石炭28秒・原木7秒・木材3.5秒・棒1.75秒。{recipe ? `1個の精錬に${recipe.cookTime}秒。` : '鉄・金鉱石、砂、丸石、生肉を精錬できます。'}</p>
      </> : <>
        <p className="text-xs text-neutral-400">材料枠には1個ずつ配置。完成品が入らない場合、材料は消費しません。</p>
        <div className="flex items-center justify-around gap-3 rounded-xl bg-neutral-950 p-3">
          <div className={`grid gap-1.5 ${size === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {grid.map((row, r) => row.map((id, c) => <button key={`${r},${c}`} aria-label={`材料 ${r + 1}行${c + 1}列${id ? ` ${ITEMS[id].name}` : ' 空'}`} onClick={() => p.onCell(r, c, size)} className={`${slotClass} w-11 sm:w-12`}><ItemIcon slot={{ itemId: id, count: id ? 1 : 0 }} textures={p.textures} /></button>))}
          </div>
          <span aria-hidden="true">→</span>
          <button aria-label={`クラフトの完成品を作る ${result ? `${ITEMS[result.itemId].name} ×${result.count}` : '空'}`} disabled={!result} onClick={() => p.onCraft(size)} className={`${slotClass} w-14 border-emerald-400/50 disabled:opacity-40`}><ItemIcon slot={result ? { ...result } : { itemId: null, count: 0 }} textures={p.textures} /></button>
        </div>
        <section aria-label="レシピ一覧">
          <h3 className="text-xs text-neutral-400 mb-2">レシピから制作{p.creative ? '（クリエイティブ: 材料不要）' : '（材料を消費）'}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-44 overflow-y-auto">
            {CRAFTING_RECIPES.filter(r => r.gridSize <= size).map(rec => {
              const reason = quickCraft(p.items.inventory, rec, p.creative).reason;
              return <button key={rec.id} disabled={!!reason} onClick={() => p.onQuick(rec.id)} title={reason || rec.name} className="min-h-16 p-2 text-left text-xs rounded-lg bg-neutral-800 border border-white/10 hover:border-emerald-400 disabled:opacity-50">
                <span className="block font-bold">{rec.name}</span>
                <span className="block text-[11px] text-neutral-300">{Object.entries(recipeMaterials(rec)).map(([id, n]) => `${ITEMS[id].name}×${n}`).join(' / ')}</span>
                {reason && <span className="block text-[11px] text-amber-200">{reason}</span>}
              </button>;
            })}
          </div>
        </section>
      </>}
      <section aria-label="所持品">
        <h3 className="text-xs text-neutral-400 mb-2">所持品（1〜9はゲーム画面のホットバー）</h3>
        <div className="grid grid-cols-6 sm:grid-cols-9 gap-1.5">
          {p.items.inventory.map((slot, index) => {
            const def = slot.itemId ? ITEMS[slot.itemId] : null;
            const label = `所持品${index + 1} ${def ? `${def.name} ×${slot.count}${def.durability ? ` 耐久${slot.durability ?? def.durability}/${def.durability}` : ''}` : '空'}`;
            return <button key={index} aria-label={label} title={label} onClick={() => p.onInventory(index)} className={`${slotClass} ${index === p.activeSlot ? 'border-amber-400 ring-1 ring-amber-400' : ''}`}>
              {index < 9 && <span className="absolute top-0 left-1 text-[9px] text-neutral-400">{index + 1}</span>}
              <ItemIcon slot={slot} textures={p.textures} />
            </button>;
          })}
        </div>
      </section>
    </div>
  </div>;
}
