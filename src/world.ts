import * as THREE from 'three';
import { BLOCKS, BLOCK_DEFS, BlockId } from './blocks';
import { TextureAtlas } from './textures';
import { DebrisParticle, TorchLight } from './types';
import { sound } from './audio';
import { worldRandom } from './worldSeed';
import type { WorldSave } from './save';
import { disposeObjects } from './resources';

export const CHUNK_SIZE = 16;
export const MAX_INSTANCES_PER_BLOCK = 40000;
export const BEDROCK_Y = -14;
export const MAX_WATER_QUEUE = 2048;
export const MAX_FLOWING_WATER = 4096;
export const MAX_TORCH_LIGHTS = 8;
export const MAX_DEBRIS = 180;
export interface PrimedTnt { x: number; y: number; z: number; remaining: number }


export class VoxelWorld {
  public scene: THREE.Scene;
  public atlas: TextureAtlas;
  public worldData = new Map<string, BlockId>(); // "x,y,z" => BlockId
  public chunkData = new Map<string, Array<{ x: number; y: number; z: number; type: BlockId }>>();
  public generatedChunks = new Set<string>();

  public instancedMeshes: Partial<Record<BlockId, THREE.InstancedMesh>> = {};
  public torchLights = new Map<string, TorchLight>();
  public debrisList: DebrisParticle[] = [];

  // Target highlight wireframe
  public targetBoxMesh: THREE.LineSegments;
  // Crack overlay mesh
  public crackMesh: THREE.Mesh;

  public renderDistance = 2; // in chunks (5x5 chunk grid, 80x80 blocks for ultra smooth 60fps)
  public lastPlayerChunkX: number | null = null;
  public lastPlayerChunkZ: number | null = null;
  public lastPlayerPos: THREE.Vector3 = new THREE.Vector3(8, 12, 8);

  // Precomputed exposed blocks per chunk (eliminates 900,000 occlusion tests per frame)
  public chunkRenderData = new Map<string, Array<{ x: number; y: number; z: number; type: BlockId }>>();
  public dirtyChunks = new Set<string>();

  // Water fluid simulation queue
  public pendingWaterFlow: Array<{ x: number; y: number; z: number; spread: number }> = [];
  private waterFlowTimer = 0;
  private waterQueued = new Set<string>();
  public waterLevels = new Map<string, number>();
  public primedTnt: PrimedTnt[] = [];
  public torchPositions = new Map<string, THREE.Vector3>();
  private editsByChunk = new Map<string, Map<string, BlockId>>();
  private lastRenderDistance = -1;
  private lastLightPos = new THREE.Vector3(Infinity, Infinity, Infinity);


  public seed: number;
  public blockEdits = new Map<string, BlockId>();
  public onBlockRemoved?: (x: number, y: number, z: number, type: BlockId) => void;
  private generating = false;
  private dummy = new THREE.Object3D();

  constructor(scene: THREE.Scene, atlas: TextureAtlas, seed = Math.floor(Math.random() * 0x100000000)) {
    this.seed = seed >>> 0;
    this.scene = scene;
    this.atlas = atlas;

    // Create wireframe highlight box
    const boxGeo = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    const edges = new THREE.EdgesGeometry(boxGeo);
    this.targetBoxMesh = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2, transparent: true, opacity: 0.6 })
    );
    this.targetBoxMesh.visible = false;
    this.scene.add(this.targetBoxMesh);
    boxGeo.dispose();

    // Crack overlay mesh
    const crackGeo = new THREE.BoxGeometry(1.004, 1.004, 1.004);
    const crackMat = new THREE.MeshBasicMaterial({
      map: this.atlas.crackTextures[0],
      transparent: true,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.crackMesh = new THREE.Mesh(crackGeo, crackMat);
    this.crackMesh.visible = false;
    this.scene.add(this.crackMesh);

    this.initInstancedMeshes();
  }

  public getKey(x: number, y: number, z: number): string {
    return `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
  }

  public getChunkKey(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  public isChunkLoaded(x: number, z: number): boolean {
    return this.generatedChunks.has(this.getChunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)));
  }

  public waterMaterial: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial | null = null;

  public markChunkDirty(cx: number, cz: number) {
    this.dirtyChunks.add(this.getChunkKey(cx, cz));
  }

  public rebuildChunkRenderData(cx: number, cz: number) {
    const cKey = this.getChunkKey(cx, cz);
    const blocks = this.chunkData.get(cKey);
    if (!blocks) {
      this.chunkRenderData.delete(cKey);
      this.dirtyChunks.delete(cKey);
      return;
    }

    const exposed: Array<{ x: number; y: number; z: number; type: BlockId }> = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (!this.isBlockOccluded(b.x, b.y, b.z)) {
        exposed.push(b);
      }
    }
    this.chunkRenderData.set(cKey, exposed);
    this.dirtyChunks.delete(cKey);
  }

  // Check if a block's 6 neighbor faces are completely surrounded by opaque solid blocks
  public isBlockOccluded(x: number, y: number, z: number): boolean {
    const blockType = this.getBlock(x, y, z);
    if (!blockType) return false;

    // Torch, flower, glass always need rendering
    if (blockType === BLOCKS.TORCH || blockType === BLOCKS.FLOWER || blockType === BLOCKS.GLASS) {
      return false;
    }

    // Water: only occlude if water or solid block is above, below, and on all 4 sides
    if (blockType === BLOCKS.WATER) {
      const top = this.getBlock(x, y + 1, z);
      if (top !== BLOCKS.WATER && !this.isOpaqueSolid(top)) return false; // Water surface must render!
    }

    // Check top neighbor first (fast reject for 95% of surface blocks)
    if (!this.isOpaqueSolid(this.getBlock(x, y + 1, z))) return false;
    if (!this.isOpaqueSolid(this.getBlock(x, y - 1, z))) return false;
    if (!this.isOpaqueSolid(this.getBlock(x + 1, y, z))) return false;
    if (!this.isOpaqueSolid(this.getBlock(x - 1, y, z))) return false;
    if (!this.isOpaqueSolid(this.getBlock(x, y, z + 1))) return false;
    if (!this.isOpaqueSolid(this.getBlock(x, y, z - 1))) return false;

    return true; // 100% enclosed and hidden inside the earth
  }

  private isOpaqueSolid(blockId: BlockId | null): boolean {
    if (blockId === null || blockId === BLOCKS.AIR) return false;
    if (
      blockId === BLOCKS.WATER ||
      blockId === BLOCKS.GLASS ||
      blockId === BLOCKS.LEAVES ||
      blockId === BLOCKS.TORCH ||
      blockId === BLOCKS.FLOWER
    ) {
      return false;
    }
    const def = BLOCK_DEFS[blockId];
    return !!(def && def.isSolid && !def.isTransparent);
  }

  private initInstancedMeshes() {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const { textures } = this.atlas;

    // Helper to make PBR standard material (Shader Mod quality)
    const makeMat = (
      texKey: string,
      options: {
        transparent?: boolean;
        opacity?: number;
        alphaTest?: number;
        emissive?: boolean;
        roughness?: number;
        metalness?: number;
        depthWrite?: boolean;
      } = {}
    ) => {
      const tex = textures[texKey];
      const {
        transparent = false,
        opacity = 1.0,
        alphaTest,
        emissive = false,
        roughness = 0.85,
        metalness = 0.05,
        depthWrite = true,
      } = options;

      return new THREE.MeshStandardMaterial({
        map: tex,
        transparent,
        opacity,
        alphaTest: alphaTest !== undefined ? alphaTest : (transparent && opacity === 1.0 ? 0.35 : 0),
        roughness,
        metalness,
        depthWrite,
        emissive: emissive ? new THREE.Color(0xffaa44) : new THREE.Color(0x000000),
        emissiveMap: emissive ? tex : null,
        emissiveIntensity: emissive ? 2.0 : 0,
      });
    };

    // Physically-based Water Material with Gerstner Waves & Fresnel Reflections
    const waterUniforms = {
      uTime: { value: 0 },
    };

    const waterMat = new THREE.MeshStandardMaterial({
      map: textures['water'],
      transparent: true,
      opacity: 0.72,
      roughness: 0.08,
      metalness: 0.15,
      depthWrite: false,
    });
    waterMat.userData = waterUniforms;

    // Shader injection for physical wave displacement & Fresnel optics
    waterMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = waterUniforms.uTime;
      shader.vertexShader = `
        uniform float uTime;
        varying vec3 vWorldPos;
        ${shader.vertexShader}
      `;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          vec4 wPos = instanceMatrix * vec4(position, 1.0);
        #else
          vec4 wPos = modelMatrix * vec4(position, 1.0);
        #endif
        vWorldPos = wPos.xyz;

        // Wave physics: if facing upwards, calculate Gerstner wave displacement
        if (normal.y > 0.5) {
          float w1 = sin(wPos.x * 1.8 + uTime * 2.4) * 0.045 + cos(wPos.z * 1.4 + uTime * 1.9) * 0.04;
          float w2 = sin((wPos.x + wPos.z) * 2.2 + uTime * 3.1) * 0.025;
          transformed.y += w1 + w2;
        }
        `
      );

      shader.fragmentShader = `
        uniform float uTime;
        varying vec3 vWorldPos;
        ${shader.fragmentShader}
      `;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `
        #include <dithering_fragment>
        vec3 vDir = normalize(cameraPosition - vWorldPos);
        // Fresnel law (Schlick approximation for water n=1.333)
        float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(vDir, vec3(0.0, 1.0, 0.0)), 0.0), 3.5);
        // Caustics & wave shimmer
        float caustic = sin(vWorldPos.x * 3.2 + uTime * 2.6) * cos(vWorldPos.z * 3.2 + uTime * 2.1) * 0.08;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.35, 0.75, 0.95), fresnel * 0.55) + vec3(caustic);
        `
      );
    };

    this.waterMaterial = waterMat;

    // Build materials for each block
    // Wood & Planks: explicitly solid, non-transparent, depthWrite: true
    const blockMaterials: Record<number, THREE.Material | THREE.Material[]> = {
      [BLOCKS.GRASS]: [
        makeMat('grass_side', { roughness: 0.88 }),
        makeMat('grass_side', { roughness: 0.88 }),
        makeMat('grass_top', { roughness: 0.95 }),
        makeMat('dirt', { roughness: 0.95 }),
        makeMat('grass_side', { roughness: 0.88 }),
        makeMat('grass_side', { roughness: 0.88 }),
      ],
      [BLOCKS.DIRT]: makeMat('dirt', { roughness: 0.95 }),
      [BLOCKS.STONE]: makeMat('stone', { roughness: 0.85, metalness: 0.08 }),
      [BLOCKS.COBBLESTONE]: makeMat('cobblestone', { roughness: 0.9, metalness: 0.05 }),
      [BLOCKS.WOOD]: [
        makeMat('wood_side', { roughness: 0.8, depthWrite: true }),
        makeMat('wood_side', { roughness: 0.8, depthWrite: true }),
        makeMat('wood_top', { roughness: 0.85, depthWrite: true }),
        makeMat('wood_top', { roughness: 0.85, depthWrite: true }),
        makeMat('wood_side', { roughness: 0.8, depthWrite: true }),
        makeMat('wood_side', { roughness: 0.8, depthWrite: true }),
      ],
      // Leaves: OPAQUE render pass with cutout alphaTest (never causes transparency bugs on wood or blocks behind)
      [BLOCKS.LEAVES]: makeMat('leaves', { transparent: false, alphaTest: 0.5, roughness: 0.7, depthWrite: true }),
      [BLOCKS.PLANKS]: makeMat('planks', { roughness: 0.75, depthWrite: true }),
      [BLOCKS.SAND]: makeMat('sand', { roughness: 0.92 }),
      [BLOCKS.GLASS]: makeMat('glass', { transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.15, depthWrite: false }),
      [BLOCKS.BRICK]: makeMat('brick', { roughness: 0.8 }),
      [BLOCKS.BOOKSHELF]: [
        makeMat('bookshelf', { roughness: 0.75 }),
        makeMat('bookshelf', { roughness: 0.75 }),
        makeMat('planks', { roughness: 0.75 }),
        makeMat('planks', { roughness: 0.75 }),
        makeMat('bookshelf', { roughness: 0.75 }),
        makeMat('bookshelf', { roughness: 0.75 }),
      ],
      [BLOCKS.COAL_ORE]: makeMat('coal_ore', { roughness: 0.8, metalness: 0.1 }),
      [BLOCKS.IRON_ORE]: makeMat('iron_ore', { roughness: 0.5, metalness: 0.45 }),
      [BLOCKS.GOLD_ORE]: makeMat('gold_ore', { roughness: 0.25, metalness: 0.85 }),
      [BLOCKS.DIAMOND_ORE]: makeMat('diamond_ore', { roughness: 0.15, metalness: 0.65 }),
      [BLOCKS.CRAFTING_TABLE]: [
        makeMat('crafting_table_side', { roughness: 0.75 }),
        makeMat('crafting_table_side', { roughness: 0.75 }),
        makeMat('crafting_table_top', { roughness: 0.75 }),
        makeMat('planks', { roughness: 0.75 }),
        makeMat('crafting_table_side', { roughness: 0.75 }),
        makeMat('crafting_table_side', { roughness: 0.75 }),
      ],
      [BLOCKS.FURNACE]: [
        makeMat('furnace_side', { roughness: 0.85 }),
        makeMat('furnace_side', { roughness: 0.85 }),
        makeMat('furnace_top', { roughness: 0.85 }),
        makeMat('furnace_top', { roughness: 0.85 }),
        makeMat('furnace_front', { roughness: 0.85 }),
        makeMat('furnace_side', { roughness: 0.85 }),
      ],
      [BLOCKS.CHEST]: [
        makeMat('chest_side', { roughness: 0.75 }),
        makeMat('chest_side', { roughness: 0.75 }),
        makeMat('chest_top', { roughness: 0.75 }),
        makeMat('chest_top', { roughness: 0.75 }),
        makeMat('chest_front', { roughness: 0.75 }),
        makeMat('chest_side', { roughness: 0.75 }),
      ],
      [BLOCKS.TNT]: [
        makeMat('tnt_side', { roughness: 0.8 }),
        makeMat('tnt_side', { roughness: 0.8 }),
        makeMat('tnt_top', { roughness: 0.8 }),
        makeMat('dirt', { roughness: 0.95 }),
        makeMat('tnt_side', { roughness: 0.8 }),
        makeMat('tnt_side', { roughness: 0.8 }),
      ],
      [BLOCKS.BED]: makeMat('bed', { roughness: 0.8 }),
      [BLOCKS.REDSTONE]: makeMat('redstone', { emissive: true, roughness: 0.3, metalness: 0.2 }),
      [BLOCKS.BEDROCK]: makeMat('stone', { roughness: 0.95 }),
      [BLOCKS.WATER]: waterMat,
      [BLOCKS.TORCH]: makeMat('torch', { transparent: true, emissive: true, roughness: 0.2 }),
      [BLOCKS.FLOWER]: makeMat('flower', { transparent: true, roughness: 0.8 }),
    };

    // Instantiate InstancedMesh for each block type
    for (const key in blockMaterials) {
      const type = parseInt(key) as BlockId;
      const mat = blockMaterials[type];
      const imesh = new THREE.InstancedMesh(geo, mat, MAX_INSTANCES_PER_BLOCK);
      imesh.castShadow = type !== BLOCKS.GLASS && type !== BLOCKS.WATER && type !== BLOCKS.TORCH;
      imesh.receiveShadow = type !== BLOCKS.GLASS;
      imesh.count = 0;
      // CRITICAL: Disable Three.js frustum culling on world-spanning InstancedMeshes
      // Without this, when moving far away from (0,0,0) or looking around, Three.js wrongly culls the entire mesh!
      imesh.frustumCulled = false;
      this.scene.add(imesh);
      this.instancedMeshes[type] = imesh;
    }
  }

  public animateWater(delta: number) {
    if (this.waterMaterial) {
      if (this.waterMaterial.userData?.uTime) {
        this.waterMaterial.userData.uTime.value += delta;
      }
      if (this.waterMaterial.map) {
        this.waterMaterial.map.offset.x = (this.waterMaterial.map.offset.x + delta * 0.04) % 1;
        this.waterMaterial.map.offset.y = (this.waterMaterial.map.offset.y + delta * 0.025) % 1;
      }
    }
  }

  // Multi-octave Perlin-like 2D noise generator
  public getTerrainHeight(x: number, z: number): { height: number; biome: 'plains' | 'forest' | 'desert' | 'mountains' } {
    // Biome determination
    const biomeVal = Math.sin(x * 0.02) * Math.cos(z * 0.02);
    let biome: 'plains' | 'forest' | 'desert' | 'mountains' = 'plains';
    if (biomeVal > 0.45) biome = 'mountains';
    else if (biomeVal < -0.4) biome = 'desert';
    else if (Math.sin(x * 0.05 + z * 0.03) > 0.15) biome = 'forest';

    let n = 0;
    if (biome === 'mountains') {
      n += Math.sin(x * 0.06) * Math.cos(z * 0.06) * 7;
      n += Math.sin(x * 0.03 + z * 0.02) * 5;
      n += 6;
    } else if (biome === 'desert') {
      n += Math.sin(x * 0.04) * 2;
      n += Math.cos(z * 0.04) * 1.5;
    } else if (biome === 'forest') {
      n += Math.sin(x * 0.08) * Math.cos(z * 0.08) * 3;
      n += Math.sin(x * 0.04 + z * 0.04) * 2;
      n += 2;
    } else {
      // Plains
      n += Math.sin(x * 0.06) * Math.cos(z * 0.06) * 2.5;
      n += Math.sin(x * 0.02) * 2;
    }

    return { height: Math.floor(n), biome };
  }

  // 3D cave noise
  private isCave(x: number, y: number, z: number): boolean {
    if (y > 0 || y < BEDROCK_Y + 1) return false;
    const c1 = Math.sin(x * 0.18) * Math.cos(y * 0.22) * Math.sin(z * 0.18);
    const c2 = Math.cos(x * 0.12 + y * 0.14) * Math.sin(z * 0.12);
    return c1 + c2 > 0.85;
  }

  public generateChunk(cx: number, cz: number) {
    const cKey = this.getChunkKey(cx, cz);
    if (this.generatedChunks.has(cKey)) return;
    this.generatedChunks.add(cKey);

    this.markChunkDirty(cx, cz);
    this.markChunkDirty(cx - 1, cz);
    this.markChunkDirty(cx + 1, cz);
    this.markChunkDirty(cx, cz - 1);
    this.markChunkDirty(cx, cz + 1);

    const startX = cx * CHUNK_SIZE;
    const startZ = cz * CHUNK_SIZE;
    this.generating = true;
    try {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
          const gx = startX + x;
          const gz = startZ + z;
          const { height: surfaceY, biome } = this.getTerrainHeight(gx, gz);

          // Bedrock floor
          this.addBlock(gx, BEDROCK_Y, gz, BLOCKS.BEDROCK, false);

          // Underground from bedrock up to surface
          for (let y = BEDROCK_Y + 1; y < surfaceY; y++) {
            if (this.isCave(gx, y, gz)) {
              continue; // Open cave space
            }

            // Mineral ores generation
            const rand = worldRandom(this.seed, gx, y, gz, 1);
            if (y <= -8 && rand < 0.015) {
              this.addBlock(gx, y, gz, BLOCKS.DIAMOND_ORE, false);
            } else if (y <= -4 && rand < 0.03) {
              this.addBlock(gx, y, gz, BLOCKS.GOLD_ORE, false);
            } else if (y <= 0 && rand < 0.06) {
              this.addBlock(gx, y, gz, BLOCKS.IRON_ORE, false);
            } else if (rand < 0.08) {
              this.addBlock(gx, y, gz, BLOCKS.COAL_ORE, false);
            } else if (y >= surfaceY - 3 && biome !== 'desert') {
              this.addBlock(gx, y, gz, BLOCKS.DIRT, false);
            } else {
              this.addBlock(gx, y, gz, BLOCKS.STONE, false);
            }
          }

          // Surface layer
          if (biome === 'desert') {
            this.addBlock(gx, surfaceY, gz, BLOCKS.SAND, false);
            this.addBlock(gx, surfaceY - 1, gz, BLOCKS.SAND, false);
            this.addBlock(gx, surfaceY - 2, gz, BLOCKS.SAND, false);

            // Cactus (rare)
            if (worldRandom(this.seed, gx, surfaceY, gz, 2) < 0.015) {
              this.addBlock(gx, surfaceY + 1, gz, BLOCKS.LEAVES, false);
              this.addBlock(gx, surfaceY + 2, gz, BLOCKS.LEAVES, false);
            }
          } else {
            // Grass or water body
            if (surfaceY < -1) {
              // Lake / Pond
              this.addBlock(gx, surfaceY, gz, BLOCKS.SAND, false);
              for (let wy = surfaceY + 1; wy <= 0; wy++) {
                this.addBlock(gx, wy, gz, BLOCKS.WATER, false);
              }
            } else {
              this.addBlock(gx, surfaceY, gz, BLOCKS.GRASS, false);
              this.addBlock(gx, surfaceY - 1, gz, BLOCKS.DIRT, false);

              // Flora: Trees or Flowers
              const treeChance = biome === 'forest' ? 0.045 : 0.015;
              if (worldRandom(this.seed, gx, surfaceY, gz, 3) >= treeChance &&
                worldRandom(this.seed, gx, surfaceY, gz, 4) < 0.04) {
                this.addBlock(gx, surfaceY + 1, gz, BLOCKS.FLOWER, false);
              }
            }
          }
        }
      }
      // Generate only cells owned by this chunk, including canopies from neighboring trees.
      // This avoids chunk-visit-order changing terrain or overwriting saved holes.
      for (let gx = startX - 2; gx < startX + CHUNK_SIZE + 2; gx++) {
        for (let gz = startZ - 2; gz < startZ + CHUNK_SIZE + 2; gz++) {
          const { height, biome } = this.getTerrainHeight(gx, gz);
          const chance = biome === 'forest' ? 0.045 : 0.015;
          if (biome !== 'desert' && height >= -1 && worldRandom(this.seed, gx, height, gz, 3) < chance) {
            this.generateTree(gx, height + 1, gz, { minX: startX, minZ: startZ });
          }
        }
      }
    } finally { this.generating = false; }
    for (const [key, type] of this.editsByChunk.get(cKey) ?? []) {
      if (type === BLOCKS.AIR) continue;
      const [x, y, z] = key.split(',').map(Number);
      if (Math.floor(x / CHUNK_SIZE) === cx && Math.floor(z / CHUNK_SIZE) === cz) {
        this.addBlock(x, y, z, type, false);
      }
    }
  }

  public generateTree(bx: number, by: number, bz: number, bounds?: { minX: number; minZ: number }) {
    const place = (x: number, y: number, z: number, type: BlockId) => {
      if (!bounds || (x >= bounds.minX && x < bounds.minX + CHUNK_SIZE && z >= bounds.minZ && z < bounds.minZ + CHUNK_SIZE)) {
        this.addBlock(x, y, z, type, false);
      }
    };
    const height = 4 + Math.floor(worldRandom(this.seed, bx, by, bz, 5) * 2);
    for (let y = 0; y < height; y++) {
      place(bx, by + y, bz, BLOCKS.WOOD);
    }
    // Leaves canopy
    for (let x = -2; x <= 2; x++) {
      for (let z = -2; z <= 2; z++) {
        for (let y = height - 2; y <= height + 1; y++) {
          if (Math.abs(x) + Math.abs(z) > 3 && y !== height - 1) continue;
          if (x === 0 && z === 0 && y < height) continue;
          place(bx + x, by + y, bz + z, BLOCKS.LEAVES);
        }
      }
    }
  }

  public updateChunks(playerPos: THREE.Vector3) {
    this.lastPlayerPos.copy(playerPos);
    const pCx = Math.floor(playerPos.x / CHUNK_SIZE), pCz = Math.floor(playerPos.z / CHUNK_SIZE);
    if (pCx === this.lastPlayerChunkX && pCz === this.lastPlayerChunkZ && this.lastRenderDistance === this.renderDistance) {
      if (this.lastLightPos.distanceToSquared(playerPos) >= 4) this.syncTorchLights();
      return;
    }
    const keep = this.renderDistance + 1;
    for (const key of [...this.generatedChunks]) {
      const [cx, cz] = key.split(',').map(Number);
      if (Math.abs(cx - pCx) <= keep && Math.abs(cz - pCz) <= keep) continue;
      for (const b of this.chunkData.get(key) ?? []) {
        const cell = this.getKey(b.x, b.y, b.z);
        this.worldData.delete(cell); this.torchPositions.delete(cell);
        if (b.type === BLOCKS.TORCH) this.removeTorchLight(b.x, b.y, b.z);
      }
      this.chunkData.delete(key); this.chunkRenderData.delete(key); this.generatedChunks.delete(key); this.dirtyChunks.delete(key);
    }
    this.pendingWaterFlow = this.pendingWaterFlow.filter(w => this.generatedChunks.has(this.getChunkKey(Math.floor(w.x / 16), Math.floor(w.z / 16))));
    this.waterQueued = new Set(this.pendingWaterFlow.map(w => this.getKey(w.x, w.y, w.z)));
    // One extra resident ring prevents water/AI reading unknown cells at the visible edge.
    for (let cx = pCx - keep; cx <= pCx + keep; cx++) for (let cz = pCz - keep; cz <= pCz + keep; cz++) this.generateChunk(cx, cz);
    for (const key of this.dirtyChunks) if (!this.generatedChunks.has(key)) this.dirtyChunks.delete(key);
    this.lastPlayerChunkX = pCx; this.lastPlayerChunkZ = pCz; this.lastRenderDistance = this.renderDistance;
    this.updateInstancedMeshes(playerPos);
  }

  private recordEdit(key: string, type: BlockId, cx: number, cz: number) {
    this.blockEdits.set(key, type);
    const chunk = this.getChunkKey(cx, cz);
    if (!this.editsByChunk.has(chunk)) this.editsByChunk.set(chunk, new Map());
    this.editsByChunk.get(chunk)!.set(key, type);
  }

  public addBlock(x: number, y: number, z: number, type: BlockId, updateMesh = true) {
    const bx = Math.floor(x);
    const by = Math.floor(y);
    const bz = Math.floor(z);
    const key = this.getKey(bx, by, bz);

    if (this.worldData.has(key) || (this.generating && this.blockEdits.has(key))) return;

    this.worldData.set(key, type);
    if (!this.generating) this.recordEdit(key, type, Math.floor(bx / CHUNK_SIZE), Math.floor(bz / CHUNK_SIZE));

    const cx = Math.floor(bx / CHUNK_SIZE);
    const cz = Math.floor(bz / CHUNK_SIZE);
    const cKey = this.getChunkKey(cx, cz);

    if (!this.chunkData.has(cKey)) {
      this.chunkData.set(cKey, []);
    }
    this.chunkData.get(cKey)!.push({ x: bx, y: by, z: bz, type });

    this.markChunkDirty(cx, cz);
    if (bx % CHUNK_SIZE === 0) this.markChunkDirty(cx - 1, cz);
    if (((bx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE === CHUNK_SIZE - 1) this.markChunkDirty(cx + 1, cz);
    if (bz % CHUNK_SIZE === 0) this.markChunkDirty(cx, cz - 1);
    if (((bz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE === CHUNK_SIZE - 1) this.markChunkDirty(cx, cz + 1);

    // Handle Torch light
    if (type === BLOCKS.TORCH) {
      this.torchPositions.set(key, new THREE.Vector3(bx, by, bz));
      this.addTorchLight(bx, by, bz);
    }

    if (updateMesh) {
      this.updateInstancedMeshes(this.lastPlayerPos);
    }

    // If water was placed, queue physical water flow
    if (type === BLOCKS.WATER && !this.generating) {
      const spread = this.waterLevels.get(key) ?? 0;
      this.waterLevels.set(key, spread);
      this.queueWater(bx, by, bz, spread);
    }
  }

  public removeBlock(x: number, y: number, z: number, spawnParticles = true, updateMesh = true): BlockId | null {
    const bx = Math.floor(x);
    const by = Math.floor(y);
    const bz = Math.floor(z);
    const key = this.getKey(bx, by, bz);

    if (!this.worldData.has(key)) return null;

    const type = this.worldData.get(key)!;
    if (type === BLOCKS.BEDROCK) return null; // Unbreakable

    this.worldData.delete(key);
    this.recordEdit(key, BLOCKS.AIR, Math.floor(bx / CHUNK_SIZE), Math.floor(bz / CHUNK_SIZE));
    this.waterLevels.delete(key);
    this.torchPositions.delete(key);
    this.onBlockRemoved?.(bx, by, bz, type);

    const cx = Math.floor(bx / CHUNK_SIZE);
    const cz = Math.floor(bz / CHUNK_SIZE);
    const cKey = this.getChunkKey(cx, cz);

    if (this.chunkData.has(cKey)) {
      const arr = this.chunkData.get(cKey)!;
      const idx = arr.findIndex((b) => b.x === bx && b.y === by && b.z === bz);
      if (idx > -1) arr.splice(idx, 1);
    }

    this.markChunkDirty(cx, cz);
    if (bx % CHUNK_SIZE === 0) this.markChunkDirty(cx - 1, cz);
    if (((bx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE === CHUNK_SIZE - 1) this.markChunkDirty(cx + 1, cz);
    if (bz % CHUNK_SIZE === 0) this.markChunkDirty(cx, cz - 1);
    if (((bz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE === CHUNK_SIZE - 1) this.markChunkDirty(cx, cz + 1);

    if (type === BLOCKS.TORCH) {
      this.removeTorchLight(bx, by, bz);
    }

    if (spawnParticles) {
      this.spawnDebris(bx, by, bz, type);
    }

    // Check if neighbor was water - water will physically flow into this newly carved space!
    const waterNeighbors = [
      [bx, by + 1, bz],
      [bx + 1, by, bz],
      [bx - 1, by, bz],
      [bx, by, bz + 1],
      [bx, by, bz - 1],
    ];
    for (const [nx, ny, nz] of waterNeighbors) {
      if (this.getBlock(nx, ny, nz) === BLOCKS.WATER) {
        this.queueWater(nx, ny, nz, this.waterLevels.get(this.getKey(nx, ny, nz)) ?? 0);
      }
    }

    if (updateMesh) this.updateInstancedMeshes(this.lastPlayerPos);
    return type;
  }

  public getBlock(x: number, y: number, z: number): BlockId | null {
    return this.worldData.get(this.getKey(x, y, z)) || null;
  }

  private addTorchLight(x: number, y: number, z: number) {
    const key = this.getKey(x, y, z);
    if (this.torchLights.has(key) || this.torchLights.size >= MAX_TORCH_LIGHTS || this.lastPlayerPos.distanceToSquared(new THREE.Vector3(x, y, z)) > 24 * 24) return;

    const pLight = new THREE.PointLight(0xffb84d, 1.8, 14);
    pLight.position.set(x + 0.5, y + 0.6, z + 0.5);
    this.scene.add(pLight);
    this.torchLights.set(key, { light: pLight, x, y, z });
  }

  private removeTorchLight(x: number, y: number, z: number) {
    const key = this.getKey(x, y, z);
    const torch = this.torchLights.get(key);
    if (torch) {
      this.scene.remove(torch.light);
      torch.light.dispose();
      this.torchLights.delete(key);
    }
  }

  public syncTorchLights() {
    this.lastLightPos.copy(this.lastPlayerPos);
    const nearest = [...this.torchPositions].filter(([, p]) => p.distanceToSquared(this.lastPlayerPos) <= 24 * 24)
      .sort((a, b) => a[1].distanceToSquared(this.lastPlayerPos) - b[1].distanceToSquared(this.lastPlayerPos)).slice(0, MAX_TORCH_LIGHTS);
    const keep = new Set(nearest.map(([key]) => key));
    for (const [key, t] of this.torchLights) if (!keep.has(key)) this.removeTorchLight(t.x, t.y, t.z);
    for (const [, p] of nearest) this.addTorchLight(p.x, p.y, p.z);
  }

  public queueWater(x: number, y: number, z: number, spread: number) {
    const key = this.getKey(x, y, z);
    if (this.waterQueued.has(key) || this.pendingWaterFlow.length >= MAX_WATER_QUEUE) return;
    this.waterQueued.add(key); this.pendingWaterFlow.push({ x, y, z, spread });
  }
  public updateWaterPhysics(delta: number) {
    this.waterFlowTimer += delta;
    if (this.waterFlowTimer < 0.35 || !this.pendingWaterFlow.length) return;
    this.waterFlowTimer = 0;
    const batch = this.pendingWaterFlow.splice(0, 16);
    let changes = false;
    const flow = (x: number, y: number, z: number, spread: number) => {
      if (this.waterLevels.size >= MAX_FLOWING_WATER || !this.generatedChunks.has(this.getChunkKey(Math.floor(x / 16), Math.floor(z / 16))) || this.getBlock(x, y, z)) return false;
      this.waterLevels.set(this.getKey(x, y, z), spread);
      this.addBlock(x, y, z, BLOCKS.WATER, false); changes = true; return true;
    };
    for (const { x, y, z, spread } of batch) {
      this.waterQueued.delete(this.getKey(x, y, z));
      if (this.getBlock(x, y, z) !== BLOCKS.WATER) continue;
      if (this.getBlock(x, y - 1, z) === BLOCKS.WATER) continue;
      if (y - 1 > BEDROCK_Y && flow(x, y - 1, z, spread)) continue;
      if (spread < 3) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) flow(x + dx, y, z + dz, spread + 1);
    }
    if (changes) this.updateInstancedMeshes(this.lastPlayerPos);
  }

  public primeTnt(x: number, y: number, z: number, remaining = 1.5) {
    if (this.primedTnt.length >= 128) return false;
    this.primedTnt.push({ x, y, z, remaining }); return true;
  }
  public updateTnt(delta: number) {
    for (let i = this.primedTnt.length - 1; i >= 0; i--) {
      const tnt = this.primedTnt[i]; tnt.remaining -= delta;
      if (tnt.remaining > 1e-9) continue;
      // A player can move beyond the fuse location: regenerate edits before exploding.
      this.generateChunk(Math.floor(tnt.x / 16), Math.floor(tnt.z / 16));
      this.primedTnt.splice(i, 1); this.explode(tnt.x, tnt.y, tnt.z, 4);
      this.lastPlayerChunkX = null;
    }
  }

  public updateInstancedMeshes(centerPos?: THREE.Vector3) {
    if (centerPos) {
      this.lastPlayerPos.copy(centerPos);
    }

    const pCx = centerPos
      ? Math.floor(centerPos.x / CHUNK_SIZE)
      : this.lastPlayerChunkX !== null
      ? this.lastPlayerChunkX
      : Math.floor(this.lastPlayerPos.x / CHUNK_SIZE);
    const pCz = centerPos
      ? Math.floor(centerPos.z / CHUNK_SIZE)
      : this.lastPlayerChunkZ !== null
      ? this.lastPlayerChunkZ
      : Math.floor(this.lastPlayerPos.z / CHUNK_SIZE);

    // 1. Precompute render lists only for dirty chunks in range (fast cached meshing)
    for (let cx = pCx - this.renderDistance; cx <= pCx + this.renderDistance; cx++) {
      for (let cz = pCz - this.renderDistance; cz <= pCz + this.renderDistance; cz++) {
        const cKey = this.getChunkKey(cx, cz);
        if (this.dirtyChunks.has(cKey) || !this.chunkRenderData.has(cKey)) {
          this.rebuildChunkRenderData(cx, cz);
        }
      }
    }

    // 2. Ultra fast matrix update using precomputed exposed blocks (zero occlusion checks during loop)
    const counts: Record<number, number> = {};
    for (const key in this.instancedMeshes) {
      counts[parseInt(key)] = 0;
    }

    for (let cx = pCx - this.renderDistance; cx <= pCx + this.renderDistance; cx++) {
      for (let cz = pCz - this.renderDistance; cz <= pCz + this.renderDistance; cz++) {
        const cKey = this.getChunkKey(cx, cz);
        const blocks = this.chunkRenderData.get(cKey);
        if (!blocks) continue;

        for (let i = 0; i < blocks.length; i++) {
          const b = blocks[i];
          const imesh = this.instancedMeshes[b.type];
          if (!imesh) continue;

          const c = counts[b.type];
          if (c >= MAX_INSTANCES_PER_BLOCK) continue;

          this.dummy.position.set(b.x + 0.5, b.y + 0.5, b.z + 0.5);

          // If torch or flower, scale down
          if (b.type === BLOCKS.TORCH) {
            this.dummy.scale.set(0.2, 0.6, 0.2);
            this.dummy.position.y -= 0.2;
          } else if (b.type === BLOCKS.FLOWER) {
            this.dummy.scale.set(0.4, 0.6, 0.4);
            this.dummy.position.y -= 0.2;
          } else {
            this.dummy.scale.set(1, 1, 1);
          }

          this.dummy.updateMatrix();
          imesh.setMatrixAt(c, this.dummy.matrix);
          counts[b.type]++;
        }
      }
    }

    for (const key in this.instancedMeshes) {
      const type = parseInt(key) as BlockId;
      const imesh = this.instancedMeshes[type];
      if (imesh) {
        imesh.count = counts[type] || 0;
        imesh.instanceMatrix.clearUpdateRanges();
        if (imesh.count > 0) {
          imesh.instanceMatrix.addUpdateRange(0, imesh.count * 16);
          imesh.instanceMatrix.needsUpdate = true;
        }
      }
    }
    this.syncTorchLights();
  }

  // Debris on block break
  public spawnDebris(x: number, y: number, z: number, type: BlockId) {
    if (this.debrisList.length + 6 > MAX_DEBRIS) return;
    const geo = new THREE.BoxGeometry(0.18, 0.18, 0.18);
    const def = BLOCK_DEFS[type];
    const tex = this.atlas.textures[def ? def.itemId : 'stone'] || this.atlas.textures['stone'];
    const mat = new THREE.MeshLambertMaterial({ map: tex });

    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        x + 0.5 + (Math.random() - 0.5) * 0.6,
        y + 0.5 + (Math.random() - 0.5) * 0.6,
        z + 0.5 + (Math.random() - 0.5) * 0.6
      );
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 4,
        Math.random() * 3 + 1,
        (Math.random() - 0.5) * 4
      );
      this.scene.add(mesh);
      this.debrisList.push({ mesh, velocity: vel, life: 0.6 + Math.random() * 0.4 });
    }
  }

  public updateDebris(delta: number) {
    for (let i = this.debrisList.length - 1; i >= 0; i--) {
      const d = this.debrisList[i];
      d.velocity.y -= 20 * delta;
      d.mesh.position.addScaledVector(d.velocity, delta);
      d.life -= delta;
      if (d.life <= 0) {
        this.scene.remove(d.mesh);
        this.debrisList.splice(i, 1);
        if (!this.debrisList.some(other => other.mesh.geometry === d.mesh.geometry)) disposeObjects([d.mesh]);
      }
    }
  }

  // Set crack stage (0 to 4), or hide
  public setCrackStage(pos: THREE.Vector3 | null, stage: number) {
    if (!pos || stage < 0 || stage >= this.atlas.crackTextures.length) {
      this.crackMesh.visible = false;
      return;
    }
    this.crackMesh.visible = true;
    this.crackMesh.position.set(Math.floor(pos.x) + 0.5, Math.floor(pos.y) + 0.5, Math.floor(pos.z) + 0.5);
    (this.crackMesh.material as THREE.MeshBasicMaterial).map = this.atlas.crackTextures[stage];
    (this.crackMesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
  }

  // Set highlight wireframe box
  public setTargetHighlight(pos: THREE.Vector3 | null) {
    if (!pos) {
      this.targetBoxMesh.visible = false;
      return;
    }
    this.targetBoxMesh.visible = true;
    this.targetBoxMesh.position.set(Math.floor(pos.x) + 0.5, Math.floor(pos.y) + 0.5, Math.floor(pos.z) + 0.5);
  }

  // Trigger TNT explosion
  public explode(x: number, y: number, z: number, radius = 3.5): BlockId[] {
    sound.playExplosion();
    const destroyed: BlockId[] = [];
    const bx = Math.floor(x);
    const by = Math.floor(y);
    const bz = Math.floor(z);
    const rInt = Math.ceil(radius);

    // Regenerate all affected chunk edges before a remote, saved fuse detonates.
    for (let cx = Math.floor((bx - rInt) / CHUNK_SIZE); cx <= Math.floor((bx + rInt) / CHUNK_SIZE); cx++) {
      for (let cz = Math.floor((bz - rInt) / CHUNK_SIZE); cz <= Math.floor((bz + rInt) / CHUNK_SIZE); cz++) this.generateChunk(cx, cz);
    }

    for (let dx = -rInt; dx <= rInt; dx++) {
      for (let dy = -rInt; dy <= rInt; dy++) {
        for (let dz = -rInt; dz <= rInt; dz++) {
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist <= radius + (Math.random() - 0.5) * 1.5) {
            const tx = bx + dx;
            const ty = by + dy;
            const tz = bz + dz;
            const type = this.getBlock(tx, ty, tz);
            if (type && type !== BLOCKS.BEDROCK) {
              this.removeBlock(tx, ty, tz, true, false);
              destroyed.push(type);
            }
          }
        }
      }
    }
    if (destroyed.length) this.updateInstancedMeshes(this.lastPlayerPos);
    this.lastPlayerChunkX = null;
    return destroyed;
  }

  // Generated terrain is reproducible; only edits (including AIR tombstones) need storage.
  public exportSaveData(): WorldSave {
    return {
      seed: this.seed,
      waterLevels: [...this.waterLevels].map(([key, spread]) => { const [x, y, z] = key.split(',').map(Number); return { x, y, z, spread }; }),
      edits: Array.from(this.blockEdits, ([key, type]) => {
        const [x, y, z] = key.split(',').map(Number);
        return { x, y, z, type };
      }),
    };
  }

  // Call only with a validated snapshot, before generating the restored player's area.
  public importSaveData(data: WorldSave) {
    this.seed = data.seed;
    this.blockEdits.clear(); this.editsByChunk.clear();
    for (const b of data.edits) this.recordEdit(this.getKey(b.x, b.y, b.z), b.type, Math.floor(b.x / 16), Math.floor(b.z / 16));
    this.waterLevels = new Map((data.waterLevels ?? data.edits.filter(b => b.type === BLOCKS.WATER).map(b => ({ ...b, spread: 3 }))).map(b => [this.getKey(b.x, b.y, b.z), b.spread]));
    this.torchPositions.clear(); this.primedTnt = [];
    this.worldData.clear();
    this.chunkData.clear();
    this.generatedChunks.clear();
    this.chunkRenderData.clear();
    this.dirtyChunks.clear();
    this.pendingWaterFlow = []; this.waterQueued.clear();
    this.waterFlowTimer = 0;
    this.lastRenderDistance = -1;
    this.lastPlayerChunkX = null;
    this.lastPlayerChunkZ = null;
    for (const torch of this.torchLights.values()) {
      this.scene.remove(torch.light);
      torch.light.dispose();
    }
    this.torchLights.clear();
    this.setTargetHighlight(null);
    this.setCrackStage(null, -1);
    this.updateInstancedMeshes();
  }

  public dispose() {
    disposeObjects([...Object.values(this.instancedMeshes), this.targetBoxMesh, this.crackMesh, ...this.debrisList.map(d => d.mesh)].filter(Boolean) as THREE.Object3D[]);
    for (const t of this.torchLights.values()) { t.light.removeFromParent(); t.light.dispose(); }
    this.torchLights.clear(); this.torchPositions.clear(); this.debrisList = [];
    this.worldData.clear(); this.chunkData.clear(); this.generatedChunks.clear(); this.chunkRenderData.clear(); this.dirtyChunks.clear();
    this.pendingWaterFlow = []; this.waterQueued.clear(); this.waterLevels.clear(); this.blockEdits.clear(); this.editsByChunk.clear();
  }

  // Fast Voxel Traversal (DDA) for 100% reliable raycasting
  public raycast(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance = 6.0
  ): { blockPos: THREE.Vector3; normal: THREE.Vector3; blockId: BlockId; distance: number } | null {
    const dir = direction.clone().normalize();
    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);

    const stepX = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
    const stepY = dir.y > 0 ? 1 : dir.y < 0 ? -1 : 0;
    const stepZ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;

    const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
    const tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
    const tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;

    const distStartX = stepX > 0 ? x + 1 - origin.x : stepX < 0 ? origin.x - x : Infinity;
    const distStartY = stepY > 0 ? y + 1 - origin.y : stepY < 0 ? origin.y - y : Infinity;
    const distStartZ = stepZ > 0 ? z + 1 - origin.z : stepZ < 0 ? origin.z - z : Infinity;

    let tMaxX = tDeltaX !== Infinity ? distStartX * tDeltaX : Infinity;
    let tMaxY = tDeltaY !== Infinity ? distStartY * tDeltaY : Infinity;
    let tMaxZ = tDeltaZ !== Infinity ? distStartZ * tDeltaZ : Infinity;

    const normal = new THREE.Vector3(0, 1, 0);
    let currentDist = 0;

    while (currentDist <= maxDistance) {
      const block = this.getBlock(x, y, z);
      if (block !== null && block !== BLOCKS.AIR && block !== BLOCKS.WATER) {
        return {
          blockPos: new THREE.Vector3(x, y, z),
          normal: normal.clone(),
          blockId: block,
          distance: currentDist,
        };
      }

      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) {
          currentDist = tMaxX;
          tMaxX += tDeltaX;
          x += stepX;
          normal.set(-stepX, 0, 0);
        } else {
          currentDist = tMaxZ;
          tMaxZ += tDeltaZ;
          z += stepZ;
          normal.set(0, 0, -stepZ);
        }
      } else {
        if (tMaxY < tMaxZ) {
          currentDist = tMaxY;
          tMaxY += tDeltaY;
          y += stepY;
          normal.set(0, -stepY, 0);
        } else {
          currentDist = tMaxZ;
          tMaxZ += tDeltaZ;
          z += stepZ;
          normal.set(0, 0, -stepZ);
        }
      }
    }

    return null;
  }
}
