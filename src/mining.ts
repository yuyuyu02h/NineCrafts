import { BLOCKS, BLOCK_DEFS, ITEMS, type BlockId } from './blocks';
import type { InventorySlot } from './types';

export function miningRule(block: BlockId, slot: InventorySlot, creative = false) {
  const def = BLOCK_DEFS[block];
  if (!def || block === BLOCKS.BEDROCK || block === BLOCKS.WATER) return { allowed: false, seconds: Infinity, reason: 'このブロックは採掘できません' };
  if (creative) return { allowed: true, seconds: 0.1, reason: '' };
  const tool = slot.itemId ? ITEMS[slot.itemId] : null;
  const tier = tool?.toolTier ?? 0;
  const suited = !!def.preferredTool && tool?.toolType === def.preferredTool;
  if (def.minTier && (!suited || tier < def.minTier)) {
    const material = ['', '木', '石', '鉄', 'ダイヤ'][def.minTier];
    const name = def.preferredTool === 'axe' ? '斧' : def.preferredTool === 'shovel' ? 'シャベル' : 'ツルハシ';
    return { allowed: false, seconds: Infinity, reason: `${material}の${name}以上が必要です` };
  }
  const speed = suited ? [1, 2, 4, 6, 8][tier] ?? 1 : 1;
  return { allowed: true, seconds: Math.max(0.08, def.hardness / speed), reason: '' };
}

export function toolSignature(index: number, slot: InventorySlot): string {
  return `${index}:${slot.itemId ?? ''}:${slot.durability ?? ''}`;
}
