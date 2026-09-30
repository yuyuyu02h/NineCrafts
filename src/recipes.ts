export interface CraftingRecipe {
  id: string;
  name: string;
  gridSize: 2 | 3;
  pattern: (string | null)[][]; // 2x2 or 3x3
  result: { itemId: string; count: number };
  category: 'tools' | 'combat' | 'blocks' | 'misc';
}

export interface SmeltingRecipe {
  input: string;
  output: string;
  cookTime: number; // in seconds
}

export const CRAFTING_RECIPES: CraftingRecipe[] = [
  // 1. Planks from Wood
  {
    id: 'planks',
    name: '木材 (4個)',
    gridSize: 2,
    pattern: [
      ['wood', null],
      [null, null],
    ],
    result: { itemId: 'planks', count: 4 },
    category: 'blocks',
  },
  // 2. Sticks from Planks
  {
    id: 'stick',
    name: '棒 (4本)',
    gridSize: 2,
    pattern: [
      ['planks', null],
      ['planks', null],
    ],
    result: { itemId: 'stick', count: 4 },
    category: 'misc',
  },
  // 3. Crafting Table
  {
    id: 'crafting_table',
    name: '作業台',
    gridSize: 2,
    pattern: [
      ['planks', 'planks'],
      ['planks', 'planks'],
    ],
    result: { itemId: 'crafting_table', count: 1 },
    category: 'blocks',
  },
  // 4. Torch
  {
    id: 'torch',
    name: '松明 (4本)',
    gridSize: 2,
    pattern: [
      ['coal', null],
      ['stick', null],
    ],
    result: { itemId: 'torch', count: 4 },
    category: 'misc',
  },

  // 3x3 Workbench Recipes
  // Pickaxes
  {
    id: 'wood_pickaxe',
    name: '木のツルハシ',
    gridSize: 3,
    pattern: [
      ['planks', 'planks', 'planks'],
      [null, 'stick', null],
      [null, 'stick', null],
    ],
    result: { itemId: 'wood_pickaxe', count: 1 },
    category: 'tools',
  },
  {
    id: 'stone_pickaxe',
    name: '石のツルハシ',
    gridSize: 3,
    pattern: [
      ['cobblestone', 'cobblestone', 'cobblestone'],
      [null, 'stick', null],
      [null, 'stick', null],
    ],
    result: { itemId: 'stone_pickaxe', count: 1 },
    category: 'tools',
  },
  {
    id: 'iron_pickaxe',
    name: '鉄のツルハシ',
    gridSize: 3,
    pattern: [
      ['iron_ingot', 'iron_ingot', 'iron_ingot'],
      [null, 'stick', null],
      [null, 'stick', null],
    ],
    result: { itemId: 'iron_pickaxe', count: 1 },
    category: 'tools',
  },
  {
    id: 'diamond_pickaxe',
    name: 'ダイヤのツルハシ',
    gridSize: 3,
    pattern: [
      ['diamond', 'diamond', 'diamond'],
      [null, 'stick', null],
      [null, 'stick', null],
    ],
    result: { itemId: 'diamond_pickaxe', count: 1 },
    category: 'tools',
  },

  // Swords
  {
    id: 'wood_sword',
    name: '木の剣',
    gridSize: 3,
    pattern: [
      [null, 'planks', null],
      [null, 'planks', null],
      [null, 'stick', null],
    ],
    result: { itemId: 'wood_sword', count: 1 },
    category: 'combat',
  },
  {
    id: 'stone_sword',
    name: '石の剣',
    gridSize: 3,
    pattern: [
      [null, 'cobblestone', null],
      [null, 'cobblestone', null],
      [null, 'stick', null],
    ],
    result: { itemId: 'stone_sword', count: 1 },
    category: 'combat',
  },
  {
    id: 'iron_sword',
    name: '鉄の剣',
    gridSize: 3,
    pattern: [
      [null, 'iron_ingot', null],
      [null, 'iron_ingot', null],
      [null, 'stick', null],
    ],
    result: { itemId: 'iron_sword', count: 1 },
    category: 'combat',
  },
  {
    id: 'diamond_sword',
    name: 'ダイヤの剣',
    gridSize: 3,
    pattern: [
      [null, 'diamond', null],
      [null, 'diamond', null],
      [null, 'stick', null],
    ],
    result: { itemId: 'diamond_sword', count: 1 },
    category: 'combat',
  },

  // Axes
  {
    id: 'wood_axe',
    name: '木の斧',
    gridSize: 3,
    pattern: [
      ['planks', 'planks', null],
      ['planks', 'stick', null],
      [null, 'stick', null],
    ],
    result: { itemId: 'wood_axe', count: 1 },
    category: 'tools',
  },
  {
    id: 'stone_axe',
    name: '石の斧',
    gridSize: 3,
    pattern: [
      ['cobblestone', 'cobblestone', null],
      ['cobblestone', 'stick', null],
      [null, 'stick', null],
    ],
    result: { itemId: 'stone_axe', count: 1 },
    category: 'tools',
  },
  {
    id: 'iron_axe',
    name: '鉄の斧',
    gridSize: 3,
    pattern: [
      ['iron_ingot', 'iron_ingot', null],
      ['iron_ingot', 'stick', null],
      [null, 'stick', null],
    ],
    result: { itemId: 'iron_axe', count: 1 },
    category: 'tools',
  },

  // Shovel
  {
    id: 'wood_shovel',
    name: '木のシャベル',
    gridSize: 3,
    pattern: [
      [null, 'planks', null],
      [null, 'stick', null],
      [null, 'stick', null],
    ],
    result: { itemId: 'wood_shovel', count: 1 },
    category: 'tools',
  },

  // Bow & Arrow
  {
    id: 'bow',
    name: '弓',
    gridSize: 3,
    pattern: [
      [null, 'stick', 'stick'],
      ['stick', null, 'stick'],
      [null, 'stick', 'stick'],
    ],
    result: { itemId: 'bow', count: 1 },
    category: 'combat',
  },
  {
    id: 'arrow',
    name: '矢 (4本)',
    gridSize: 3,
    pattern: [
      [null, 'cobblestone', null],
      [null, 'stick', null],
      [null, 'leaves', null],
    ],
    result: { itemId: 'arrow', count: 4 },
    category: 'combat',
  },

  // Furnace
  {
    id: 'furnace',
    name: 'かまど',
    gridSize: 3,
    pattern: [
      ['cobblestone', 'cobblestone', 'cobblestone'],
      ['cobblestone', null, 'cobblestone'],
      ['cobblestone', 'cobblestone', 'cobblestone'],
    ],
    result: { itemId: 'furnace', count: 1 },
    category: 'blocks',
  },

  // Chest
  {
    id: 'chest',
    name: 'チェスト',
    gridSize: 3,
    pattern: [
      ['planks', 'planks', 'planks'],
      ['planks', null, 'planks'],
      ['planks', 'planks', 'planks'],
    ],
    result: { itemId: 'chest', count: 1 },
    category: 'blocks',
  },

  // TNT
  {
    id: 'tnt',
    name: 'TNT',
    gridSize: 3,
    pattern: [
      ['sand', 'coal', 'sand'],
      ['coal', 'sand', 'coal'],
      ['sand', 'coal', 'sand'],
    ],
    result: { itemId: 'tnt', count: 1 },
    category: 'blocks',
  },

  // Bed
  {
    id: 'bed',
    name: 'ベッド',
    gridSize: 3,
    pattern: [
      [null, null, null],
      ['planks', 'planks', 'planks'],
      ['wood', 'wood', 'wood'],
    ],
    result: { itemId: 'bed', count: 1 },
    category: 'blocks',
  },

  // Bookshelf
  {
    id: 'bookshelf',
    name: '本棚',
    gridSize: 3,
    pattern: [
      ['planks', 'planks', 'planks'],
      ['stick', 'stick', 'stick'],
      ['planks', 'planks', 'planks'],
    ],
    result: { itemId: 'bookshelf', count: 1 },
    category: 'blocks',
  },
];

export const SMELTING_RECIPES: SmeltingRecipe[] = [
  { input: 'iron_ore', output: 'iron_ingot', cookTime: 3.5 },
  { input: 'gold_ore', output: 'gold_ingot', cookTime: 4.0 },
  { input: 'sand', output: 'glass', cookTime: 2.5 },
  { input: 'cobblestone', output: 'stone', cookTime: 2.5 },
  { input: 'raw_meat', output: 'cooked_steak', cookTime: 3.0 },
];

// Recipe checker function
export function matchRecipe(
  grid: (string | null)[][],
  size: 2 | 3
): { recipe: CraftingRecipe; result: { itemId: string; count: number } } | null {
  for (const r of CRAFTING_RECIPES) {
    if (r.gridSize > size) continue;

    // Check if grid matches recipe pattern (allowing for shifts)
    if (matchesPattern(grid, r.pattern, size, r.gridSize)) {
      return { recipe: r, result: r.result };
    }
  }
  return null;
}

function matchesPattern(
  grid: (string | null)[][],
  pattern: (string | null)[][],
  gridSize: number,
  patternSize: number
): boolean {
  // Find bounding box of non-empty items in grid
  let minRow = gridSize, maxRow = -1, minCol = gridSize, maxCol = -1;
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      if (grid[r][c] !== null) {
        minRow = Math.min(minRow, r);
        maxRow = Math.max(maxRow, r);
        minCol = Math.min(minCol, c);
        maxCol = Math.max(maxCol, c);
      }
    }
  }

  // If grid is empty
  if (maxRow === -1) return false;

  const h = maxRow - minRow + 1;
  const w = maxCol - minCol + 1;

  // Find bounding box of recipe pattern
  let pMinR = patternSize, pMaxR = -1, pMinC = patternSize, pMaxC = -1;
  for (let r = 0; r < patternSize; r++) {
    for (let c = 0; c < patternSize; c++) {
      if (pattern[r][c] !== null) {
        pMinR = Math.min(pMinR, r);
        pMaxR = Math.max(pMaxR, r);
        pMinC = Math.min(pMinC, c);
        pMaxC = Math.max(pMaxC, c);
      }
    }
  }

  const pH = pMaxR - pMinR + 1;
  const pW = pMaxC - pMinC + 1;

  if (h !== pH || w !== pW) return false;

  // Compare contents
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const gItem = grid[minRow + r][minCol + c];
      const pItem = pattern[pMinR + r][pMinC + c];
      if (gItem !== pItem) return false;
    }
  }

  return true;
}
