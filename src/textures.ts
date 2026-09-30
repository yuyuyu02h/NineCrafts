import * as THREE from 'three';

// 16x16 pixel art canvas generator
export function createNoiseCanvas(baseColor: string, noiseAmt = 0.1, drawFn?: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const cvs = document.createElement('canvas');
  cvs.width = 16;
  cvs.height = 16;
  const ctx = cvs.getContext('2d')!;
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, 16, 16);
  if (drawFn) drawFn(ctx);

  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 16; y++) {
      if (Math.random() < 0.35) {
        ctx.fillStyle = Math.random() > 0.5 ? `rgba(0,0,0,${noiseAmt})` : `rgba(255,255,255,${noiseAmt})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  return cvs;
}

export function canvasToTexture(canvas: HTMLCanvasElement, transparent = false): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  if (transparent) {
    tex.generateMipmaps = false;
  }
  return tex;
}

export function canvasToDataURL(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL();
}

export interface TextureAtlas {
  canvases: Record<string, HTMLCanvasElement>;
  textures: Record<string, THREE.CanvasTexture>;
  dataUrls: Record<string, string>;
  crackTextures: THREE.CanvasTexture[];
}

export function buildGameTextures(): TextureAtlas {
  const canvases: Record<string, HTMLCanvasElement> = {};
  const textures: Record<string, THREE.CanvasTexture> = {};
  const dataUrls: Record<string, string> = {};

  // 1. Grass
  canvases['grass_top'] = createNoiseCanvas('#55aa33', 0.15, (ctx) => {
    ctx.fillStyle = '#448822';
    for (let i = 0; i < 8; i++) {
      ctx.fillRect(Math.floor(Math.random() * 15), Math.floor(Math.random() * 15), 2, 2);
    }
  });

  canvases['dirt'] = createNoiseCanvas('#6b4c3a', 0.15, (ctx) => {
    ctx.fillStyle = '#553725';
    for (let i = 0; i < 6; i++) {
      ctx.fillRect(Math.floor(Math.random() * 14), Math.floor(Math.random() * 14), 2, 2);
    }
  });

  canvases['grass_side'] = createNoiseCanvas('#6b4c3a', 0.12, (ctx) => {
    ctx.fillStyle = '#55aa33';
    ctx.fillRect(0, 0, 16, 4);
    // Overhanging grass blades
    const teeth = [2, 1, 3, 0, 2, 3, 1, 2, 0, 1, 3, 2, 1, 0, 2, 1];
    for (let x = 0; x < 16; x++) {
      ctx.fillRect(x, 4, 1, teeth[x]);
    }
  });

  // 2. Stone & Cobble
  canvases['stone'] = createNoiseCanvas('#7a7a7a', 0.18, (ctx) => {
    ctx.fillStyle = '#606060';
    for (let i = 0; i < 10; i++) {
      ctx.fillRect(Math.floor(Math.random() * 14), Math.floor(Math.random() * 14), 2, 1);
    }
  });

  canvases['cobblestone'] = createNoiseCanvas('#686868', 0.2, (ctx) => {
    ctx.strokeStyle = '#3d3d3d';
    ctx.lineWidth = 1;
    // stone brick outlines
    ctx.strokeRect(1, 1, 6, 6);
    ctx.strokeRect(9, 1, 6, 6);
    ctx.strokeRect(4, 9, 8, 6);
  });

  // 3. Wood & Planks
  canvases['wood_side'] = createNoiseCanvas('#5c4033', 0.2, (ctx) => {
    ctx.fillStyle = '#3a271d';
    for (let i = 0; i < 16; i += 4) {
      ctx.fillRect(i, 0, 1, 16);
      ctx.fillRect(i + 2, 0, 1, 16);
    }
  });

  canvases['wood_top'] = createNoiseCanvas('#a08060', 0.15, (ctx) => {
    ctx.strokeStyle = '#6b4c3a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(8, 8, 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(8, 8, 7, 0, Math.PI * 2);
    ctx.stroke();
  });

  canvases['leaves'] = createNoiseCanvas('#2a7d2a', 0.25, (ctx) => {
    ctx.fillStyle = '#1e591e';
    for (let i = 0; i < 12; i++) {
      ctx.fillRect(Math.floor(Math.random() * 14), Math.floor(Math.random() * 14), 2, 2);
    }
  });

  canvases['planks'] = createNoiseCanvas('#b88b58', 0.12, (ctx) => {
    ctx.fillStyle = '#7a552e';
    for (let y = 0; y < 16; y += 4) {
      ctx.fillRect(0, y, 16, 1);
    }
    // Nails
    ctx.fillStyle = '#4a331c';
    ctx.fillRect(2, 2, 1, 1);
    ctx.fillRect(13, 6, 1, 1);
    ctx.fillRect(3, 10, 1, 1);
    ctx.fillRect(12, 14, 1, 1);
  });

  // 4. Sand & Glass
  canvases['sand'] = createNoiseCanvas('#dbca8c', 0.16, (ctx) => {
    ctx.fillStyle = '#c7b275';
    for (let i = 0; i < 10; i++) {
      ctx.fillRect(Math.floor(Math.random() * 15), Math.floor(Math.random() * 15), 1, 1);
    }
  });

  canvases['glass'] = createNoiseCanvas('rgba(210, 240, 255, 0.25)', 0.05, (ctx) => {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, 16, 16);
    // highlight sheen diagonal
    ctx.beginPath();
    ctx.moveTo(3, 12);
    ctx.lineTo(12, 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(6, 13);
    ctx.lineTo(13, 6);
    ctx.stroke();
  });

  // 5. Ores
  const makeOre = (oreColor: string, oreColor2: string) => {
    return createNoiseCanvas('#7a7a7a', 0.18, (ctx) => {
      ctx.fillStyle = oreColor;
      const spots = [
        [3, 3], [4, 4], [10, 2], [11, 3],
        [2, 11], [3, 12], [8, 9], [9, 10], [12, 11]
      ];
      spots.forEach(([x, y]) => {
        ctx.fillRect(x, y, 2, 2);
      });
      ctx.fillStyle = oreColor2;
      spots.forEach(([x, y]) => {
        ctx.fillRect(x, y, 1, 1);
      });
    });
  };

  canvases['coal_ore'] = makeOre('#222222', '#3e3e3e');
  canvases['iron_ore'] = makeOre('#d8af93', '#f0c8b0');
  canvases['gold_ore'] = makeOre('#fce844', '#fff385');
  canvases['diamond_ore'] = makeOre('#4dedf4', '#a6ffff');

  // 6. Brick & Bookshelf
  canvases['brick'] = createNoiseCanvas('#b24a35', 0.08, (ctx) => {
    ctx.fillStyle = '#e8d8c8';
    for (let y = 0; y < 16; y += 4) {
      ctx.fillRect(0, y, 16, 1);
      for (let x = 0; x < 16; x += 8) {
        ctx.fillRect(x + (y % 8 === 0 ? 0 : 4), y, 1, 4);
      }
    }
  });

  canvases['bookshelf'] = createNoiseCanvas('#b88b58', 0.1, (ctx) => {
    // Books inside
    ctx.fillStyle = '#2b1d0c';
    ctx.fillRect(1, 2, 14, 5);
    ctx.fillRect(1, 9, 14, 5);
    const bookColors = ['#cc3333', '#3366cc', '#339933', '#cca300', '#773399'];
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = bookColors[i % bookColors.length];
      ctx.fillRect(2 + i * 2, 2, 2, 5);
      ctx.fillRect(2 + (5 - i) * 2, 9, 2, 5);
    }
  });

  // 7. Crafting Table
  canvases['crafting_table_top'] = createNoiseCanvas('#b88b58', 0.1, (ctx) => {
    ctx.strokeStyle = '#4a2c11';
    ctx.lineWidth = 1;
    ctx.strokeRect(1, 1, 14, 14);
    ctx.beginPath();
    ctx.moveTo(8, 1);
    ctx.lineTo(8, 15);
    ctx.moveTo(1, 8);
    ctx.lineTo(15, 8);
    ctx.stroke();
    // Tiny tools icon in center
    ctx.fillStyle = '#6b4c3a';
    ctx.fillRect(5, 5, 6, 6);
  });
  canvases['crafting_table_side'] = createNoiseCanvas('#b88b58', 0.12, (ctx) => {
    ctx.fillStyle = '#6e451b';
    ctx.fillRect(0, 0, 16, 2);
    ctx.fillRect(0, 14, 16, 2);
    // Draw hanging saw and hammer
    ctx.fillStyle = '#999999';
    ctx.fillRect(4, 5, 2, 6);
    ctx.fillRect(3, 5, 4, 2);
    ctx.fillRect(10, 6, 2, 5);
    ctx.fillRect(9, 5, 4, 2);
  });

  // 8. Furnace
  canvases['furnace_side'] = canvases['cobblestone'];
  canvases['furnace_top'] = createNoiseCanvas('#7a7a7a', 0.15, (ctx) => {
    ctx.strokeStyle = '#444444';
    ctx.strokeRect(2, 2, 12, 12);
  });
  canvases['furnace_front'] = createNoiseCanvas('#7a7a7a', 0.15, (ctx) => {
    ctx.fillStyle = '#222222';
    ctx.fillRect(3, 4, 10, 8);
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(4, 5, 8, 6);
  });
  canvases['furnace_front_lit'] = createNoiseCanvas('#7a7a7a', 0.15, (ctx) => {
    ctx.fillStyle = '#ff6600';
    ctx.fillRect(3, 4, 10, 8);
    ctx.fillStyle = '#ffcc00';
    ctx.fillRect(4, 6, 8, 4);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(6, 7, 4, 2);
  });

  // 9. Chest
  canvases['chest_top'] = createNoiseCanvas('#8f6533', 0.12, (ctx) => {
    ctx.strokeStyle = '#42280d';
    ctx.strokeRect(1, 1, 14, 14);
  });
  canvases['chest_side'] = createNoiseCanvas('#8f6533', 0.12, (ctx) => {
    ctx.fillStyle = '#42280d';
    ctx.fillRect(0, 5, 16, 2);
  });
  canvases['chest_front'] = createNoiseCanvas('#8f6533', 0.12, (ctx) => {
    ctx.fillStyle = '#42280d';
    ctx.fillRect(0, 5, 16, 2);
    // Lock latch
    ctx.fillStyle = '#c0c0c0';
    ctx.fillRect(7, 4, 2, 4);
    ctx.fillStyle = '#333333';
    ctx.fillRect(7.5, 5, 1, 2);
  });

  // 10. TNT
  canvases['tnt_side'] = createNoiseCanvas('#d83020', 0.1, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 5, 16, 6);
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 5px sans-serif';
    ctx.fillText('TNT', 3, 10);
  });
  canvases['tnt_top'] = createNoiseCanvas('#d83020', 0.1, (ctx) => {
    ctx.fillStyle = '#992010';
    ctx.beginPath();
    ctx.arc(8, 8, 5, 0, Math.PI * 2);
    ctx.fill();
    // Fuse
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(7, 7, 2, 2);
  });

  // 11. Bed & Redstone & Torch
  canvases['bed'] = createNoiseCanvas('#dd2222', 0.1, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 16, 6); // Pillow
    ctx.strokeStyle = '#aa1111';
    ctx.strokeRect(1, 7, 14, 8);
  });

  canvases['redstone'] = createNoiseCanvas('#2a0505', 0.0, (ctx) => {
    ctx.fillStyle = '#ff2222';
    ctx.fillRect(6, 6, 4, 4);
    ctx.fillRect(7, 0, 2, 16);
    ctx.fillRect(0, 7, 16, 2);
    ctx.fillStyle = '#ff9999';
    ctx.fillRect(7, 7, 2, 2);
  });

  canvases['torch'] = createNoiseCanvas('rgba(0,0,0,0)', 0.0, (ctx) => {
    ctx.fillStyle = '#6b4c3a';
    ctx.fillRect(7, 5, 2, 11);
    ctx.fillStyle = '#ffaa00';
    ctx.fillRect(6, 2, 4, 3);
    ctx.fillStyle = '#ffff55';
    ctx.fillRect(7, 1, 2, 2);
  });

  canvases['flower'] = createNoiseCanvas('rgba(0,0,0,0)', 0.0, (ctx) => {
    ctx.fillStyle = '#3a8a3a';
    ctx.fillRect(7, 6, 2, 10); // Stem
    ctx.fillRect(5, 10, 2, 2);
    ctx.fillRect(9, 8, 2, 2);
    // Petals
    ctx.fillStyle = '#ff2233';
    ctx.fillRect(6, 2, 4, 4);
    ctx.fillStyle = '#ffea00';
    ctx.fillRect(7, 3, 2, 2);
  });

  canvases['water'] = createNoiseCanvas('rgba(30, 120, 230, 0.7)', 0.1, (ctx) => {
    ctx.fillStyle = 'rgba(70, 160, 255, 0.4)';
    ctx.fillRect(2, 4, 6, 2);
    ctx.fillRect(8, 10, 6, 2);
  });

  // Tools & Items Icons
  canvases['stick'] = createNoiseCanvas('rgba(0,0,0,0)', 0.0, (ctx) => {
    ctx.fillStyle = '#6b4c3a';
    for (let i = 2; i < 14; i++) {
      ctx.fillRect(15 - i, i, 2, 2);
    }
  });

  canvases['coal'] = createNoiseCanvas('rgba(0,0,0,0)', 0.0, (ctx) => {
    ctx.fillStyle = '#222222';
    ctx.beginPath();
    ctx.arc(8, 8, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#444444';
    ctx.fillRect(6, 6, 2, 2);
  });

  canvases['iron_ingot'] = createNoiseCanvas('rgba(0,0,0,0)', 0.0, (ctx) => {
    ctx.fillStyle = '#d8d8d8';
    ctx.fillRect(3, 6, 10, 5);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(4, 6, 8, 2);
  });

  canvases['gold_ingot'] = createNoiseCanvas('rgba(0,0,0,0)', 0.0, (ctx) => {
    ctx.fillStyle = '#f5c518';
    ctx.fillRect(3, 6, 10, 5);
    ctx.fillStyle = '#fff480';
    ctx.fillRect(4, 6, 8, 2);
  });

  canvases['diamond'] = createNoiseCanvas('rgba(0,0,0,0)', 0.0, (ctx) => {
    ctx.fillStyle = '#4dedf4';
    ctx.beginPath();
    ctx.moveTo(8, 2);
    ctx.lineTo(13, 7);
    ctx.lineTo(8, 14);
    ctx.lineTo(3, 7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(6, 6, 3, 3);
  });

  canvases['raw_meat'] = createNoiseCanvas('rgba(0,0,0,0)', 0.0, (ctx) => {
    ctx.fillStyle = '#d94b4b';
    ctx.beginPath();
    ctx.ellipse(8, 8, 6, 4, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(11, 4, 2, 3); // Bone
  });

  canvases['cooked_steak'] = createNoiseCanvas('rgba(0,0,0,0)', 0.0, (ctx) => {
    ctx.fillStyle = '#7a3b2b';
    ctx.beginPath();
    ctx.ellipse(8, 8, 6, 4, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#441d13';
    ctx.fillRect(6, 6, 5, 1);
    ctx.fillRect(7, 9, 4, 1);
  });

  canvases['apple'] = createNoiseCanvas('rgba(0,0,0,0)', 0.0, (ctx) => {
    ctx.fillStyle = '#dd1111';
    ctx.beginPath();
    ctx.arc(8, 9, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#558822';
    ctx.fillRect(8, 3, 2, 3); // Stem
  });

  // Pickaxe builder helper
  const makeTool = (headColor: string, type: 'pickaxe' | 'sword' | 'axe' | 'shovel') => {
    return createNoiseCanvas('rgba(0,0,0,0)', 0.0, (ctx) => {
      // Stick handle
      ctx.fillStyle = '#6b4c3a';
      for (let i = 2; i < 12; i++) {
        ctx.fillRect(14 - i, i + 2, 2, 2);
      }
      ctx.fillStyle = headColor;
      if (type === 'pickaxe') {
        ctx.fillRect(8, 2, 6, 2);
        ctx.fillRect(12, 4, 2, 4);
        ctx.fillRect(5, 5, 4, 2);
        ctx.fillRect(3, 7, 2, 3);
      } else if (type === 'sword') {
        for (let i = 0; i < 8; i++) {
          ctx.fillRect(14 - i, i, 2, 2);
        }
        ctx.fillStyle = '#443322';
        ctx.fillRect(6, 8, 4, 2); // Guard
      } else if (type === 'axe') {
        ctx.fillRect(8, 2, 6, 3);
        ctx.fillRect(10, 5, 4, 4);
      } else if (type === 'shovel') {
        ctx.fillRect(10, 2, 4, 4);
      }
    });
  };

  const toolTiers = [
    { name: 'wood', color: '#8f6533' },
    { name: 'stone', color: '#888888' },
    { name: 'iron', color: '#d8d8d8' },
    { name: 'diamond', color: '#4dedf4' },
  ];

  toolTiers.forEach((tier) => {
    canvases[`${tier.name}_pickaxe`] = makeTool(tier.color, 'pickaxe');
    canvases[`${tier.name}_sword`] = makeTool(tier.color, 'sword');
    canvases[`${tier.name}_axe`] = makeTool(tier.color, 'axe');
    canvases[`${tier.name}_shovel`] = makeTool(tier.color, 'shovel');
  });

  canvases['bow'] = createNoiseCanvas('rgba(0,0,0,0)', 0.0, (ctx) => {
    ctx.strokeStyle = '#6b4c3a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(8, 8, 6, -Math.PI * 0.4, Math.PI * 0.4);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(11, 3);
    ctx.lineTo(11, 13);
    ctx.stroke();
  });

  canvases['arrow'] = createNoiseCanvas('rgba(0,0,0,0)', 0.0, (ctx) => {
    ctx.fillStyle = '#6b4c3a';
    for (let i = 3; i < 13; i++) {
      ctx.fillRect(15 - i, i, 2, 2);
    }
    ctx.fillStyle = '#888888';
    ctx.fillRect(11, 2, 3, 3); // Tip
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(2, 12, 3, 2); // Feather
  });

  // Crack animation textures (stages 0 to 4)
  const crackTextures: THREE.CanvasTexture[] = [];
  for (let stage = 0; stage < 5; stage++) {
    const crackCanvas = document.createElement('canvas');
    crackCanvas.width = 16;
    crackCanvas.height = 16;
    const cctx = crackCanvas.getContext('2d')!;
    cctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    cctx.lineWidth = 1;

    // Progressive jagged cracks
    cctx.beginPath();
    cctx.moveTo(8, 8);
    cctx.lineTo(5, 5);
    cctx.lineTo(3, 8);
    if (stage >= 1) {
      cctx.moveTo(8, 8);
      cctx.lineTo(12, 6);
      cctx.lineTo(14, 9);
    }
    if (stage >= 2) {
      cctx.moveTo(8, 8);
      cctx.lineTo(8, 13);
      cctx.lineTo(11, 15);
    }
    if (stage >= 3) {
      cctx.moveTo(5, 5);
      cctx.lineTo(2, 2);
      cctx.moveTo(12, 6);
      cctx.lineTo(15, 3);
    }
    if (stage >= 4) {
      cctx.moveTo(3, 8);
      cctx.lineTo(1, 12);
      cctx.moveTo(8, 13);
      cctx.lineTo(4, 14);
    }
    cctx.stroke();

    const ctex = new THREE.CanvasTexture(crackCanvas);
    ctex.magFilter = THREE.NearestFilter;
    ctex.minFilter = THREE.NearestFilter;
    crackTextures.push(ctex);
  }

  // Convert canvases to Three.js textures & data URLs
  for (const key in canvases) {
    const cvs = canvases[key];
    const isTrans = key === 'glass' || key === 'water' || key === 'torch' || key === 'flower';
    textures[key] = canvasToTexture(cvs, isTrans);
    dataUrls[key] = canvasToDataURL(cvs);
  }

  return { canvases, textures, dataUrls, crackTextures };
}
