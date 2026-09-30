import * as THREE from 'three';
import { MobEntity, ArrowEntity } from './types';
import { VoxelWorld, BEDROCK_Y } from './world';
import { sound } from './audio';

export interface DroppedItemEntity {
  mesh: THREE.Group;
  itemId: string;
  count: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
}

export class MobManager {
  public scene: THREE.Scene;
  public world: VoxelWorld;
  public mobs: MobEntity[] = [];
  public arrows: ArrowEntity[] = [];
  public droppedItems: DroppedItemEntity[] = [];
  private nextId = 1;

  constructor(scene: THREE.Scene, world: VoxelWorld) {
    this.scene = scene;
    this.world = world;
  }

  // Helper to build voxel mob models
  private createMobMesh(type: MobEntity['type']): THREE.Group {
    const group = new THREE.Group();

    if (type === 'pig') {
      const pinkMat = new THREE.MeshLambertMaterial({ color: 0xf5a5b5 });
      const darkPinkMat = new THREE.MeshLambertMaterial({ color: 0xdb7b8e });

      // Body
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 1.2), pinkMat);
      body.position.y = 0.5;
      group.add(body);

      // Head
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), pinkMat);
      head.position.set(0, 0.7, 0.7);
      group.add(head);

      // Snout
      const snout = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.2), darkPinkMat);
      snout.position.set(0, 0.6, 1.05);
      group.add(snout);

      // 4 Legs
      for (let x of [-0.3, 0.3]) {
        for (let z of [-0.4, 0.4]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.4, 0.25), darkPinkMat);
          leg.position.set(x, 0.2, z);
          group.add(leg);
        }
      }
    } else if (type === 'cow') {
      const cowMat = new THREE.MeshLambertMaterial({ color: 0x4a3728 });
      const whiteMat = new THREE.MeshLambertMaterial({ color: 0xeeeeee });

      // Body
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.8, 1.4), cowMat);
      body.position.y = 0.7;
      group.add(body);

      // White patches
      const patch = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.5, 0.6), whiteMat);
      patch.position.set(0, 0.7, 0.1);
      group.add(patch);

      // Head
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.6), cowMat);
      head.position.set(0, 1.0, 0.8);
      group.add(head);

      // Horns
      for (let x of [-0.35, 0.35]) {
        const horn = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.25, 0.12), whiteMat);
        horn.position.set(x, 1.4, 0.7);
        group.add(horn);
      }

      // 4 Legs
      for (let x of [-0.35, 0.35]) {
        for (let z of [-0.5, 0.5]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.6, 0.25), cowMat);
          leg.position.set(x, 0.3, z);
          group.add(leg);
        }
      }
    } else if (type === 'sheep') {
      const woolMat = new THREE.MeshLambertMaterial({ color: 0xf5f5f0 });
      const skinMat = new THREE.MeshLambertMaterial({ color: 0xd4b895 });

      // Body
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 1.3), woolMat);
      body.position.y = 0.7;
      group.add(body);

      // Head
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.6), skinMat);
      head.position.set(0, 0.9, 0.8);
      group.add(head);

      // 4 Legs
      for (let x of [-0.35, 0.35]) {
        for (let z of [-0.4, 0.4]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.5, 0.22), skinMat);
          leg.position.set(x, 0.25, z);
          group.add(leg);
        }
      }
    } else if (type === 'zombie') {
      const skinMat = new THREE.MeshLambertMaterial({ color: 0x4a853b }); // Green
      const shirtMat = new THREE.MeshLambertMaterial({ color: 0x2266aa }); // Cyan
      const pantsMat = new THREE.MeshLambertMaterial({ color: 0x332266 }); // Indigo

      // Head
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), skinMat);
      head.position.set(0, 1.6, 0);
      group.add(head);

      // Torso
      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.35), shirtMat);
      torso.position.set(0, 1.0, 0);
      group.add(torso);

      // Arms outstretched forward!
      for (let x of [-0.42, 0.42]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.65), skinMat);
        arm.position.set(x, 1.15, 0.35);
        group.add(arm);
      }

      // Legs
      for (let x of [-0.18, 0.18]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.7, 0.25), pantsMat);
        leg.position.set(x, 0.35, 0);
        group.add(leg);
      }
    } else if (type === 'creeper') {
      const greenMat = new THREE.MeshLambertMaterial({ color: 0x3aa03a });
      const darkGreenMat = new THREE.MeshLambertMaterial({ color: 0x1f5c1f });

      // Head
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), greenMat);
      head.position.set(0, 1.4, 0);
      group.add(head);

      // Creeper Face (eyes & mouth)
      const faceMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
      const leftEye = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.05), faceMat);
      leftEye.position.set(-0.15, 1.45, 0.28);
      group.add(leftEye);
      const rightEye = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.05), faceMat);
      rightEye.position.set(0.15, 1.45, 0.28);
      group.add(rightEye);
      const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.22, 0.05), faceMat);
      mouth.position.set(0, 1.25, 0.28);
      group.add(mouth);

      // Body
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.3), darkGreenMat);
      body.position.set(0, 0.75, 0);
      group.add(body);

      // 4 stubby feet
      for (let x of [-0.2, 0.2]) {
        for (let z of [-0.2, 0.2]) {
          const foot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.35, 0.22), greenMat);
          foot.position.set(x, 0.18, z);
          group.add(foot);
        }
      }
    } else if (type === 'skeleton') {
      const boneMat = new THREE.MeshLambertMaterial({ color: 0xdcdcdc });
      const darkMat = new THREE.MeshBasicMaterial({ color: 0x222222 });

      // Head
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), boneMat);
      head.position.set(0, 1.6, 0);
      group.add(head);

      // Eye sockets
      const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.05), darkMat);
      eyeL.position.set(-0.12, 1.62, 0.26);
      group.add(eyeL);
      const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.05), darkMat);
      eyeR.position.set(0.12, 1.62, 0.26);
      group.add(eyeR);

      // Ribcage
      const ribs = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.65, 0.25), boneMat);
      ribs.position.set(0, 1.05, 0);
      group.add(ribs);

      // Arms
      for (let x of [-0.32, 0.32]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.65, 0.15), boneMat);
        arm.position.set(x, 1.05, 0);
        group.add(arm);
      }

      // Legs
      for (let x of [-0.15, 0.15]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.7, 0.15), boneMat);
        leg.position.set(x, 0.35, 0);
        group.add(leg);
      }
    } else {
      // Spider
      const darkMat = new THREE.MeshLambertMaterial({ color: 0x221a15 });
      const redMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });

      // Body & Abdomen
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.4), darkMat);
      head.position.set(0, 0.35, 0.4);
      group.add(head);

      const abdomen = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.8), darkMat);
      abdomen.position.set(0, 0.45, -0.4);
      group.add(abdomen);

      // Glowing red eyes
      const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.05), redMat);
      eyeL.position.set(-0.12, 0.4, 0.61);
      group.add(eyeL);
      const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.05), redMat);
      eyeR.position.set(0.12, 0.4, 0.61);
      group.add(eyeR);

      // Legs
      for (let i = 0; i < 4; i++) {
        const zPos = 0.3 - i * 0.25;
        for (let side of [-1, 1]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.1), darkMat);
          leg.position.set(side * 0.55, 0.25, zPos);
          leg.rotation.z = side * 0.4;
          group.add(leg);
        }
      }
    }

    group.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    return group;
  }

  public spawnMob(type: MobEntity['type'], x: number, y: number, z: number): MobEntity {
    const mesh = this.createMobMesh(type);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);

    const isHostile = type === 'zombie' || type === 'creeper' || type === 'skeleton' || type === 'spider';
    const hp = type === 'creeper' ? 8 : type === 'zombie' ? 12 : type === 'skeleton' ? 10 : type === 'spider' ? 8 : 6;
    const speed = type === 'spider' ? 4.5 : isHostile ? 3.2 : 2.0;

    const mob: MobEntity = {
      id: this.nextId++,
      type,
      name:
        type === 'pig'
          ? 'ブタ'
          : type === 'cow'
          ? 'ウシ'
          : type === 'sheep'
          ? 'ヒツジ'
          : type === 'zombie'
          ? 'ゾンビ'
          : type === 'creeper'
          ? 'クリーパー'
          : type === 'skeleton'
          ? 'スケルトン'
          : 'クモ',
      mesh,
      position: mesh.position,
      velocity: new THREE.Vector3(),
      rotation: Math.random() * Math.PI * 2,
      hp,
      maxHp: hp,
      isHostile,
      speed,
      attackCooldown: 0,
      exploding: false,
      fuseTime: 0,
      hurtTimer: 0,
    };

    this.mobs.push(mob);
    return mob;
  }

  public hurtMob(mob: MobEntity, damage: number, knockbackDir?: THREE.Vector3): boolean {
    mob.hp -= damage;
    mob.hurtTimer = 0.25;
    sound.playHurt(true);

    // Red damage flash
    mob.mesh.traverse((c: THREE.Object3D) => {
      const mesh = c as THREE.Mesh;
      if (mesh.isMesh && (mesh.material as THREE.MeshLambertMaterial).color) {
        (mesh.material as THREE.MeshLambertMaterial).color.setHex(0xff3333);
      }
    });

    if (knockbackDir) {
      mob.velocity.add(knockbackDir.clone().normalize().multiplyScalar(5));
      mob.velocity.y = 4.5;
    }

    if (mob.hp <= 0) {
      this.killMob(mob);
      return true;
    }
    return false;
  }

  public killMob(mob: MobEntity) {
    this.scene.remove(mob.mesh);
    const idx = this.mobs.indexOf(mob);
    if (idx > -1) this.mobs.splice(idx, 1);

    // Drops
    if (mob.type === 'pig') {
      this.spawnDroppedItem('raw_meat', 1 + Math.floor(Math.random() * 2), mob.position);
    } else if (mob.type === 'cow') {
      this.spawnDroppedItem('raw_meat', 1 + Math.floor(Math.random() * 2), mob.position);
    } else if (mob.type === 'sheep') {
      this.spawnDroppedItem('raw_meat', 1, mob.position);
    } else if (mob.type === 'zombie') {
      if (Math.random() < 0.25) this.spawnDroppedItem('iron_ingot', 1, mob.position);
      else this.spawnDroppedItem('coal', 1, mob.position);
    } else if (mob.type === 'skeleton') {
      this.spawnDroppedItem('arrow', 2 + Math.floor(Math.random() * 3), mob.position);
      this.spawnDroppedItem('stick', 1, mob.position);
    } else if (mob.type === 'spider') {
      this.spawnDroppedItem('stick', 2, mob.position);
    }
  }

  public shootArrow(from: THREE.Vector3, dir: THREE.Vector3, fromPlayer: boolean, speed = 18): ArrowEntity {
    sound.playShootBow();

    const geo = new THREE.CylinderGeometry(0.04, 0.04, 0.6, 5);
    const mat = new THREE.MeshLambertMaterial({ color: 0x8a6a4a });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    this.scene.add(mesh);

    const arrow: ArrowEntity = {
      mesh,
      position: mesh.position,
      velocity: dir.clone().normalize().multiplyScalar(speed),
      fromPlayer,
      life: 6.0,
    };
    this.arrows.push(arrow);
    return arrow;
  }

  public spawnDroppedItem(itemId: string, count: number, pos: THREE.Vector3) {
    const group = new THREE.Group();
    const geo = new THREE.BoxGeometry(0.35, 0.35, 0.35);
    const tex = this.world.atlas.textures[itemId] || this.world.atlas.textures['stone'];
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);
    group.position.set(pos.x, pos.y + 0.3, pos.z);
    this.scene.add(group);

    const entity: DroppedItemEntity = {
      mesh: group,
      itemId,
      count,
      position: group.position,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 2, 3, (Math.random() - 0.5) * 2),
      life: 180, // 3 minutes
    };
    this.droppedItems.push(entity);
  }

  public update(
    delta: number,
    playerPos: THREE.Vector3,
    onPlayerDamage: (dmg: number, mobType: string) => void,
    onPickupItem: (itemId: string, count: number) => boolean,
    isNight: boolean
  ) {
    // 1. Update Mobs
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const mob = this.mobs[i];

      // Reset hurt flash
      if (mob.hurtTimer && mob.hurtTimer > 0) {
        mob.hurtTimer -= delta;
        if (mob.hurtTimer <= 0) {
          // Re-color back to default
          // Rebuild materials or simple re-set
        }
      }

      // Hostile day burning (Zombie burns in daytime)
      if (!isNight && mob.type === 'zombie' && mob.position.y > 0) {
        this.hurtMob(mob, delta * 3);
        this.world.spawnDebris(mob.position.x, mob.position.y + 1, mob.position.z, 21); // Flame-like particles
      }

      // Physics (Gravity & drag)
      mob.velocity.y -= 25 * delta;
      mob.velocity.x *= 0.88;
      mob.velocity.z *= 0.88;

      const distToPlayer = mob.position.distanceTo(playerPos);

      // AI Behavior
      if (mob.isHostile && distToPlayer < 18) {
        // Look at player
        const toPlayer = playerPos.clone().sub(mob.position);
        toPlayer.y = 0;
        mob.rotation = Math.atan2(toPlayer.x, toPlayer.z);

        if (mob.type === 'creeper') {
          // Sneak up and explode
          if (distToPlayer > 2.0) {
            mob.velocity.x += toPlayer.normalize().x * mob.speed * delta * 8;
            mob.velocity.z += toPlayer.z * mob.speed * delta * 8;
            mob.exploding = false;
          } else {
            // Near player: begin countdown
            if (!mob.exploding) {
              mob.exploding = true;
              mob.fuseTime = 1.3;
              sound.playCreeperHiss();
            } else if (mob.fuseTime !== undefined) {
              mob.fuseTime -= delta;
              // Swell up
              const scale = 1.0 + (1.3 - mob.fuseTime) * 0.4;
              mob.mesh.scale.set(scale, scale, scale);

              if (mob.fuseTime <= 0) {
                // BOOM!
                this.world.explode(mob.position.x, mob.position.y + 1, mob.position.z, 3.8);
                if (distToPlayer < 5) {
                  onPlayerDamage(Math.floor((5 - distToPlayer) * 3) + 4, 'creeper');
                }
                this.scene.remove(mob.mesh);
                this.mobs.splice(i, 1);
                continue;
              }
            }
          }
        } else if (mob.type === 'skeleton') {
          // Keep 6 to 9 blocks distance and shoot arrows
          if (distToPlayer < 6) {
            // Back away
            mob.velocity.x -= toPlayer.normalize().x * mob.speed * delta * 6;
            mob.velocity.z -= toPlayer.z * mob.speed * delta * 6;
          } else if (distToPlayer > 10) {
            mob.velocity.x += toPlayer.normalize().x * mob.speed * delta * 6;
            mob.velocity.z += toPlayer.z * mob.speed * delta * 6;
          }

          mob.attackCooldown -= delta;
          if (mob.attackCooldown <= 0 && distToPlayer < 14) {
            mob.attackCooldown = 2.4;
            const shootDir = playerPos.clone().sub(mob.position).normalize();
            shootDir.y += 0.08; // Slight arc
            this.shootArrow(mob.position.clone().add(new THREE.Vector3(0, 1.2, 0)), shootDir, false, 14);
          }
        } else {
          // Zombie or Spider: Melee charge
          mob.velocity.x += toPlayer.normalize().x * mob.speed * delta * 8;
          mob.velocity.z += toPlayer.z * mob.speed * delta * 8;

          // Spider pounce jump
          if (mob.type === 'spider' && Math.random() < 0.03 && mob.velocity.y === 0) {
            mob.velocity.y = 8;
          }

          // Melee attack player
          if (distToPlayer < 1.6) {
            mob.attackCooldown -= delta;
            if (mob.attackCooldown <= 0) {
              mob.attackCooldown = 1.0;
              const dmg = mob.type === 'spider' ? 2 : 3;
              onPlayerDamage(dmg, mob.name);
            }
          }
        }
      } else {
        // Peaceful wandering
        if (Math.random() < 0.02) {
          mob.rotation += (Math.random() - 0.5) * 1.5;
        }
        if (Math.random() < 0.04) {
          const forward = new THREE.Vector3(Math.sin(mob.rotation), 0, Math.cos(mob.rotation));
          mob.velocity.x += forward.x * mob.speed * delta * 4;
          mob.velocity.z += forward.z * mob.speed * delta * 4;
        }
      }

      mob.mesh.rotation.y = mob.rotation;

      // Apply movement with voxel block collision
      const checkBlock = (p: THREE.Vector3) => this.world.getBlock(p.x, p.y, p.z);

      mob.position.x += mob.velocity.x * delta;
      if (checkBlock(new THREE.Vector3(mob.position.x, mob.position.y + 0.5, mob.position.z))) {
        mob.position.x -= mob.velocity.x * delta;
        // Try stepping up 1 block (auto jump)
        if (!checkBlock(new THREE.Vector3(mob.position.x, mob.position.y + 1.5, mob.position.z))) {
          mob.velocity.y = 6.5;
        }
      }

      mob.position.z += mob.velocity.z * delta;
      if (checkBlock(new THREE.Vector3(mob.position.x, mob.position.y + 0.5, mob.position.z))) {
        mob.position.z -= mob.velocity.z * delta;
        if (!checkBlock(new THREE.Vector3(mob.position.x, mob.position.y + 1.5, mob.position.z))) {
          mob.velocity.y = 6.5;
        }
      }

      mob.position.y += mob.velocity.y * delta;
      if (checkBlock(new THREE.Vector3(mob.position.x, mob.position.y, mob.position.z))) {
        mob.position.y = Math.floor(mob.position.y) + 1;
        mob.velocity.y = 0;
      }
    }

    // 2. Update Arrows
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const arrow = this.arrows[i];
      arrow.velocity.y -= 12 * delta; // Gravity arc
      arrow.position.addScaledVector(arrow.velocity, delta);
      arrow.life -= delta;

      // Align arrow mesh with flight trajectory
      arrow.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), arrow.velocity.clone().normalize());

      // Check hit block
      if (this.world.getBlock(arrow.position.x, arrow.position.y, arrow.position.z)) {
        this.scene.remove(arrow.mesh);
        this.arrows.splice(i, 1);
        continue;
      }

      // Check hit mob (if player arrow)
      if (arrow.fromPlayer) {
        for (const mob of this.mobs) {
          if (arrow.position.distanceTo(mob.position) < 1.3) {
            this.hurtMob(mob, 5, arrow.velocity);
            this.scene.remove(arrow.mesh);
            this.arrows.splice(i, 1);
            break;
          }
        }
      } else {
        // Skeleton arrow hit player
        if (arrow.position.distanceTo(playerPos) < 1.0) {
          onPlayerDamage(2, 'スケルトンの矢');
          this.scene.remove(arrow.mesh);
          this.arrows.splice(i, 1);
          continue;
        }
      }

      if (arrow.life <= 0) {
        this.scene.remove(arrow.mesh);
        this.arrows.splice(i, 1);
      }
    }

    // 3. Update Dropped Items (rotation, float, player attraction)
    for (let i = this.droppedItems.length - 1; i >= 0; i--) {
      const drop = this.droppedItems[i];
      drop.mesh.rotation.y += 2.0 * delta;
      drop.life -= delta;

      // Gravity
      drop.velocity.y -= 18 * delta;
      drop.position.y += drop.velocity.y * delta;
      if (this.world.getBlock(drop.position.x, drop.position.y, drop.position.z)) {
        drop.position.y = Math.floor(drop.position.y) + 1;
        drop.velocity.y = 0;
      }

      const dist = drop.position.distanceTo(playerPos);
      // Magnet attraction when within 3.5m
      if (dist < 3.5) {
        const pull = playerPos.clone().sub(drop.position).normalize().multiplyScalar(6 * delta);
        drop.position.add(pull);
      }

      // Pickup
      if (dist < 1.3) {
        const picked = onPickupItem(drop.itemId, drop.count);
        if (picked) {
          sound.playPickup();
          this.scene.remove(drop.mesh);
          this.droppedItems.splice(i, 1);
          continue;
        }
      }

      if (drop.life <= 0) {
        this.scene.remove(drop.mesh);
        this.droppedItems.splice(i, 1);
      }
    }
  }

  // Despawn distant mobs and spawn new ones nearby
  public handleSpawning(playerPos: THREE.Vector3, isNight: boolean, peaceful: boolean) {
    if (this.mobs.length > 25) return;

    // Spawn chance
    if (Math.random() < 0.05) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 18 + Math.random() * 12;
      const sx = Math.floor(playerPos.x + Math.cos(angle) * radius);
      const sz = Math.floor(playerPos.z + Math.sin(angle) * radius);
      const { height: sy } = this.world.getTerrainHeight(sx, sz);

      if (sy > BEDROCK_Y && sy < 25) {
        if (isNight && !peaceful) {
          // Monsters at night
          const monsters: MobEntity['type'][] = ['zombie', 'creeper', 'skeleton', 'spider'];
          const type = monsters[Math.floor(Math.random() * monsters.length)];
          this.spawnMob(type, sx, sy + 1, sz);
        } else {
          // Peaceful animals during day
          const animals: MobEntity['type'][] = ['pig', 'cow', 'sheep'];
          const type = animals[Math.floor(Math.random() * animals.length)];
          this.spawnMob(type, sx, sy + 1, sz);
        }
      }
    }
  }
}
