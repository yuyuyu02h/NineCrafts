import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { BLOCKS, BLOCK_DEFS, BlockId, ITEMS } from './blocks';
import { buildGameTextures, TextureAtlas } from './textures';
import { VoxelWorld, BEDROCK_Y } from './world';
import { MobManager } from './mobs';
import { sound } from './audio';
import { InventorySlot, GameMode, Achievement } from './types';
import { CRAFTING_RECIPES, SMELTING_RECIPES, matchRecipe } from './recipes';
import { ShaderEnvironment } from './environment';
import {
  Volume2,
  VolumeX,
  Settings,
  HelpCircle,
  Save,
  Download,
  Upload,
  RotateCcw,
  Sparkles,
  Flame,
  X,
  Compass,
  Zap,
} from 'lucide-react';

const INITIAL_ACHIEVEMENTS: Achievement[] = [
  { id: 'wood', title: '最初の木材', description: '原木を破壊して木材を手に入れる', icon: '🪵', unlocked: false },
  { id: 'workbench', title: '作業場づくり', description: '作業台をクラフトする', icon: '🛠️', unlocked: false },
  { id: 'pickaxe', title: '採掘の夜明け', description: 'ツルハシを作って石を採掘する', icon: '⛏️', unlocked: false },
  { id: 'furnace', title: '高熱精錬', description: 'かまどを作って鉄や肉を焼く', icon: '🔥', unlocked: false },
  { id: 'iron', title: '鉄器時代', description: '鉄インゴットを入手する', icon: '⚔️', unlocked: false },
  { id: 'hunter', title: 'モンスターハンター', description: '夜の魔物を撃破する', icon: '🏹', unlocked: false },
  { id: 'tnt', title: '大爆破', description: 'TNTを着火して爆発させる', icon: '💥', unlocked: false },
  { id: 'bed', title: '良い夢を', description: 'ベッドで眠り朝を迎える', icon: '🛏️', unlocked: false },
];

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Game UI States
  const [isLocked, setIsLocked] = useState(false);
  const [gameMode, setGameMode] = useState<GameMode>('survival');
  const [activeSlot, setActiveSlot] = useState(0); // 0 - 8
  const [health, setHealth] = useState(20); // 0 - 20 (10 hearts)
  const [hunger, setHunger] = useState(20); // 0 - 20 (10 drumsticks)
  const [oxygen, setOxygen] = useState(10); // 0 - 10 (10 bubbles underwater)
  const [isUnderwater, setIsUnderwater] = useState(false);
  const [timeString, setTimeString] = useState('12:00');
  const [lumenPercent, setLumenPercent] = useState(100);
  const [coords, setCoords] = useState({ x: 0, y: 10, z: 0, biome: 'plains' });
  const [targetBlockName, setTargetBlockName] = useState<string | null>(null);

  // Active Screen Menus: null | 'inventory' | 'workbench' | 'furnace' | 'chest' | 'settings' | 'help'
  const [openModal, setOpenModal] = useState<string | null>(null);

  // Water physics timers & tracking
  const wasInWaterRef = useRef(false);
  const swimSoundTimerRef = useRef(0);
  const drownTimerRef = useRef(0);

  // Furnace State
  const [furnaceInput, setFurnaceInput] = useState<InventorySlot>({ itemId: null, count: 0 });
  const [furnaceFuel, setFurnaceFuel] = useState<InventorySlot>({ itemId: null, count: 0 });
  const [furnaceOutput, setFurnaceOutput] = useState<InventorySlot>({ itemId: null, count: 0 });
  const [furnaceProgress, setFurnaceProgress] = useState(0); // 0 to 100
  const [furnaceFuelTime, setFurnaceFuelTime] = useState(0);

  // Chest State (27 slots)
  const [chestSlots, setChestSlots] = useState<InventorySlot[]>(
    () => Array.from({ length: 27 }, () => ({ itemId: null, count: 0 }))
  );

  // Settings
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [fov, setFov] = useState(75);
  const [renderDist, setRenderDist] = useState(2);
  const [peaceful, setPeaceful] = useState(false);

  // Toast / Achievement notification
  const [toastMessage, setToastMessage] = useState<{ title: string; desc: string; icon: string } | null>(null);
  const [achievements, setAchievements] = useState<Achievement[]>(INITIAL_ACHIEVEMENTS);

  // Inventory: 9 hotbar slots + 27 backpack slots = 36 slots
  const [inventory, setInventory] = useState<InventorySlot[]>(() => {
    const slots: InventorySlot[] = Array.from({ length: 36 }, () => ({ itemId: null, count: 0 }));
    // Starter items: Wood, Planks, Water Bucket, Torches, Apples
    slots[0] = { itemId: 'wood', count: 16 };
    slots[1] = { itemId: 'planks', count: 32 };
    slots[2] = { itemId: 'water_bucket', count: 1 };
    slots[3] = { itemId: 'torch', count: 16 };
    slots[4] = { itemId: 'apple', count: 8 };
    return slots;
  });

  // 2x2 Crafting Grid (for player inventory)
  const [craft2x2, setCraft2x2] = useState<(string | null)[][]>([
    [null, null],
    [null, null],
  ]);
  const [craft2x2Result, setCraft2x2Result] = useState<{ itemId: string; count: number } | null>(null);

  // 3x3 Crafting Grid (for workbench)
  const [craft3x3, setCraft3x3] = useState<(string | null)[][]>([
    [null, null, null],
    [null, null, null],
    [null, null, null],
  ]);
  const [craft3x3Result, setCraft3x3Result] = useState<{ itemId: string; count: number } | null>(null);

  // Dragging / Selected Cursor Item
  const [cursorItem, setCursorItem] = useState<InventorySlot | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Synchronized refs for event handlers (avoids stale closures during PointerLock)
  const activeSlotRef = useRef(activeSlot);
  activeSlotRef.current = activeSlot;
  const inventoryRef = useRef(inventory);
  inventoryRef.current = inventory;
  const gameModeRef = useRef(gameMode);
  gameModeRef.current = gameMode;
  const openModalRef = useRef(openModal);
  openModalRef.current = openModal;
  const cursorItemRef = useRef(cursorItem);
  cursorItemRef.current = cursorItem;

  // Three.js References
  const threeRefs = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: PointerLockControls;
    environment: ShaderEnvironment;
    atlas: TextureAtlas;
    world: VoxelWorld;
    mobManager: MobManager;
    clock: THREE.Clock;
    moveState: { forward: boolean; backward: boolean; left: boolean; right: boolean; jump: boolean; sprint: boolean };
    player: {
      velocity: THREE.Vector3;
      onGround: boolean;
      height: number;
      radius: number;
      flying: boolean;
    };
    timeOfDay: number;
    breakProgress: {
      pos: THREE.Vector3 | null;
      stage: number;
      timer: number;
      maxDuration: number;
    };
    lastAttackTime: number;
    lastHurtTime: number;
    isNight: boolean;
  } | null>(null);

  // Unlock achievement helper
  const unlockAchievement = useCallback((id: string) => {
    setAchievements((prev) =>
      prev.map((ach) => {
        if (ach.id === id && !ach.unlocked) {
          setToastMessage({ title: ach.title, desc: ach.description, icon: ach.icon });
          sound.playCraft();
          setTimeout(() => setToastMessage(null), 4000);
          return { ...ach, unlocked: true };
        }
        return ach;
      })
    );
  }, []);

  // Update craft outputs when crafting grids change
  useEffect(() => {
    const res2 = matchRecipe(craft2x2, 2);
    setCraft2x2Result(res2 ? res2.result : null);
  }, [craft2x2]);

  useEffect(() => {
    const res3 = matchRecipe(craft3x3, 3);
    setCraft3x3Result(res3 ? res3.result : null);
  }, [craft3x3]);

  // Main Three.js Initialization
  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;

    // 1. Scene, Camera, Renderer
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.Fog(0x87ceeb, 18, 38);

    const camera = new THREE.PerspectiveCamera(fov, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(8, 12, 8);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    // 2. High Fidelity Shader Environment (Volumetric Clouds, Sun/Moon Corona, Starfield, Dynamic GI)
    const environment = new ShaderEnvironment(scene, camera);

    // 3. PointerLockControls
    const controls = new PointerLockControls(camera, document.body);

    controls.addEventListener('lock', () => {
      setIsLocked(true);
      setOpenModal(null);
      sound.unlock();
    });

    controls.addEventListener('unlock', () => {
      setIsLocked(false);
    });

    // 4. Texture Atlas & World
    const atlas = buildGameTextures();
    const world = new VoxelWorld(scene, atlas);
    const mobManager = new MobManager(scene, world);

    // Generate initial spawn area chunks
    world.updateChunks(camera.position);

    // Ensure player is above surface at spawn
    const { height: spawnY } = world.getTerrainHeight(8, 8);
    camera.position.set(8, Math.max(spawnY + 2.5, 5), 8);

    const clock = new THREE.Clock();

    const refs = {
      scene,
      camera,
      renderer,
      controls,
      environment,
      atlas,
      world,
      mobManager,
      clock,
      moveState: { forward: false, backward: false, left: false, right: false, jump: false, sprint: false },
      player: {
        velocity: new THREE.Vector3(),
        onGround: false,
        height: 1.62,
        radius: 0.32,
        flying: false,
      },
      timeOfDay: Math.PI / 2, // Noon
      breakProgress: {
        pos: null as THREE.Vector3 | null,
        stage: 0,
        timer: 0,
        maxDuration: 0.5,
      },
      lastAttackTime: 0,
      lastHurtTime: 0,
      isNight: false,
    };
    threeRefs.current = refs;

    // Window Resize Handler
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    // Main Game Animation Loop
    let animId: number;
    let spawnTimer = 0;

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), 0.08);

      if (controls.isLocked) {
        updateGame(delta, refs);
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  // Update FOV & Render Distance dynamically
  useEffect(() => {
    if (threeRefs.current) {
      threeRefs.current.camera.fov = fov;
      threeRefs.current.camera.updateProjectionMatrix();
      threeRefs.current.world.renderDistance = renderDist;
      if (threeRefs.current.scene.fog instanceof THREE.Fog) {
        threeRefs.current.scene.fog.near = renderDist * 9;
        threeRefs.current.scene.fog.far = renderDist * 16 + 6;
      }
      threeRefs.current.world.updateInstancedMeshes();
    }
  }, [fov, renderDist]);

  // Sound settings sync
  useEffect(() => {
    sound.soundEnabled = soundEnabled;
    sound.musicEnabled = musicEnabled;
  }, [soundEnabled, musicEnabled]);

  // Pickup item helper
  const handlePickupItem = useCallback((itemId: string, count: number): boolean => {
    setInventory((prev) => {
      const next = [...prev];
      const def = ITEMS[itemId];
      if (!def) return prev;

      let remaining = count;

      // 1. Try stacking onto existing slots
      for (let i = 0; i < next.length; i++) {
        if (next[i].itemId === itemId && next[i].count < def.maxStack) {
          const space = def.maxStack - next[i].count;
          const toAdd = Math.min(remaining, space);
          next[i] = { ...next[i], count: next[i].count + toAdd };
          remaining -= toAdd;
          if (remaining <= 0) break;
        }
      }

      // 2. Put into empty slots
      if (remaining > 0) {
        for (let i = 0; i < next.length; i++) {
          if (next[i].itemId === null || next[i].count === 0) {
            const toAdd = Math.min(remaining, def.maxStack);
            next[i] = { itemId, count: toAdd };
            remaining -= toAdd;
            if (remaining <= 0) break;
          }
        }
      }

      if (itemId === 'wood') unlockAchievement('wood');
      if (itemId === 'iron_ingot') unlockAchievement('iron');

      return remaining < count ? next : prev;
    });
    return true;
  }, [unlockAchievement]);

  // Close modal and return cursor item to inventory
  const closeModalAndLock = useCallback(() => {
    if (cursorItemRef.current && cursorItemRef.current.itemId) {
      handlePickupItem(cursorItemRef.current.itemId, cursorItemRef.current.count);
      setCursorItem(null);
    }
    setOpenModal(null);
    threeRefs.current?.controls.lock();
  }, [handlePickupItem]);

  // Player damage handler
  const handlePlayerDamage = useCallback(
    (dmg: number, source: string) => {
      if (gameMode === 'creative') return;
      const refs = threeRefs.current;
      if (!refs) return;

      const now = performance.now();
      if (now - refs.lastHurtTime < 500) return; // Invulnerability frames
      refs.lastHurtTime = now;

      sound.playHurt(false);
      setHealth((h) => {
        const next = Math.max(0, h - dmg);
        if (next === 0) {
          // Respawn
          setTimeout(() => {
            if (threeRefs.current) {
              threeRefs.current.camera.position.set(8, 15, 8);
              threeRefs.current.player.velocity.set(0, 0, 0);
              setHealth(20);
              setHunger(20);
            }
          }, 1000);
        }
        return next;
      });

      // Camera recoil shake
      refs.camera.rotation.z += (Math.random() - 0.5) * 0.15;
    },
    [gameMode]
  );

  // Core Physics & Simulation Frame Update
  const updateGame = (delta: number, refs: NonNullable<typeof threeRefs.current>) => {
    const { camera, world, mobManager, player, moveState, environment } = refs;

    // 1. Day / Night Celestial Cycle & Shader Environment Update
    refs.timeOfDay += delta * 0.015;
    const sunAngle = refs.timeOfDay;
    const sunY = Math.sin(sunAngle);
    const isNight = sunY < 0;
    refs.isNight = isNight;

    environment.update(delta, refs.timeOfDay, camera.position);
    world.animateWater(delta);

    const hours = Math.floor(((sunAngle / (Math.PI * 2)) * 24 + 6) % 24);
    const minutes = Math.floor((((sunAngle / (Math.PI * 2)) * 24 * 60) % 60));
    setTimeString(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`);
    setLumenPercent(Math.round(Math.max(0.08, sunY) * 100));

    // 2. Physical Water Fluid & Swimming Detection
    const px = Math.floor(camera.position.x);
    const py = Math.floor(camera.position.y);
    const pz = Math.floor(camera.position.z);
    const feetBlock = world.getBlock(px, Math.floor(camera.position.y - 1.2), pz);
    const eyeBlock = world.getBlock(px, py, pz);
    const inWater = feetBlock === BLOCKS.WATER || eyeBlock === BLOCKS.WATER;
    const headUnderwater = eyeBlock === BLOCKS.WATER;

    // Splash sound & fall kinetic energy absorption
    if (inWater && !wasInWaterRef.current) {
      if (player.velocity.y < -3.5) {
        sound.playSplash();
      }
    }
    wasInWaterRef.current = inWater;

    // 3. Player Movement Physics (True World Coordinates - No Camera Pitch/Yaw Inversion)
    const speed = inWater ? (moveState.sprint ? 5.5 : 3.8) : (moveState.sprint ? 9.5 : 6.0);

    if (inWater) {
      // Fluid viscosity / drag (Navier-Stokes linear/quadratic drag)
      player.velocity.x *= Math.max(0, 1 - 3.8 * delta);
      player.velocity.z *= Math.max(0, 1 - 3.8 * delta);
      // Fluid buoyancy (Archimedes principle): upward buoyancy cancels most gravity
      player.velocity.y -= 4.5 * delta;
      player.velocity.y *= Math.max(0, 1 - 2.8 * delta);
      // Terminal sink velocity in water
      if (player.velocity.y < -3.2) player.velocity.y = -3.2;

      // Active swimming propulsion
      if (moveState.jump) {
        player.velocity.y = Math.min(player.velocity.y + 14.0 * delta, 3.8);
        swimSoundTimerRef.current += delta;
        if (swimSoundTimerRef.current > 0.45) {
          sound.playSwim();
          swimSoundTimerRef.current = 0;
        }
      }
      if (moveState.sprint) {
        // Shift key dives downward
        player.velocity.y = Math.max(player.velocity.y - 12.0 * delta, -3.8);
      }
    } else {
      const gravity = player.flying ? 0 : 25.0;
      player.velocity.x -= player.velocity.x * 10.0 * delta;
      player.velocity.z -= player.velocity.z * 10.0 * delta;
      player.velocity.y -= gravity * delta;
      if (player.flying) {
        player.velocity.y -= player.velocity.y * 8.0 * delta;
      }
    }

    // Compute stable horizontal forward and right vectors from camera
    // Projecting look direction onto XZ plane prevents pitch gimbal lock / yaw flip
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 0.0001) {
      forward.set(0, 0, -1);
    } else {
      forward.normalize();
    }

    // Right vector is perpendicular to forward on XZ plane: (forward x UP)
    const right = new THREE.Vector3();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    // Sum movement directions in world space
    const inputVec = new THREE.Vector3();
    if (moveState.forward) inputVec.add(forward);
    if (moveState.backward) inputVec.sub(forward);
    if (moveState.right) inputVec.add(right);
    if (moveState.left) inputVec.sub(right);

    if (inputVec.lengthSq() > 0) {
      inputVec.normalize();
      const accel = inWater ? 6.0 : 10.0;
      player.velocity.x += inputVec.x * speed * accel * delta;
      player.velocity.z += inputVec.z * speed * accel * delta;

      // Play step sound
      if (!inWater && player.onGround && Math.random() < 0.12) {
        sound.playStep('grass');
        // Drain tiny hunger on move
        setHunger((h) => Math.max(0, h - delta * 0.08));
      }
    }

    // Direct translation in world coordinates
    const moveVec = new THREE.Vector3(player.velocity.x * delta, 0, player.velocity.z * delta);

    // Collision check helper
    const checkCollision = (pos: THREE.Vector3) => {
      const minX = Math.floor(pos.x - player.radius);
      const maxX = Math.floor(pos.x + player.radius);
      const minY = Math.floor(pos.y - player.height);
      const maxY = Math.floor(pos.y + 0.1);
      const minZ = Math.floor(pos.z - player.radius);
      const maxZ = Math.floor(pos.z + player.radius);

      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          for (let z = minZ; z <= maxZ; z++) {
            const block = world.getBlock(x, y, z);
            if (block && BLOCK_DEFS[block]?.isSolid) {
              return true;
            }
          }
        }
      }
      return false;
    };

    // Apply X
    camera.position.x += moveVec.x;
    if (checkCollision(camera.position)) {
      camera.position.x -= moveVec.x;
      player.velocity.x = 0;
    }

    // Apply Z
    camera.position.z += moveVec.z;
    if (checkCollision(camera.position)) {
      camera.position.z -= moveVec.z;
      player.velocity.z = 0;
    }

    // Apply Y (Vertical)
    camera.position.y += player.velocity.y * delta;
    player.onGround = false;
    if (checkCollision(camera.position)) {
      if (player.velocity.y < 0) {
        player.onGround = true;
      }
      camera.position.y -= player.velocity.y * delta;
      player.velocity.y = 0;
    }

    // Void fall safety
    if (camera.position.y < BEDROCK_Y - 5) {
      camera.position.set(8, 12, 8);
      player.velocity.set(0, 0, 0);
      handlePlayerDamage(5, '奈落');
    }

    // 4. Update Chunks & World Systems
    world.updateChunks(camera.position);
    world.updateDebris(delta);
    world.updateWaterPhysics(delta);

    // 5. Atmospheric Underwater Fog & Oxygen Simulation
    setIsUnderwater(headUnderwater);
    if (headUnderwater) {
      if (refs.scene.fog instanceof THREE.Fog) {
        refs.scene.fog.color.setHex(0x165b7d);
        refs.scene.fog.near = 1.0;
        refs.scene.fog.far = 20.0;
      }
      // Deplete breath
      setOxygen((o) => {
        const nextO = Math.max(0, o - delta * 0.5); // 20s breath
        if (nextO <= 0) {
          drownTimerRef.current += delta;
          if (drownTimerRef.current > 1.2) {
            handlePlayerDamage(1, '溺死');
            sound.playHurt();
            drownTimerRef.current = 0;
          }
        }
        return nextO;
      });
      if (Math.random() < 0.04) {
        sound.playBubble();
      }
    } else {
      if (refs.scene.fog instanceof THREE.Fog) {
        refs.scene.fog.color.setHex(isNight ? 0x050b14 : 0x87ceeb);
        refs.scene.fog.near = 18.0;
        refs.scene.fog.far = 38.0;
      }
      setOxygen(10);
      drownTimerRef.current = 0;
    }

    // 6. Update Mobs & Spawns
    mobManager.update(delta, camera.position, handlePlayerDamage, handlePickupItem, isNight);
    mobManager.handleSpawning(camera.position, isNight, peaceful);

    // 7. Raycasting for Target Block / Face
    updateTargetBlock(refs);

    // 8. Coordinates & Biome HUD update
    const { biome } = world.getTerrainHeight(camera.position.x, camera.position.z);
    setCoords({
      x: Math.floor(camera.position.x),
      y: Math.floor(camera.position.y),
      z: Math.floor(camera.position.z),
      biome,
    });
  };

  // Raycasting to find block player is pointing at
  const updateTargetBlock = (refs: NonNullable<typeof threeRefs.current>) => {
    const { camera, world } = refs;
    const lookDir = new THREE.Vector3();
    camera.getWorldDirection(lookDir);

    const hit = world.raycast(camera.position, lookDir, 5.5);

    if (hit) {
      world.setTargetHighlight(hit.blockPos);
      const def = BLOCK_DEFS[hit.blockId];
      setTargetBlockName(def ? def.name : null);
    } else {
      world.setTargetHighlight(null);
      world.setCrackStage(null, -1);
      setTargetBlockName(null);
    }
  };

  // Input Event Listeners (Keyboard & Mouse)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Toggle inventory with 'E'
      if (e.code === 'KeyE') {
        e.preventDefault();
        if (openModal) {
          closeModalAndLock();
        } else {
          threeRefs.current?.controls.unlock();
          setOpenModal('inventory');
        }
        return;
      }

      // Escape to open Settings
      if (e.code === 'Escape') {
        if (openModal) {
          closeModalAndLock();
        } else {
          setOpenModal('settings');
        }
        return;
      }

      const refs = threeRefs.current;
      if (!refs || !refs.controls.isLocked) return;

      const { moveState, player } = refs;
      switch (e.code) {
        case 'KeyW':
          moveState.forward = true;
          break;
        case 'KeyS':
          moveState.backward = true;
          break;
        case 'KeyA':
          moveState.left = true;
          break;
        case 'KeyD':
          moveState.right = true;
          break;
        case 'ShiftLeft':
          if (player.flying) {
            player.velocity.y = -8;
          } else {
            moveState.sprint = true;
          }
          break;
        case 'Space':
          moveState.jump = true;
          if (player.flying) {
            player.velocity.y = 8;
          } else if (player.onGround) {
            player.velocity.y = 8.8;
            setHunger((h) => Math.max(0, h - 0.08));
          }
          break;
        case 'KeyF':
          // Toggle flight in Creative mode
          if (gameMode === 'creative') {
            player.flying = !player.flying;
            player.velocity.y = 0;
          }
          break;
        // Hotbar selection 1-9
        case 'Digit1':
        case 'Digit2':
        case 'Digit3':
        case 'Digit4':
        case 'Digit5':
        case 'Digit6':
        case 'Digit7':
        case 'Digit8':
        case 'Digit9':
          setActiveSlot(parseInt(e.key) - 1);
          break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const refs = threeRefs.current;
      if (!refs) return;
      const { moveState, player } = refs;
      switch (e.code) {
        case 'KeyW':
          moveState.forward = false;
          break;
        case 'KeyS':
          moveState.backward = false;
          break;
        case 'KeyA':
          moveState.left = false;
          break;
        case 'KeyD':
          moveState.right = false;
          break;
        case 'ShiftLeft':
          moveState.sprint = false;
          if (player.flying && player.velocity.y < 0) {
            player.velocity.y = 0;
          }
          break;
        case 'Space':
          moveState.jump = false;
          if (player.flying && player.velocity.y > 0) {
            player.velocity.y = 0;
          }
          break;
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (!threeRefs.current?.controls.isLocked) return;
      setActiveSlot((prev) => {
        if (e.deltaY > 0) return (prev + 1) % 9;
        return (prev - 1 + 9) % 9;
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('wheel', handleWheel);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('wheel', handleWheel);
    };
  }, [openModal, gameMode]);

  // Mouse Interaction (Mining, Placing, Attacking, Eating, Bow) attached to window
  useEffect(() => {
    const handleDocumentMouseDown = (e: MouseEvent) => {
      const refs = threeRefs.current;
      if (!refs || !refs.controls.isLocked) return;

      const { camera, world, mobManager } = refs;
      const currentSlotIdx = activeSlotRef.current;
      const currentItemSlot = inventoryRef.current[currentSlotIdx];
      const currentItem = currentItemSlot?.itemId ? ITEMS[currentItemSlot.itemId] : null;

      const lookDir = new THREE.Vector3();
      camera.getWorldDirection(lookDir);

      // Right-Click Eating Food
      if (e.button === 2 && currentItem?.foodRestore) {
        sound.playEat();
        setHealth((h) => Math.min(20, h + currentItem.foodRestore!.health));
        setHunger((u) => Math.min(20, u + currentItem.foodRestore!.hunger));
        if (gameModeRef.current !== 'creative') {
          setInventory((prev) => {
            const next = [...prev];
            next[currentSlotIdx] = {
              ...next[currentSlotIdx],
              count: next[currentSlotIdx].count - 1,
              itemId: next[currentSlotIdx].count - 1 <= 0 ? null : next[currentSlotIdx].itemId,
            };
            return next;
          });
        }
        return;
      }

      // Right-Click Shooting Bow
      if (e.button === 2 && currentItem?.toolType === 'bow') {
        const arrowSlotIdx = inventoryRef.current.findIndex((s) => s.itemId === 'arrow' && s.count > 0);
        if (arrowSlotIdx !== -1 || gameModeRef.current === 'creative') {
          mobManager.shootArrow(
            camera.position.clone().add(lookDir.clone().multiplyScalar(0.5)),
            lookDir,
            true,
            26
          );

          if (gameModeRef.current !== 'creative') {
            setInventory((prev) => {
              const next = [...prev];
              next[arrowSlotIdx] = {
                ...next[arrowSlotIdx],
                count: next[arrowSlotIdx].count - 1,
                itemId: next[arrowSlotIdx].count - 1 <= 0 ? null : 'arrow',
              };
              return next;
            });
          }
          return;
        }
      }

      // 1. Check if aiming at a Mob first
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      const mobMeshes = mobManager.mobs.map((m) => m.mesh);
      const mobIntersects = raycaster.intersectObjects(mobMeshes, true);

      // 2. Check voxel raycast via DDA
      const voxelHit = world.raycast(camera.position, lookDir, 5.5);

      const hitMobObject = mobIntersects.length > 0 && mobIntersects[0].distance < 5.0 ? mobIntersects[0] : null;

      // Decide whether mob is hit before block
      if (hitMobObject && (!voxelHit || hitMobObject.distance < voxelHit.distance)) {
        if (e.button === 0) {
          // Left click attack mob
          const hitMob = mobManager.mobs.find((m) => {
            let cur: THREE.Object3D | null = hitMobObject.object;
            while (cur) {
              if (cur === m.mesh) return true;
              cur = cur.parent;
            }
            return false;
          });

          if (hitMob) {
            sound.playSwing();
            const baseDmg = currentItem?.damage || 1;
            const dir = hitMob.position.clone().sub(camera.position).normalize();
            const killed = mobManager.hurtMob(hitMob, baseDmg, dir);
            if (killed && hitMob.isHostile) {
              unlockAchievement('hunter');
            }
            return;
          }
        }
      }

      // If no mob hit, process voxel block
      if (!voxelHit) return;

      const { blockPos, normal, blockId } = voxelHit;
      const bx = blockPos.x;
      const by = blockPos.y;
      const bz = blockPos.z;

      // LEFT CLICK: Break block or prime TNT
      if (e.button === 0) {
        sound.playHitBlock();

        if (blockId === BLOCKS.TNT) {
          world.removeBlock(bx, by, bz, true);
          sound.playCreeperHiss();
          setTimeout(() => {
            world.explode(bx, by, bz, 4.0);
            unlockAchievement('tnt');
          }, 1500);
          return;
        }

        const def = BLOCK_DEFS[blockId];
        const removed = world.removeBlock(bx, by, bz, true);
        if (removed) {
          sound.playBreakBlock();
          world.setCrackStage(null, -1);

          // Drops logic
          if (def && gameModeRef.current !== 'creative') {
            for (const drop of def.drops) {
              if (!drop.chance || Math.random() < drop.chance) {
                mobManager.spawnDroppedItem(
                  drop.itemId,
                  drop.count,
                  new THREE.Vector3(bx + 0.5, by + 0.5, bz + 0.5)
                );
              }
            }
          }

          if (removed === BLOCKS.STONE) unlockAchievement('pickaxe');
          if (removed === BLOCKS.WOOD) unlockAchievement('wood');
        }
      }

      // RIGHT CLICK: Place block or interact
      else if (e.button === 2) {
        const def = BLOCK_DEFS[blockId];

        // Interactive blocks (Crafting table, furnace, chest, bed)
        if (def?.isInteractive) {
          if (def.isInteractive === 'crafting_table') {
            refs.controls.unlock();
            setOpenModal('workbench');
            unlockAchievement('workbench');
            return;
          } else if (def.isInteractive === 'furnace') {
            refs.controls.unlock();
            setOpenModal('furnace');
            unlockAchievement('furnace');
            return;
          } else if (def.isInteractive === 'chest') {
            refs.controls.unlock();
            setOpenModal('chest');
            return;
          } else if (def.isInteractive === 'bed') {
            if (refs.isNight) {
              // Sleep until dawn
              sound.playCraft();
              refs.timeOfDay = Math.PI * 0.45; // Morning
              setHealth(20);
              unlockAchievement('bed');
            }
            return;
          }
        }

        // Place block from active hotbar slot
        if (currentItem?.isBlock && currentItem.blockType) {
          const placePos = blockPos.clone().add(normal);

          // Check intersection with player box
          const pRadius = refs.player.radius;
          const pHeight = refs.player.height;
          const playerBoxMin = camera.position.clone().sub(new THREE.Vector3(pRadius, pHeight, pRadius));
          const playerBoxMax = camera.position.clone().add(new THREE.Vector3(pRadius, 0.1, pRadius));

          const blockBoxMin = placePos.clone();
          const blockBoxMax = placePos.clone().addScalar(1);

          const intersectsPlayer =
            playerBoxMin.x < blockBoxMax.x &&
            playerBoxMax.x > blockBoxMin.x &&
            playerBoxMin.y < blockBoxMax.y &&
            playerBoxMax.y > blockBoxMin.y &&
            playerBoxMin.z < blockBoxMax.z &&
            playerBoxMax.z > blockBoxMin.z;

          if (!intersectsPlayer) {
            world.addBlock(placePos.x, placePos.y, placePos.z, currentItem.blockType as BlockId);
            sound.playPlaceBlock();

            if (gameModeRef.current !== 'creative') {
              setInventory((prev) => {
                const next = [...prev];
                next[currentSlotIdx] = {
                  ...next[currentSlotIdx],
                  count: next[currentSlotIdx].count - 1,
                  itemId: next[currentSlotIdx].count - 1 <= 0 ? null : next[currentSlotIdx].itemId,
                };
                return next;
              });
            }
          }
        }
      }
    };

    window.addEventListener('mousedown', handleDocumentMouseDown);
    const handleContextMenu = (e: MouseEvent) => e.preventDefault();
    window.addEventListener('contextmenu', handleContextMenu);

    return () => {
      window.removeEventListener('mousedown', handleDocumentMouseDown);
      window.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [unlockAchievement]);

  // Smelting loop simulation
  useEffect(() => {
    const timer = setInterval(() => {
      setFurnaceProgress((prev) => {
        if (!furnaceInput.itemId || furnaceInput.count <= 0) return 0;
        const recipe = SMELTING_RECIPES.find((r) => r.input === furnaceInput.itemId);
        if (!recipe) return 0;

        if (prev >= 100) {
          // Finish smelting 1 item
          setFurnaceInput((inp) => ({
            ...inp,
            count: inp.count - 1,
            itemId: inp.count - 1 <= 0 ? null : inp.itemId,
          }));
          setFurnaceOutput((out) => ({
            itemId: recipe.output,
            count: (out.count || 0) + 1,
          }));
          sound.playCraft();
          return 0;
        }
        return prev + 15;
      });
    }, 400);

    return () => clearInterval(timer);
  }, [furnaceInput]);

  // Crafting & Inventory modal handlers
  const handleSlotClick = (slotIdx: number) => {
    setInventory((prev) => {
      const next = [...prev];
      const clickedSlot = next[slotIdx];

      if (!cursorItem || !cursorItem.itemId) {
        if (clickedSlot.itemId && clickedSlot.count > 0) {
          setCursorItem(clickedSlot);
          next[slotIdx] = { itemId: null, count: 0 };
          sound.playPop();
        }
      } else {
        if (!clickedSlot.itemId) {
          next[slotIdx] = cursorItem;
          setCursorItem(null);
          sound.playPop();
        } else if (clickedSlot.itemId === cursorItem.itemId) {
          const maxStack = ITEMS[cursorItem.itemId]?.maxStack || 64;
          const space = maxStack - clickedSlot.count;
          if (space > 0) {
            const toAdd = Math.min(cursorItem.count, space);
            next[slotIdx] = { ...clickedSlot, count: clickedSlot.count + toAdd };
            const remainder = cursorItem.count - toAdd;
            setCursorItem(remainder > 0 ? { ...cursorItem, count: remainder } : null);
            sound.playPop();
          } else {
            next[slotIdx] = cursorItem;
            setCursorItem(clickedSlot);
            sound.playPop();
          }
        } else {
          next[slotIdx] = cursorItem;
          setCursorItem(clickedSlot);
          sound.playPop();
        }
      }
      return next;
    });
  };

  const handleCraftGridClick = (r: number, c: number, size: 2 | 3) => {
    const is2x2 = size === 2;
    const grid = is2x2 ? craft2x2 : craft3x3;
    const setGrid = is2x2 ? setCraft2x2 : setCraft3x3;
    const currentCellItem = grid[r][c];

    if (cursorItem && cursorItem.itemId) {
      if (currentCellItem) {
        handlePickupItem(currentCellItem, 1);
      }
      const newGrid = grid.map((row) => [...row]);
      newGrid[r][c] = cursorItem.itemId;
      setGrid(newGrid);

      if (cursorItem.count > 1) {
        setCursorItem({ ...cursorItem, count: cursorItem.count - 1 });
      } else {
        setCursorItem(null);
      }
      sound.playPop();
    } else if (currentCellItem) {
      setCursorItem({ itemId: currentCellItem, count: 1 });
      const newGrid = grid.map((row) => [...row]);
      newGrid[r][c] = null;
      setGrid(newGrid);
      sound.playPop();
    } else {
      const active = inventory[activeSlot];
      if (active.itemId && active.count > 0) {
        const newGrid = grid.map((row) => [...row]);
        newGrid[r][c] = active.itemId;
        setGrid(newGrid);
        setInventory((prev) => {
          const next = [...prev];
          next[activeSlot] = {
            ...next[activeSlot],
            count: next[activeSlot].count - 1,
            itemId: next[activeSlot].count - 1 <= 0 ? null : next[activeSlot].itemId,
          };
          return next;
        });
        sound.playPop();
      }
    }
  };

  const handleCraftTakeResult = (size: 2 | 3) => {
    const is2x2 = size === 2;
    const result = is2x2 ? craft2x2Result : craft3x3Result;
    const grid = is2x2 ? craft2x2 : craft3x3;
    const setGrid = is2x2 ? setCraft2x2 : setCraft3x3;

    if (!result) return;

    // Give result to player
    handlePickupItem(result.itemId, result.count);
    sound.playCraft();

    // Deduct 1 item from each used slot in the grid
    const newGrid = grid.map((row) => row.map(() => null));
    setGrid(newGrid);

    if (result.itemId === 'crafting_table') unlockAchievement('workbench');
    if (result.itemId.includes('pickaxe')) unlockAchievement('pickaxe');
  };

  return (
    <div
      className="relative w-screen h-screen overflow-hidden bg-black select-none text-white font-sans"
      onContextMenu={(e) => e.preventDefault()}
      onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
    >
      {/* 3D WebGL Canvas */}
      <canvas ref={canvasRef} className="w-full h-full block cursor-crosshair" />

      {/* Floating Dragging Cursor Item */}
      {cursorItem && cursorItem.itemId && (
        <div
          className="fixed pointer-events-none z-100 flex items-center justify-center -translate-x-1/2 -translate-y-1/2 drop-shadow-2xl"
          style={{ left: mousePos.x, top: mousePos.y }}
        >
          <img
            src={threeRefs.current?.atlas.dataUrls[ITEMS[cursorItem.itemId]?.textureId || 'stone']}
            alt=""
            className="w-10 h-10 object-contain pixelated"
          />
          <span className="absolute bottom-0 right-0 bg-neutral-900/90 text-[10px] font-bold text-amber-300 px-1 rounded border border-white/20">
            {cursorItem.count}
          </span>
        </div>
      )}

      {/* Crosshair (Center) */}
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
        <div className="relative w-5 h-5">
          <div className="absolute top-[9px] left-0 w-5 h-[2px] bg-white/80 shadow-sm" />
          <div className="absolute top-0 left-[9px] w-[2px] h-5 bg-white/80 shadow-sm" />
        </div>
      </div>

      {/* Top Left: Environment Diagnostics & Info */}
      <div className="absolute top-4 left-4 z-20 pointer-events-none bg-black/60 backdrop-blur-md px-3.5 py-2.5 rounded-lg border border-white/10 font-mono text-xs shadow-lg space-y-1">
        <div className="flex items-center gap-2 text-emerald-400 font-bold tracking-wide">
          <Sparkles className="w-3.5 h-3.5" />
          <span>VOXELVERSE v2.0 COMPLETE</span>
        </div>
        <div className="text-gray-300 text-[11px] space-y-0.5">
          <p>
            COORD: <span className="text-white font-semibold">X: {coords.x} Y: {coords.y} Z: {coords.z}</span>
          </p>
          <p>
            BIOME: <span className="text-amber-300 uppercase font-semibold">{coords.biome}</span> | TIME: <span className="text-sky-300 font-semibold">{timeString}</span>
          </p>
          {targetBlockName && (
            <p className="text-yellow-300">
              TARGET: <span className="font-bold underline">{targetBlockName}</span>
            </p>
          )}
        </div>
      </div>

      {/* Top Right: Utility Buttons & Mode Indicator */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
        <div className="bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 text-xs font-mono font-semibold uppercase text-emerald-400">
          {gameMode} MODE
        </div>
        <button
          onClick={() => {
            sound.unlock();
            setSoundEnabled(!soundEnabled);
          }}
          className="p-2 bg-black/60 hover:bg-black/80 backdrop-blur-md rounded-lg border border-white/10 text-gray-300 hover:text-white transition"
          title="Toggle Sound"
        >
          {soundEnabled ? <Volume2 className="w-4 h-4 text-emerald-400" /> : <VolumeX className="w-4 h-4 text-rose-400" />}
        </button>
        <button
          onClick={() => {
            threeRefs.current?.controls.unlock();
            setOpenModal('settings');
          }}
          className="p-2 bg-black/60 hover:bg-black/80 backdrop-blur-md rounded-lg border border-white/10 text-gray-300 hover:text-white transition"
          title="Settings / Pause"
        >
          <Settings className="w-4 h-4" />
        </button>
        <button
          onClick={() => {
            threeRefs.current?.controls.unlock();
            setOpenModal('help');
          }}
          className="p-2 bg-black/60 hover:bg-black/80 backdrop-blur-md rounded-lg border border-white/10 text-gray-300 hover:text-white transition"
          title="Help & Controls"
        >
          <HelpCircle className="w-4 h-4" />
        </button>
      </div>

      {/* Achievement / Toast Popup */}
      {toastMessage && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 bg-gradient-to-r from-amber-600/90 to-yellow-500/90 backdrop-blur-md border-2 border-yellow-300 px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3 animate-bounce">
          <span className="text-3xl">{toastMessage.icon}</span>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-amber-100">実績解除！</div>
            <div className="text-sm font-black text-white">{toastMessage.title}</div>
            <div className="text-xs text-yellow-100">{toastMessage.desc}</div>
          </div>
        </div>
      )}

      {/* Underwater Atmospheric Visual Effect */}
      {isUnderwater && (
        <div className="pointer-events-none absolute inset-0 z-15 bg-gradient-to-b from-cyan-900/35 via-teal-800/25 to-blue-950/45 mix-blend-color-burn" />
      )}

      {/* Oxygen Breath Bubbles Bar (Shown when swimming or oxygen < 10) */}
      {(isUnderwater || oxygen < 10) && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-20 pointer-events-none w-[420px] max-w-[92vw] flex justify-end items-center px-1">
          <div className="flex items-center gap-1 bg-black/60 px-2 py-1 rounded-lg backdrop-blur-md border border-cyan-400/30 shadow-lg">
            <span className="text-[10px] font-mono text-cyan-300 font-bold mr-1 tracking-wider">OXYGEN</span>
            {Array.from({ length: 10 }).map((_, i) => {
              const hasBubble = oxygen > i;
              return (
                <div key={i} className="relative w-3.5 h-3.5 flex items-center justify-center">
                  {hasBubble ? (
                    <span className="text-xs select-none animate-pulse">🫧</span>
                  ) : (
                    <span className="text-xs select-none opacity-20">⚪</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* HUD: Hearts & Hunger Bars */}
      <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 pointer-events-none w-[420px] max-w-[92vw] flex justify-between items-center px-1">
        {/* Health Hearts (10 Hearts) */}
        <div className="flex gap-1">
          {Array.from({ length: 10 }).map((_, i) => {
            const heartVal = health - i * 2;
            return (
              <div key={i} className="relative w-4 h-4">
                <span className="text-xs opacity-30 select-none">🖤</span>
                {heartVal >= 2 && <span className="absolute inset-0 text-xs text-red-500 select-none">❤️</span>}
                {heartVal === 1 && <span className="absolute inset-0 text-xs text-red-400 select-none opacity-80">💔</span>}
              </div>
            );
          })}
        </div>

        {/* Hunger Drumsticks (10 Icons) */}
        <div className="flex gap-1">
          {Array.from({ length: 10 }).map((_, i) => {
            const hungerVal = hunger - i * 2;
            return (
              <div key={i} className="relative w-4 h-4">
                <span className="text-xs opacity-30 select-none">🦴</span>
                {hungerVal >= 2 && <span className="absolute inset-0 text-xs text-amber-500 select-none">🍗</span>}
                {hungerVal === 1 && <span className="absolute inset-0 text-xs text-amber-400 select-none opacity-80">🍖</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom Hotbar (9 Slots) */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex gap-1.5 p-1.5 bg-black/75 backdrop-blur-md rounded-xl border border-white/20 shadow-2xl">
        {inventory.slice(0, 9).map((slot, idx) => {
          const isActive = idx === activeSlot;
          const item = slot.itemId ? ITEMS[slot.itemId] : null;
          const texUrl = item && threeRefs.current ? threeRefs.current.atlas.dataUrls[item.textureId] : null;

          return (
            <div
              key={idx}
              onClick={() => setActiveSlot(idx)}
              className={`relative w-12 h-12 rounded-lg cursor-pointer transition-all flex items-center justify-center ${
                isActive
                  ? 'border-2 border-white bg-white/20 shadow-[0_0_12px_rgba(255,255,255,0.4)] scale-110 z-10'
                  : 'border border-white/10 bg-white/5 hover:bg-white/10'
              }`}
            >
              {/* Number indicator */}
              <span className="absolute top-0.5 left-1 text-[10px] font-bold text-white/70">{idx + 1}</span>

              {/* Item Graphic */}
              {texUrl && (
                <img
                  src={texUrl}
                  alt={item?.name}
                  className="w-8 h-8 object-contain pixelated pointer-events-none drop-shadow"
                />
              )}

              {/* Item Count */}
              {slot.count > 1 && (
                <span className="absolute bottom-0.5 right-1 text-[11px] font-black text-white drop-shadow-[0_1px_1px_rgba(0,0,0,1)]">
                  {slot.count}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Start / Pause Blocker Screen */}
      {!isLocked && !openModal && (
        <div className="absolute inset-0 z-40 bg-black/75 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center">
          <div className="max-w-md w-full bg-neutral-900/90 border border-white/15 p-8 rounded-2xl shadow-2xl space-y-6">
            <div className="space-y-2">
              <h1 className="text-3xl font-black tracking-wider text-emerald-400">VOXELVERSE</h1>
              <p className="text-xs text-neutral-400 font-mono">3D VOXEL SANDBOX &amp; SURVIVAL</p>
            </div>

            <p className="text-sm text-neutral-300 leading-relaxed">
              資源採掘、ツール制作、クラフト、夜のモンスターとの戦闘、そして自由な建築が楽しめる完全版ボクセルサバイバル環境。
            </p>

            <button
              onClick={() => {
                sound.unlock();
                threeRefs.current?.controls.lock();
              }}
              className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-400 text-black font-black text-sm uppercase tracking-wider rounded-xl transition shadow-lg hover:shadow-emerald-500/30 active:scale-95"
            >
              シミュレーションを開始 / 再開
            </button>

            {/* Quick Controls Cheat Sheet */}
            <div className="text-xs text-neutral-400 grid grid-cols-2 gap-2 text-left bg-black/40 p-4 rounded-xl border border-white/5 font-mono">
              <div><b className="text-white">[ W A S D ]</b> 移動</div>
              <div><b className="text-white">[ SPACE ]</b> ジャンプ</div>
              <div><b className="text-white">[ 左クリック ]</b> 破壊 / 攻撃</div>
              <div><b className="text-white">[ 右クリック ]</b> 配置 / 食べる</div>
              <div><b className="text-white">[ E キー ]</b> インベントリ / クラフト</div>
              <div><b className="text-white">[ 1 - 9 ]</b> スロット選択</div>
            </div>
          </div>
        </div>
      )}

      {/* Inventory & 2x2 Crafting Screen (Press 'E') */}
      {openModal === 'inventory' && (
        <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-white/20 p-5 rounded-2xl shadow-2xl max-w-xl w-full space-y-4 max-h-[95vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-white/10 pb-2.5">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span>🎒</span> インベントリ &amp; 簡易クラフト (2x2)
              </h2>
              <button
                onClick={closeModalAndLock}
                className="text-neutral-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 2x2 Crafting Grid */}
            <div className="bg-neutral-950 p-3.5 rounded-xl border border-white/10 flex items-center justify-around">
              <div>
                <div className="text-xs text-neutral-400 mb-1.5 font-mono flex items-center justify-between">
                  <span>CRAFTING (2x2)</span>
                  <span className="text-[10px] text-neutral-500">クリックで配置/回収</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[0, 1].map((r) =>
                    [0, 1].map((c) => {
                      const itemId = craft2x2[r][c];
                      const item = itemId ? ITEMS[itemId] : null;
                      const texUrl = item && threeRefs.current ? threeRefs.current.atlas.dataUrls[item.textureId] : null;
                      return (
                        <div
                          key={`${r}-${c}`}
                          onClick={() => handleCraftGridClick(r, c, 2)}
                          className="w-12 h-12 bg-neutral-900 border border-white/15 rounded-lg flex items-center justify-center cursor-pointer hover:border-amber-400/80 transition-all shadow-inner relative"
                          title={item ? item.name : '材料を配置'}
                        >
                          {texUrl && <img src={texUrl} alt="" className="w-8 h-8 object-contain pixelated pointer-events-none" />}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Arrow */}
              <div className="text-2xl text-neutral-500 font-bold select-none">➔</div>

              {/* Crafting Result */}
              <div>
                <div className="text-xs text-neutral-400 mb-1.5 font-mono">RESULT (完成品)</div>
                <div
                  onClick={() => handleCraftTakeResult(2)}
                  className={`w-14 h-14 bg-neutral-900 border-2 rounded-xl flex items-center justify-center relative cursor-pointer transition-all ${
                    craft2x2Result
                      ? 'border-emerald-400 bg-emerald-950/40 shadow-[0_0_18px_rgba(52,211,153,0.35)] hover:scale-105 active:scale-95'
                      : 'border-white/10 cursor-not-allowed opacity-40'
                  }`}
                  title={craft2x2Result ? `${ITEMS[craft2x2Result.itemId]?.name} x${craft2x2Result.count}` : ''}
                >
                  {craft2x2Result && threeRefs.current && (
                    <>
                      <img
                        src={threeRefs.current.atlas.dataUrls[ITEMS[craft2x2Result.itemId]?.textureId || 'stone']}
                        alt=""
                        className="w-9 h-9 object-contain pixelated pointer-events-none"
                      />
                      <span className="absolute bottom-1 right-1 text-xs font-bold text-emerald-300 drop-shadow">
                        {craft2x2Result.count}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Quick Crafting Buttons */}
            <div>
              <div className="text-xs text-neutral-400 mb-1 font-mono">QUICK RECIPES (クリックで即時制作)</div>
              <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto pr-1">
                {CRAFTING_RECIPES.filter((r) => r.gridSize === 2).map((rec) => {
                  const resItem = ITEMS[rec.result.itemId];
                  const texUrl = resItem && threeRefs.current ? threeRefs.current.atlas.dataUrls[resItem.textureId] : null;
                  return (
                    <button
                      key={rec.id}
                      onClick={() => handlePickupItem(rec.result.itemId, rec.result.count)}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 active:scale-95 border border-white/10 rounded-lg text-xs transition-all"
                    >
                      {texUrl && <img src={texUrl} alt="" className="w-4 h-4 object-contain pixelated" />}
                      <span>{rec.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Backpack Inventory (27 slots: 9 to 35) */}
            <div>
              <div className="text-xs text-neutral-400 mb-1 font-mono flex items-center justify-between">
                <span>BACKPACK (バックパック 27枠)</span>
                <span className="text-[10px] text-neutral-500">クリックでアイテム移動</span>
              </div>
              <div className="grid grid-cols-9 gap-1 bg-neutral-950 p-2 rounded-xl border border-white/10">
                {inventory.slice(9, 36).map((slot, i) => {
                  const slotIdx = 9 + i;
                  const item = slot.itemId ? ITEMS[slot.itemId] : null;
                  const texUrl = item && threeRefs.current ? threeRefs.current.atlas.dataUrls[item.textureId] : null;
                  return (
                    <div
                      key={slotIdx}
                      onClick={() => handleSlotClick(slotIdx)}
                      className="w-10 h-10 bg-neutral-900 border border-white/10 rounded-lg flex items-center justify-center relative hover:border-amber-400/80 cursor-pointer transition-all shadow-inner"
                      title={item ? `${item.name} (${slot.count})` : ''}
                    >
                      {texUrl && <img src={texUrl} alt="" className="w-6 h-6 object-contain pixelated pointer-events-none" />}
                      {slot.count > 1 && (
                        <span className="absolute bottom-0 right-0.5 text-[10px] font-bold text-white drop-shadow">
                          {slot.count}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Hand / Hotbar Inventory (9 slots: 0 to 8) - 手持ちアイテム */}
            <div>
              <div className="text-xs text-amber-400 mb-1 font-mono flex items-center justify-between font-bold">
                <span>✋ 手持ちアイテム (HOTBAR 1〜9)</span>
                <span className="text-[10px] text-neutral-400 font-normal">数字キー [1-9] またはクリックで装備</span>
              </div>
              <div className="grid grid-cols-9 gap-1 bg-neutral-950/90 p-2 rounded-xl border-2 border-amber-500/40">
                {inventory.slice(0, 9).map((slot, slotIdx) => {
                  const item = slot.itemId ? ITEMS[slot.itemId] : null;
                  const texUrl = item && threeRefs.current ? threeRefs.current.atlas.dataUrls[item.textureId] : null;
                  const isActive = activeSlot === slotIdx;
                  return (
                    <div
                      key={slotIdx}
                      onClick={() => {
                        setActiveSlot(slotIdx);
                        handleSlotClick(slotIdx);
                      }}
                      className={`w-10 h-10 rounded-lg flex items-center justify-center relative cursor-pointer transition-all shadow-inner ${
                        isActive
                          ? 'bg-amber-950/60 border-2 border-amber-400 ring-2 ring-amber-400/30'
                          : 'bg-neutral-900 border border-white/15 hover:border-amber-400/80'
                      }`}
                      title={item ? `[${slotIdx + 1}] ${item.name} (${slot.count})` : `[${slotIdx + 1}] 空き`}
                    >
                      <span className="absolute top-0.5 left-1 text-[8px] font-mono text-neutral-500 pointer-events-none">
                        {slotIdx + 1}
                      </span>
                      {texUrl && <img src={texUrl} alt="" className="w-6 h-6 object-contain pixelated pointer-events-none" />}
                      {slot.count > 1 && (
                        <span className="absolute bottom-0 right-0.5 text-[10px] font-bold text-white drop-shadow">
                          {slot.count}
                        </span>
                      )}
                      {isActive && (
                        <span className="absolute -bottom-2 px-1 bg-amber-400 text-black text-[8px] font-black rounded-full pointer-events-none">
                          手持
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3x3 Workbench Crafting Screen */}
      {openModal === 'workbench' && (
        <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-white/20 p-5 rounded-2xl shadow-2xl max-w-xl w-full space-y-4 max-h-[95vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-white/10 pb-2.5">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span>🛠️</span> 作業台 (3x3 クラフト)
              </h2>
              <button
                onClick={closeModalAndLock}
                className="text-neutral-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 3x3 Grid & Output */}
            <div className="bg-neutral-950 p-3.5 rounded-xl border border-white/10 flex items-center justify-around">
              <div>
                <div className="text-xs text-neutral-400 mb-1.5 font-mono flex items-center justify-between">
                  <span>CRAFTING (3x3)</span>
                  <span className="text-[10px] text-neutral-500">クリックで配置/回収</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {[0, 1, 2].map((r) =>
                    [0, 1, 2].map((c) => {
                      const itemId = craft3x3[r][c];
                      const item = itemId ? ITEMS[itemId] : null;
                      const texUrl = item && threeRefs.current ? threeRefs.current.atlas.dataUrls[item.textureId] : null;
                      return (
                        <div
                          key={`${r}-${c}`}
                          onClick={() => handleCraftGridClick(r, c, 3)}
                          className="w-11 h-11 bg-neutral-900 border border-white/15 rounded-lg flex items-center justify-center cursor-pointer hover:border-amber-400/80 transition-all shadow-inner relative"
                          title={item ? item.name : '材料を配置'}
                        >
                          {texUrl && <img src={texUrl} alt="" className="w-7 h-7 object-contain pixelated pointer-events-none" />}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="text-2xl text-neutral-500 font-bold select-none">➔</div>

              <div>
                <div className="text-xs text-neutral-400 mb-1.5 font-mono">RESULT (完成品)</div>
                <div
                  onClick={() => handleCraftTakeResult(3)}
                  className={`w-16 h-16 bg-neutral-900 border-2 rounded-xl flex items-center justify-center relative cursor-pointer transition-all ${
                    craft3x3Result
                      ? 'border-emerald-400 bg-emerald-950/40 shadow-[0_0_18px_rgba(52,211,153,0.35)] hover:scale-105 active:scale-95'
                      : 'border-white/10 cursor-not-allowed opacity-40'
                  }`}
                  title={craft3x3Result ? `${ITEMS[craft3x3Result.itemId]?.name} x${craft3x3Result.count}` : ''}
                >
                  {craft3x3Result && threeRefs.current && (
                    <>
                      <img
                        src={threeRefs.current.atlas.dataUrls[ITEMS[craft3x3Result.itemId]?.textureId || 'stone']}
                        alt=""
                        className="w-10 h-10 object-contain pixelated pointer-events-none"
                      />
                      <span className="absolute bottom-1 right-1 text-xs font-bold text-emerald-300 drop-shadow">
                        {craft3x3Result.count}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Quick 3x3 Recipe Shortcuts */}
            <div>
              <div className="text-xs text-neutral-400 mb-1 font-mono">RECIPE BOOK (ワンクリックで即作成)</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-28 overflow-y-auto pr-1">
                {CRAFTING_RECIPES.map((rec) => {
                  const resItem = ITEMS[rec.result.itemId];
                  const texUrl = resItem && threeRefs.current ? threeRefs.current.atlas.dataUrls[resItem.textureId] : null;
                  return (
                    <button
                      key={rec.id}
                      onClick={() => handlePickupItem(rec.result.itemId, rec.result.count)}
                      className="flex items-center gap-1.5 p-1.5 bg-neutral-800 hover:bg-neutral-700 active:scale-95 border border-white/10 rounded-lg text-xs text-left transition-all"
                    >
                      {texUrl && <img src={texUrl} alt="" className="w-5 h-5 object-contain pixelated pointer-events-none" />}
                      <span className="font-semibold truncate">{rec.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Backpack Inventory (27 slots: 9 to 35) */}
            <div>
              <div className="text-xs text-neutral-400 mb-1 font-mono flex items-center justify-between">
                <span>BACKPACK (バックパック 27枠)</span>
                <span className="text-[10px] text-neutral-500">クリックでアイテム移動</span>
              </div>
              <div className="grid grid-cols-9 gap-1 bg-neutral-950 p-2 rounded-xl border border-white/10">
                {inventory.slice(9, 36).map((slot, i) => {
                  const slotIdx = 9 + i;
                  const item = slot.itemId ? ITEMS[slot.itemId] : null;
                  const texUrl = item && threeRefs.current ? threeRefs.current.atlas.dataUrls[item.textureId] : null;
                  return (
                    <div
                      key={slotIdx}
                      onClick={() => handleSlotClick(slotIdx)}
                      className="w-10 h-10 bg-neutral-900 border border-white/10 rounded-lg flex items-center justify-center relative hover:border-amber-400/80 cursor-pointer transition-all shadow-inner"
                      title={item ? `${item.name} (${slot.count})` : ''}
                    >
                      {texUrl && <img src={texUrl} alt="" className="w-6 h-6 object-contain pixelated pointer-events-none" />}
                      {slot.count > 1 && (
                        <span className="absolute bottom-0 right-0.5 text-[10px] font-bold text-white drop-shadow">
                          {slot.count}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Hand / Hotbar Inventory (9 slots: 0 to 8) - 手持ちアイテム */}
            <div>
              <div className="text-xs text-amber-400 mb-1 font-mono flex items-center justify-between font-bold">
                <span>✋ 手持ちアイテム (HOTBAR 1〜9)</span>
                <span className="text-[10px] text-neutral-400 font-normal">数字キー [1-9] またはクリックで装備</span>
              </div>
              <div className="grid grid-cols-9 gap-1 bg-neutral-950/90 p-2 rounded-xl border-2 border-amber-500/40">
                {inventory.slice(0, 9).map((slot, slotIdx) => {
                  const item = slot.itemId ? ITEMS[slot.itemId] : null;
                  const texUrl = item && threeRefs.current ? threeRefs.current.atlas.dataUrls[item.textureId] : null;
                  const isActive = activeSlot === slotIdx;
                  return (
                    <div
                      key={slotIdx}
                      onClick={() => {
                        setActiveSlot(slotIdx);
                        handleSlotClick(slotIdx);
                      }}
                      className={`w-10 h-10 rounded-lg flex items-center justify-center relative cursor-pointer transition-all shadow-inner ${
                        isActive
                          ? 'bg-amber-950/60 border-2 border-amber-400 ring-2 ring-amber-400/30'
                          : 'bg-neutral-900 border border-white/15 hover:border-amber-400/80'
                      }`}
                      title={item ? `[${slotIdx + 1}] ${item.name} (${slot.count})` : `[${slotIdx + 1}] 空き`}
                    >
                      <span className="absolute top-0.5 left-1 text-[8px] font-mono text-neutral-500 pointer-events-none">
                        {slotIdx + 1}
                      </span>
                      {texUrl && <img src={texUrl} alt="" className="w-6 h-6 object-contain pixelated pointer-events-none" />}
                      {slot.count > 1 && (
                        <span className="absolute bottom-0 right-0.5 text-[10px] font-bold text-white drop-shadow">
                          {slot.count}
                        </span>
                      )}
                      {isActive && (
                        <span className="absolute -bottom-2 px-1 bg-amber-400 text-black text-[8px] font-black rounded-full pointer-events-none">
                          手持
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Furnace Smelting Screen */}
      {openModal === 'furnace' && (
        <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-white/20 p-5 rounded-2xl shadow-2xl max-w-xl w-full space-y-4 max-h-[95vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-white/10 pb-2.5">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Flame className="w-5 h-5 text-orange-500" /> かまど (精錬・調理)
              </h2>
              <button
                onClick={closeModalAndLock}
                className="text-neutral-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-neutral-950 p-4 rounded-xl border border-white/10 flex items-center justify-around">
              {/* Left Column: Input + Fuel */}
              <div className="flex flex-col items-center gap-3">
                {/* Input Slot */}
                <div
                  onClick={() => {
                    const active = inventory[activeSlot];
                    if (active.itemId) {
                      setFurnaceInput(active);
                    }
                  }}
                  className="w-13 h-13 bg-neutral-900 border border-white/20 rounded-xl flex items-center justify-center cursor-pointer relative hover:border-orange-400 shadow-inner"
                  title="クリックで手持ちアイテムを材料にセット"
                >
                  {furnaceInput.itemId && threeRefs.current && (
                    <>
                      <img
                        src={threeRefs.current.atlas.dataUrls[ITEMS[furnaceInput.itemId]?.textureId || 'stone']}
                        alt=""
                        className="w-8 h-8 object-contain pixelated pointer-events-none"
                      />
                      <span className="absolute bottom-1 right-1 text-xs font-bold">{furnaceInput.count}</span>
                    </>
                  )}
                  {!furnaceInput.itemId && <span className="text-[10px] text-neutral-500 font-mono">材料</span>}
                </div>

                {/* Animated Flame */}
                <Flame className={`w-5 h-5 transition-all ${furnaceProgress > 0 ? 'text-amber-400 animate-pulse' : 'text-neutral-600'}`} />

                {/* Fuel Slot */}
                <div className="w-13 h-13 bg-neutral-900 border border-white/20 rounded-xl flex items-center justify-center text-[10px] text-neutral-400 font-mono shadow-inner">
                  🔥 燃料
                </div>
              </div>

              {/* Progress Arrow */}
              <div className="flex flex-col items-center gap-1">
                <span className="text-xs text-neutral-400 font-mono">{furnaceProgress}%</span>
                <div className="w-16 h-2 bg-neutral-800 rounded-full overflow-hidden border border-white/10">
                  <div
                    className="h-full bg-orange-500 transition-all duration-300"
                    style={{ width: `${furnaceProgress}%` }}
                  />
                </div>
              </div>

              {/* Output Slot */}
              <div
                onClick={() => {
                  if (furnaceOutput.itemId && furnaceOutput.count > 0) {
                    handlePickupItem(furnaceOutput.itemId, furnaceOutput.count);
                    setFurnaceOutput({ itemId: null, count: 0 });
                  }
                }}
                className={`w-15 h-15 bg-neutral-900 border-2 rounded-xl flex items-center justify-center relative cursor-pointer shadow-inner ${
                  furnaceOutput.itemId ? 'border-orange-400 bg-orange-950/30 shadow-[0_0_15px_rgba(251,146,60,0.3)]' : 'border-white/10'
                }`}
                title="クリックで完成品を回収"
              >
                {furnaceOutput.itemId && threeRefs.current && (
                  <>
                    <img
                      src={threeRefs.current.atlas.dataUrls[ITEMS[furnaceOutput.itemId]?.textureId || 'stone']}
                      alt=""
                      className="w-10 h-10 object-contain pixelated pointer-events-none"
                    />
                    <span className="absolute bottom-1 right-1 text-xs font-bold text-orange-300">
                      {furnaceOutput.count}
                    </span>
                  </>
                )}
                {!furnaceOutput.itemId && <span className="text-[10px] text-neutral-500 font-mono">成果物</span>}
              </div>
            </div>

            <div className="text-[11px] text-neutral-400 font-mono text-center">
              鉄鉱石 ➔ 鉄インゴット | 金鉱石 ➔ 金インゴット | 砂 ➔ ガラス | 生肉 ➔ ステーキ
            </div>

            {/* Backpack Inventory (27 slots: 9 to 35) */}
            <div>
              <div className="text-xs text-neutral-400 mb-1 font-mono flex items-center justify-between">
                <span>BACKPACK (バックパック 27枠)</span>
                <span className="text-[10px] text-neutral-500">クリックでアイテム移動</span>
              </div>
              <div className="grid grid-cols-9 gap-1 bg-neutral-950 p-2 rounded-xl border border-white/10">
                {inventory.slice(9, 36).map((slot, i) => {
                  const slotIdx = 9 + i;
                  const item = slot.itemId ? ITEMS[slot.itemId] : null;
                  const texUrl = item && threeRefs.current ? threeRefs.current.atlas.dataUrls[item.textureId] : null;
                  return (
                    <div
                      key={slotIdx}
                      onClick={() => handleSlotClick(slotIdx)}
                      className="w-10 h-10 bg-neutral-900 border border-white/10 rounded-lg flex items-center justify-center relative hover:border-amber-400/80 cursor-pointer transition-all shadow-inner"
                      title={item ? `${item.name} (${slot.count})` : ''}
                    >
                      {texUrl && <img src={texUrl} alt="" className="w-6 h-6 object-contain pixelated pointer-events-none" />}
                      {slot.count > 1 && (
                        <span className="absolute bottom-0 right-0.5 text-[10px] font-bold text-white drop-shadow">
                          {slot.count}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Hand / Hotbar Inventory (9 slots: 0 to 8) - 手持ちアイテム */}
            <div>
              <div className="text-xs text-amber-400 mb-1 font-mono flex items-center justify-between font-bold">
                <span>✋ 手持ちアイテム (HOTBAR 1〜9)</span>
                <span className="text-[10px] text-neutral-400 font-normal">数字キー [1-9] またはクリックで装備</span>
              </div>
              <div className="grid grid-cols-9 gap-1 bg-neutral-950/90 p-2 rounded-xl border-2 border-amber-500/40">
                {inventory.slice(0, 9).map((slot, slotIdx) => {
                  const item = slot.itemId ? ITEMS[slot.itemId] : null;
                  const texUrl = item && threeRefs.current ? threeRefs.current.atlas.dataUrls[item.textureId] : null;
                  const isActive = activeSlot === slotIdx;
                  return (
                    <div
                      key={slotIdx}
                      onClick={() => {
                        setActiveSlot(slotIdx);
                        handleSlotClick(slotIdx);
                      }}
                      className={`w-10 h-10 rounded-lg flex items-center justify-center relative cursor-pointer transition-all shadow-inner ${
                        isActive
                          ? 'bg-amber-950/60 border-2 border-amber-400 ring-2 ring-amber-400/30'
                          : 'bg-neutral-900 border border-white/15 hover:border-amber-400/80'
                      }`}
                      title={item ? `[${slotIdx + 1}] ${item.name} (${slot.count})` : `[${slotIdx + 1}] 空き`}
                    >
                      <span className="absolute top-0.5 left-1 text-[8px] font-mono text-neutral-500 pointer-events-none">
                        {slotIdx + 1}
                      </span>
                      {texUrl && <img src={texUrl} alt="" className="w-6 h-6 object-contain pixelated pointer-events-none" />}
                      {slot.count > 1 && (
                        <span className="absolute bottom-0 right-0.5 text-[10px] font-bold text-white drop-shadow">
                          {slot.count}
                        </span>
                      )}
                      {isActive && (
                        <span className="absolute -bottom-2 px-1 bg-amber-400 text-black text-[8px] font-black rounded-full pointer-events-none">
                          手持
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings & Pause Modal */}
      {openModal === 'settings' && (
        <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-white/20 p-6 rounded-2xl shadow-2xl max-w-lg w-full space-y-6">
            <div className="flex justify-between items-center border-b border-white/10 pb-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Settings className="w-5 h-5 text-emerald-400" /> ゲーム設定 &amp; ワールド管理
              </h2>
              <button
                onClick={() => {
                  setOpenModal(null);
                  threeRefs.current?.controls.lock();
                }}
                className="text-neutral-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Game Mode */}
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold">ゲームモード</span>
                <div className="flex gap-1 bg-neutral-950 p-1 rounded-lg border border-white/10">
                  <button
                    onClick={() => setGameMode('survival')}
                    className={`px-3 py-1 text-xs rounded-md font-bold transition ${
                      gameMode === 'survival' ? 'bg-emerald-500 text-black' : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    サバイバル
                  </button>
                  <button
                    onClick={() => setGameMode('creative')}
                    className={`px-3 py-1 text-xs rounded-md font-bold transition ${
                      gameMode === 'creative' ? 'bg-emerald-500 text-black' : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    クリエイティブ (飛行・無敵)
                  </button>
                </div>
              </div>

              {/* FOV Slider */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-neutral-300">
                  <span>視野角 (FOV)</span>
                  <span className="font-mono">{fov}°</span>
                </div>
                <input
                  type="range"
                  min="60"
                  max="100"
                  value={fov}
                  onChange={(e) => setFov(parseInt(e.target.value))}
                  className="w-full accent-emerald-500"
                />
              </div>

              {/* Render Distance */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-neutral-300">
                  <span>描画距離 (チャンク)</span>
                  <span className="font-mono">{renderDist} チャンク</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="4"
                  value={renderDist}
                  onChange={(e) => setRenderDist(parseInt(e.target.value))}
                  className="w-full accent-emerald-500"
                />
              </div>

              {/* Sound & Music Toggles */}
              <div className="flex justify-between items-center pt-2">
                <span className="text-sm font-semibold">効果音 (SE)</span>
                <input
                  type="checkbox"
                  checked={soundEnabled}
                  onChange={(e) => setSoundEnabled(e.target.checked)}
                  className="w-4 h-4 accent-emerald-500"
                />
              </div>

              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold">BGM (環境音楽)</span>
                <input
                  type="checkbox"
                  checked={musicEnabled}
                  onChange={(e) => setMusicEnabled(e.target.checked)}
                  className="w-4 h-4 accent-emerald-500"
                />
              </div>

              {/* Peaceful Mode */}
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold">平和モード (敵モブなし)</span>
                <input
                  type="checkbox"
                  checked={peaceful}
                  onChange={(e) => setPeaceful(e.target.checked)}
                  className="w-4 h-4 accent-emerald-500"
                />
              </div>
            </div>

            {/* Achievements List */}
            <div className="border-t border-white/10 pt-4">
              <div className="text-xs text-neutral-400 font-mono mb-2">ACHIEVEMENTS (実績)</div>
              <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto pr-1">
                {achievements.map((ach) => (
                  <div
                    key={ach.id}
                    className={`flex items-center gap-2 p-2 rounded-lg border text-xs ${
                      ach.unlocked
                        ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                        : 'bg-neutral-950 border-white/5 text-neutral-500 opacity-60'
                    }`}
                  >
                    <span className="text-lg">{ach.icon}</span>
                    <div className="truncate">
                      <div className="font-bold">{ach.title}</div>
                      <div className="text-[10px] opacity-80 truncate">{ach.description}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={() => {
                setOpenModal(null);
                threeRefs.current?.controls.lock();
              }}
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-black font-black text-sm uppercase rounded-xl transition shadow-lg"
            >
              設定を閉じてゲームに戻る
            </button>
          </div>
        </div>
      )}

      {/* Help & Guide Modal */}
      {openModal === 'help' && (
        <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-white/20 p-6 rounded-2xl shadow-2xl max-w-lg w-full space-y-5">
            <div className="flex justify-between items-center border-b border-white/10 pb-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-emerald-400" /> サバイバル操作ガイド &amp; ヒント
              </h2>
              <button
                onClick={() => {
                  setOpenModal(null);
                  threeRefs.current?.controls.lock();
                }}
                className="text-neutral-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs text-neutral-300 leading-relaxed">
              <div className="bg-neutral-950 p-3.5 rounded-xl border border-white/10 space-y-1.5">
                <h3 className="font-bold text-emerald-400 text-sm">💡 サバイバルの基本フロー</h3>
                <p>1. <b>原木を採取:</b> 木を左クリックで伐採し、原木を手に入れます。</p>
                <p>2. <b>木材と作業台:</b> [E]キーでインベントリを開き、原木を木材に、木材4つで「作業台」を作成！</p>
                <p>3. <b>ツルハシの作成:</b> 作業台を設置して右クリックし、木のツルハシを作って石や鉱石を採掘！</p>
                <p>4. <b>夜への備え:</b> 夜になるとゾンビやクリーパー、スケルトンが出現します。松明で拠点を照らし、身を守りましょう。</p>
              </div>

              <div className="bg-neutral-950 p-3.5 rounded-xl border border-white/10 space-y-1">
                <h3 className="font-bold text-sky-400 text-sm">🎮 操作方法一覧</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] pt-1">
                  <p><b>[ W A S D ]</b> 移動</p>
                  <p><b>[ SPACE ]</b> ジャンプ (飛翔)</p>
                  <p><b>[ 左クリック ]</b> 破壊 / モブ攻撃</p>
                  <p><b>[ 右クリック ]</b> ブロック配置 / 飲食</p>
                  <p><b>[ E キー ]</b> インベントリ</p>
                  <p><b>[ 1 - 9 ]</b> ホットバー選択</p>
                  <p><b>[ F キー ]</b> 飛行切替 (クリエイティブ)</p>
                  <p><b>[ ESC ]</b> ポーズ / 設定</p>
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                setOpenModal(null);
                threeRefs.current?.controls.lock();
              }}
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-black font-black text-sm uppercase rounded-xl transition"
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
