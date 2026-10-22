import { ITEMS } from './blocks';
import type { InventorySlot } from './types';

function Meter({ value, kind }: { value: number; kind: 'heart' | 'food' | 'air' }) {
  const path = kind === 'heart' ? 'M1 2H4V3H6V2H9V6H8V7H7V8H6V9H4V8H3V7H2V6H1Z'
    : kind === 'food' ? 'M5 1H8V2H9V5H8V6H6V7H5V8H3V9H1V7H2V6H3V5H4V2H5Z'
    : 'M3 1H7V2H8V3H9V7H8V8H7V9H3V8H2V7H1V3H2V2H3Z';
  return <span className={`pixel-meter ${kind}`} aria-hidden="true">
    <svg viewBox="0 0 10 10"><path d={path} fill="#272727" stroke="#111" strokeWidth="1" /></svg>
    <svg viewBox="0 0 10 10" style={{ clipPath: `inset(0 ${100 - Math.min(1, Math.max(0, value / 2)) * 100}% 0 0)` }}>
      <path d={path} fill={kind === 'heart' ? '#e23a38' : kind === 'food' ? '#b7783e' : '#6ac6ff'} stroke="#171717" strokeWidth="0.7" />
      <path d="M3 3H4V4H3Z" fill="#fff" opacity="0.65" />
    </svg>
  </span>;
}

export function SurvivalHud(p: { inventory: InventorySlot[]; activeSlot: number; health: number; hunger: number; oxygen: number;
  underwater: boolean; creative: boolean; textures: Record<string, string>; onSelect: (index: number) => void; playing: boolean; mining: boolean }) {
  const selected = p.inventory[p.activeSlot], item = selected?.itemId ? ITEMS[selected.itemId] : null;
  return <>
    {p.playing && <div aria-hidden="true" className={`held-item ${p.mining ? 'swinging' : ''}`}>
      {item && p.textures[item.textureId] ? <img src={p.textures[item.textureId]} alt="" className={item.isBlock ? 'held-block' : ''} /> : <div className="held-hand" />}
    </div>}
    <div className="survival-hud">
      {p.playing && <div key={`${p.activeSlot}:${selected?.itemId}`} className="selected-item-name">{item?.name ?? '素手'}</div>}
      {!p.creative && <div className="vitals" aria-label={`体力 ${Math.ceil(p.health)} / 20、満腹度 ${Math.ceil(p.hunger)} / 20`}>
        <div className="flex">{Array.from({ length: 10 }, (_, i) => <Meter key={i} kind="heart" value={Math.ceil(p.health) - i * 2} />)}</div>
        <div className="flex">{Array.from({ length: 10 }, (_, i) => <Meter key={i} kind="food" value={Math.ceil(p.hunger) - i * 2} />)}</div>
      </div>}
      {(p.underwater || p.oxygen < 10) && <div className="oxygen-meter" aria-label={`酸素 ${Math.ceil(p.oxygen)} / 10`}>
        {Array.from({ length: 10 }, (_, i) => <Meter key={i} kind="air" value={(p.oxygen - i) * 2} />)}
      </div>}
      <nav aria-label="ホットバー" className="pixel-hotbar">
        {p.inventory.slice(0, 9).map((slot, index) => {
          const def = slot.itemId ? ITEMS[slot.itemId] : null;
          return <button key={index} aria-label={`装備${index + 1} ${def?.name ?? '空'}${slot.count ? ` ×${slot.count}` : ''}`}
            aria-pressed={index === p.activeSlot} title={def?.name} onClick={() => p.onSelect(index)} className="pixel-slot">
            <span className="slot-number">{index + 1}</span>
            {def && p.textures[def.textureId] && <img src={p.textures[def.textureId]} alt="" draggable={false} />}
            {slot.count > 1 && <span className="slot-count">{slot.count}</span>}
            {def?.durability && <span className="tool-wear"><span style={{ width: `${100 * (slot.durability ?? def.durability) / def.durability}%` }} /></span>}
          </button>;
        })}
      </nav>
    </div>
  </>;
}
