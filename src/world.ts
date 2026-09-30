import * as THREE from 'three';
import { BLOCKS, BLOCK_DEFS, BlockId } from './blocks';
import { TextureAtlas } from './textures';
import { DebrisParticle, TorchLight } from './types';
import { sound } from './audio';

export const CHUNK_SIZE = 16;
export const MAX_INSTANCES_PER_BLOCK = 40000;
export const BEDROCK_Y = -14;

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

  private dummy = new THREE.Object3D();

  constructor(scene: THREE.Scene, atlas: TextureAtlas) {
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
          const rand = Math.random();
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
          if (Math.random() < 0.015) {
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
            if (Math.random() < treeChance) {
              this.generateTree(gx, surfaceY + 1, gz);
            } else if (Math.random() < 0.04) {
              this.addBlock(gx, surfaceY + 1, gz, BLOCKS.FLOWER, false);
            }
          }
        }
      }
    }
  }

  public generateTree(bx: number, by: number, bz: number) {
    const height = 4 + Math.floor(Math.random() * 2);
    for (let y = 0; y < height; y++) {
      this.addBlock(bx, by + y, bz, BLOCKS.WOOD, false);
    }
    // Leaves canopy
    for (let x = -2; x <= 2; x++) {
      for (let z = -2; z <= 2; z++) {
        for (let y = height - 2; y <= height + 1; y++) {
          if (Math.abs(x) + Math.abs(z) > 3 && y !== height - 1) continue;
          if (x === 0 && z === 0 && y < height) continue;
          this.addBlock(bx + x, by + y, bz + z, BLOCKS.LEAVES, false);
        }
      }
    }
  }

  public updateChunks(playerPos: THREE.Vector3) {
    const pCx = Math.floor(playerPos.x / CHUNK_SIZE);
    const pCz = Math.floor(playerPos.z / CHUNK_SIZE);

    if (pCx === this.lastPlayerChunkX && pCz === this.lastPlayerChunkZ) return;

    for (let cx = pCx - this.renderDistance; cx <= pCx + this.renderDistance; cx++) {
      for (let cz = pCz - this.renderDistance; cz <= pCz + this.renderDistance; cz++) {
        this.generateChunk(cx, cz);
      }
    }

    this.lastPlayerChunkX = pCx;
    this.lastPlayerChunkZ = pCz;
    this.updateInstancedMeshes(playerPos);
  }

  public addBlock(x: number, y: number, z: number, type: BlockId, updateMesh = true) {
    const bx = Math.floor(x);
    const by = Math.floor(y);
    const bz = Math.floor(z);
    const key = this.getKey(bx, by, bz);

    if (this.worldData.has(key)) return;

    this.worldData.set(key, type);

    const cx = Math.floor(bx / CHUNK_SIZE);
    const cz = Math.floor(bz / CHUNK_SIZE);
    const cKey = this.getChunkKey(cx, cz);

    if (!this.chunkData.has(cKey)) {
      this.chunkData.set(cKey, []);
    }
    this.chunkData.get(cKey)!.push({ x: bx, y: by, z: bz, type });

    this.markChunkDirty(cx, cz);
    if (bx % CHUNK_SIZE === 0) this.markChunkDirty(cx - 1, cz);
    if (bx % CHUNK_SIZE === CHUNK_SIZE - 1) this.markChunkDirty(cx + 1, cz);
    if (bz % CHUNK_SIZE === 0) this.markChunkDirty(cx, cz - 1);
    if (bz % CHUNK_SIZE === CHUNK_SIZE - 1) this.markChunkDirty(cx, cz + 1);

    // Handle Torch light
    if (type === BLOCKS.TORCH) {
      this.addTorchLight(bx, by, bz);
    }

    if (updateMesh) {
      this.updateInstancedMeshes(this.lastPlayerPos);
    }

    // If water was placed, queue physical water flow
    if (type === BLOCKS.WATER) {
      this.pendingWaterFlow.push({ x: bx, y: by, z: bz, spread: 0 });
    }
  }

  public removeBlock(x: number, y: number, z: number, spawnParticles = true): BlockId | null {
    const bx = Math.floor(x);
    const by = Math.floor(y);
    const bz = Math.floor(z);
    const key = this.getKey(bx, by, bz);

    if (!this.worldData.has(key)) return null;

    const type = this.worldData.get(key)!;
    if (type === BLOCKS.BEDROCK) return null; // Unbreakable

    this.worldData.delete(key);

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
    if (bx % CHUNK_SIZE === CHUNK_SIZE - 1) this.markChunkDirty(cx + 1, cz);
    if (bz % CHUNK_SIZE === 0) this.markChunkDirty(cx, cz - 1);
    if (bz % CHUNK_SIZE === CHUNK_SIZE - 1) this.markChunkDirty(cx, cz + 1);

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
        this.pendingWaterFlow.push({ x: nx, y: ny, z: nz, spread: 0 });
      }
    }

    this.updateInstancedMeshes(this.lastPlayerPos);
    return type;
  }

  public getBlock(x: number, y: number, z: number): BlockId | null {
    return this.worldData.get(this.getKey(x, y, z)) || null;
  }

  private addTorchLight(x: number, y: number, z: number) {
    const key = this.getKey(x, y, z);
    if (this.torchLights.has(key)) return;

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

  // Physical water cellular automata fluid simulation
  public updateWaterPhysics(delta: number) {
    this.waterFlowTimer += delta;
    if (this.waterFlowTimer < 0.35 || this.pendingWaterFlow.length === 0) return;
    this.waterFlowTimer = 0;

    let changes = 0;
    const nextQueue: Array<{ x: number; y: number; z: number; spread: number }> = [];
    const limit = Math.min(this.pendingWaterFlow.length, 16);

    for (let i = 0; i < limit; i++) {
      const item = this.pendingWaterFlow.shift();
      if (!item) break;
      const { x, y, z, spread } = item;
      if (this.getBlock(x, y, z) !== BLOCKS.WATER) continue;

      // 1. Flow down with gravity if air or empty beneath
      const belowY = y - 1;
      if (belowY > BEDROCK_Y) {
        const belowBlock = this.getBlock(x, belowY, z);
        if (belowBlock === null || belowBlock === BLOCKS.AIR) {
          this.addBlock(x, belowY, z, BLOCKS.WATER, false);
          nextQueue.push({ x, y: belowY, z, spread: 0 });
          changes++;
          continue;
        }
      }

      // 2. Spread laterally if bottom is blocked and spread distance not exceeded
      if (spread < 3) {
        const sides = [
          [x + 1, y, z],
          [x - 1, y, z],
          [x, y, z + 1],
          [x, y, z - 1],
        ];
        for (const [sx, sy, sz] of sides) {
          const sBlock = this.getBlock(sx, sy, sz);
          if (sBlock === null || sBlock === BLOCKS.AIR) {
            this.addBlock(sx, sy, sz, BLOCKS.WATER, false);
            nextQueue.push({ x, y: sy, z: sz, spread: spread + 1 });
            changes++;
          }
        }
      }
    }

    if (nextQueue.length > 0) {
      this.pendingWaterFlow.push(...nextQueue);
    }

    if (changes > 0) {
      this.updateInstancedMeshes(this.lastPlayerPos);
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
        imesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  // Debris on block break
  public spawnDebris(x: number, y: number, z: number, type: BlockId) {
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
        d.mesh.geometry.dispose();
        this.debrisList.splice(i, 1);
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
              this.removeBlock(tx, ty, tz, true);
              destroyed.push(type);
            }
          }
        }
      }
    }
    return destroyed;
  }

  // Serialization for Save & Load
  public exportSaveData() {
    const blocks: { x: number; y: number; z: number; type: BlockId }[] = [];
    for (const [key, type] of this.worldData.entries()) {
      const [x, y, z] = key.split(',').map(Number);
      blocks.push({ x, y, z, type });
    }
    return {
      version: 1,
      blocks,
    };
  }

  public importSaveData(data: { blocks: { x: number; y: number; z: number; type: BlockId }[] }) {
    // Clear current
    this.worldData.clear();
    this.chunkData.clear();
    this.generatedChunks.clear();
    for (const torch of this.torchLights.values()) {
      this.scene.remove(torch.light);
      torch.light.dispose();
    }
    this.torchLights.clear();

    for (const b of data.blocks) {
      this.addBlock(b.x, b.y, b.z, b.type, false);
    }
    this.updateInstancedMeshes();
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
