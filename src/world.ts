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

  public renderDistance = 2; // in chunks
  public lastPlayerChunkX: number | null = null;
  public lastPlayerChunkZ: number | null = null;

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

  private initInstancedMeshes() {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const { textures } = this.atlas;

    // Helper to make material
    const makeMat = (texKey: string, transparent = false, opacity = 1.0, emissive = false) => {
      const tex = textures[texKey];
      return new THREE.MeshLambertMaterial({
        map: tex,
        transparent,
        opacity,
        alphaTest: transparent && opacity === 1.0 ? 0.4 : 0,
        emissive: emissive ? new THREE.Color(0xffaa44) : new THREE.Color(0x000000),
        emissiveMap: emissive ? tex : null,
      });
    };

    // Build materials for each block
    const blockMaterials: Record<number, THREE.Material | THREE.Material[]> = {
      [BLOCKS.GRASS]: [
        makeMat('grass_side'),
        makeMat('grass_side'),
        makeMat('grass_top'),
        makeMat('dirt'),
        makeMat('grass_side'),
        makeMat('grass_side'),
      ],
      [BLOCKS.DIRT]: makeMat('dirt'),
      [BLOCKS.STONE]: makeMat('stone'),
      [BLOCKS.COBBLESTONE]: makeMat('cobblestone'),
      [BLOCKS.WOOD]: [
        makeMat('wood_side'),
        makeMat('wood_side'),
        makeMat('wood_top'),
        makeMat('wood_top'),
        makeMat('wood_side'),
        makeMat('wood_side'),
      ],
      [BLOCKS.LEAVES]: makeMat('leaves', true),
      [BLOCKS.PLANKS]: makeMat('planks'),
      [BLOCKS.SAND]: makeMat('sand'),
      [BLOCKS.GLASS]: makeMat('glass', true, 0.4),
      [BLOCKS.BRICK]: makeMat('brick'),
      [BLOCKS.BOOKSHELF]: [
        makeMat('bookshelf'),
        makeMat('bookshelf'),
        makeMat('planks'),
        makeMat('planks'),
        makeMat('bookshelf'),
        makeMat('bookshelf'),
      ],
      [BLOCKS.COAL_ORE]: makeMat('coal_ore'),
      [BLOCKS.IRON_ORE]: makeMat('iron_ore'),
      [BLOCKS.GOLD_ORE]: makeMat('gold_ore'),
      [BLOCKS.DIAMOND_ORE]: makeMat('diamond_ore'),
      [BLOCKS.CRAFTING_TABLE]: [
        makeMat('crafting_table_side'),
        makeMat('crafting_table_side'),
        makeMat('crafting_table_top'),
        makeMat('planks'),
        makeMat('crafting_table_side'),
        makeMat('crafting_table_side'),
      ],
      [BLOCKS.FURNACE]: [
        makeMat('furnace_side'),
        makeMat('furnace_side'),
        makeMat('furnace_top'),
        makeMat('furnace_top'),
        makeMat('furnace_front'),
        makeMat('furnace_side'),
      ],
      [BLOCKS.CHEST]: [
        makeMat('chest_side'),
        makeMat('chest_side'),
        makeMat('chest_top'),
        makeMat('chest_top'),
        makeMat('chest_front'),
        makeMat('chest_side'),
      ],
      [BLOCKS.TNT]: [
        makeMat('tnt_side'),
        makeMat('tnt_side'),
        makeMat('tnt_top'),
        makeMat('dirt'),
        makeMat('tnt_side'),
        makeMat('tnt_side'),
      ],
      [BLOCKS.BED]: makeMat('bed'),
      [BLOCKS.REDSTONE]: makeMat('redstone', false, 1.0, true),
      [BLOCKS.BEDROCK]: makeMat('stone'),
      [BLOCKS.WATER]: makeMat('water', true, 0.65),
      [BLOCKS.TORCH]: makeMat('torch', true, 1.0, true),
      [BLOCKS.FLOWER]: makeMat('flower', true),
    };

    // Instantiate InstancedMesh for each block type
    for (const key in blockMaterials) {
      const type = parseInt(key) as BlockId;
      const mat = blockMaterials[type];
      const imesh = new THREE.InstancedMesh(geo, mat, MAX_INSTANCES_PER_BLOCK);
      imesh.castShadow = type !== BLOCKS.GLASS && type !== BLOCKS.WATER && type !== BLOCKS.TORCH;
      imesh.receiveShadow = type !== BLOCKS.GLASS && type !== BLOCKS.WATER;
      imesh.count = 0;
      this.scene.add(imesh);
      this.instancedMeshes[type] = imesh;
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

    // Handle Torch light
    if (type === BLOCKS.TORCH) {
      this.addTorchLight(bx, by, bz);
    }

    if (updateMesh) {
      this.updateInstancedMeshes();
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

    if (type === BLOCKS.TORCH) {
      this.removeTorchLight(bx, by, bz);
    }

    if (spawnParticles) {
      this.spawnDebris(bx, by, bz, type);
    }

    this.updateInstancedMeshes();
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

  public updateInstancedMeshes(centerPos?: THREE.Vector3) {
    const counts: Record<number, number> = {};
    for (const key in this.instancedMeshes) {
      counts[parseInt(key)] = 0;
    }

    const pCx = centerPos ? Math.floor(centerPos.x / CHUNK_SIZE) : this.lastPlayerChunkX || 0;
    const pCz = centerPos ? Math.floor(centerPos.z / CHUNK_SIZE) : this.lastPlayerChunkZ || 0;

    for (let cx = pCx - this.renderDistance; cx <= pCx + this.renderDistance; cx++) {
      for (let cz = pCz - this.renderDistance; cz <= pCz + this.renderDistance; cz++) {
        const cKey = this.getChunkKey(cx, cz);
        const blocks = this.chunkData.get(cKey);
        if (!blocks) continue;

        for (const b of blocks) {
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
}
