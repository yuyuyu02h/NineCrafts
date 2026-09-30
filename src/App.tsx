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
  const [timeString, setTimeString] = useState('12:00');
  const [lumenPercent, setLumenPercent] = useState(100);
  const [coords, setCoords] = useState({ x: 0, y: 10, z: 0, biome: 'plains' });
  const [targetBlockName, setTargetBlockName] = useState<string | null>(null);

  // Active Screen Menus: null | 'inventory' | 'workbench' | 'furnace' | 'chest' | 'settings' | 'help'
  const [openModal, setOpenModal] = useState<string | null>(null);

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
    // Starter items: Wood, Planks, Torches, Apples
    slots[0] = { itemId: 'wood', count: 8 };
    slots[1] = { itemId: 'planks', count: 16 };
    slots[2] = { itemId: 'torch', count: 8 };
    slots[3] = { itemId: 'apple', count: 4 };
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

  // Three.js References
  const threeRefs = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: PointerLockControls;
    dirLight: THREE.DirectionalLight;
    ambientLight: THREE.AmbientLight;
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
    scene.fog = new THREE.Fog(0x87ceeb, 12, 55);

    const camera = new THREE.PerspectiveCamera(fov, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(8, 12, 8);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // 2. Lighting & Sky
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfff8ee, 0.95);
    dirLight.position.set(50, 80, 40);
    dirLight.castShadow = true;
    dirLight.shadow.camera.left = -30;
    dirLight.shadow.camera.right = 30;
    dirLight.shadow.camera.top = 30;
    dirLight.shadow.camera.bottom = -30;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    scene.add(dirLight);

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
      dirLight,
      ambientLight,
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
    const { camera, world, mobManager, player, moveState, dirLight, scene } = refs;

    // 1. Day / Night Celestial Cycle
    refs.timeOfDay += delta * 0.015;
    const sunAngle = refs.timeOfDay;
    const sunY = Math.sin(sunAngle);
    const isNight = sunY < 0;
    refs.isNight = isNight;

    const lumen = Math.max(0.08, sunY);
    dirLight.intensity = Math.max(0.1, sunY * 0.95);
    dirLight.position.set(Math.cos(sunAngle) * 60, Math.sin(sunAngle) * 60, Math.sin(sunAngle * 0.5) * 20);

    // Sky & fog colors
    let skyColor: THREE.Color;
    if (sunY > 0.2) {
      // Daytime clear blue
      skyColor = new THREE.Color().setHSL(0.58, 0.65, 0.45 + sunY * 0.2);
    } else if (sunY > -0.1) {
      // Sunset / Sunrise warm orange glow
      skyColor = new THREE.Color().setHSL(0.06, 0.8, 0.35 + sunY * 0.3);
    } else {
      // Midnight deep navy
      skyColor = new THREE.Color().setHSL(0.65, 0.7, 0.04);
    }
    scene.background = skyColor;
    scene.fog!.color = skyColor;

    const hours = Math.floor(((sunAngle / (Math.PI * 2)) * 24 + 6) % 24);
    const minutes = Math.floor((((sunAngle / (Math.PI * 2)) * 24 * 60) % 60));
    setTimeString(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`);
    setLumenPercent(Math.round(lumen * 100));

    // 2. Player Movement Physics
    const speed = moveState.sprint ? 9.5 : 6.0;
    const gravity = player.flying ? 0 : 25.0;

    player.velocity.x -= player.velocity.x * 10.0 * delta;
    player.velocity.z -= player.velocity.z * 10.0 * delta;
    player.velocity.y -= gravity * delta;

    const moveDir = new THREE.Vector3();
    moveDir.z = Number(moveState.forward) - Number(moveState.backward);
    moveDir.x = Number(moveState.right) - Number(moveState.left);
    moveDir.normalize();

    if (moveDir.lengthSq() > 0) {
      player.velocity.z -= moveDir.z * speed * 10.0 * delta;
      player.velocity.x += moveDir.x * speed * 10.0 * delta;

      // Play step sound
      if (player.onGround && Math.random() < 0.12) {
        sound.playStep('grass');
        // Drain tiny hunger on move
        setHunger((h) => Math.max(0, h - delta * 0.08));
      }
    }

    // Camera rotation aligned translation
    const camEuler = new THREE.Euler(0, camera.rotation.y, 0, 'YXZ');
    const moveVec = new THREE.Vector3(player.velocity.x * delta, 0, player.velocity.z * delta);
    moveVec.applyEuler(camEuler);

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

    // 3. Update Chunks & World Systems
    world.updateChunks(camera.position);
    world.updateDebris(delta);

    // 4. Update Mobs & Spawns
    mobManager.update(delta, camera.position, handlePlayerDamage, handlePickupItem, isNight);
    mobManager.handleSpawning(camera.position, isNight, peaceful);

    // 5. Raycasting for Target Block / Face
    updateTargetBlock(refs);

    // 6. Coordinates & Biome HUD update
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
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

    const meshes = Object.values(world.instancedMeshes).filter(Boolean) as THREE.InstancedMesh[];
    const intersects = raycaster.intersectObjects(meshes);

    if (intersects.length > 0 && intersects[0].distance < 6.0) {
      const hit = intersects[0];
      const pos = new THREE.Vector3();
      if (hit.instanceId !== undefined) {
        const mat = new THREE.Matrix4();
        (hit.object as THREE.InstancedMesh).getMatrixAt(hit.instanceId, mat);
        pos.setFromMatrixPosition(mat);
      } else {
        pos.copy(hit.object.position);
      }

      world.setTargetHighlight(pos);

      const block = world.getBlock(pos.x, pos.y, pos.z);
      if (block && BLOCK_DEFS[block]) {
        setTargetBlockName(BLOCK_DEFS[block].name);
      } else {
        setTargetBlockName(null);
      }
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
          setOpenModal(null);
          threeRefs.current?.controls.lock();
        } else {
          threeRefs.current?.controls.unlock();
          setOpenModal('inventory');
        }
        return;
      }

      // Escape to open Settings
      if (e.code === 'Escape') {
        if (openModal) {
          setOpenModal(null);
          threeRefs.current?.controls.lock();
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
          moveState.sprint = true;
          break;
        case 'Space':
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
      const { moveState } = refs;
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

  // Mouse Interaction: Mining, Placing, Attacking, Eating, Bow
  const handleMouseDown = (e: React.MouseEvent) => {
    const refs = threeRefs.current;
    if (!refs || !refs.controls.isLocked) return;

    const { camera, world, mobManager } = refs;
    const currentItemSlot = inventory[activeSlot];
    const currentItem = currentItemSlot.itemId ? ITEMS[currentItemSlot.itemId] : null;

    // Right-Click Eating Food
    if (e.button === 2 && currentItem?.foodRestore) {
      if (health < 20 || hunger < 20) {
        sound.playEat();
        setHealth((h) => Math.min(20, h + currentItem.foodRestore!.health));
        setHunger((u) => Math.min(20, u + currentItem.foodRestore!.hunger));
        // Consume 1 item
        setInventory((prev) => {
          const next = [...prev];
          next[activeSlot] = {
            ...next[activeSlot],
            count: next[activeSlot].count - 1,
            itemId: next[activeSlot].count - 1 <= 0 ? null : next[activeSlot].itemId,
          };
          return next;
        });
        return;
      }
    }

    // Right-Click Shooting Bow
    if (e.button === 2 && currentItem?.toolType === 'bow') {
      // Find arrow in inventory
      const arrowSlotIdx = inventory.findIndex((s) => s.itemId === 'arrow' && s.count > 0);
      if (arrowSlotIdx !== -1 || gameMode === 'creative') {
        const shootDir = new THREE.Vector3();
        camera.getWorldDirection(shootDir);
        mobManager.shootArrow(camera.position.clone().add(shootDir.clone().multiplyScalar(0.5)), shootDir, true, 26);

        if (gameMode !== 'creative') {
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

    // Raycast targets (blocks & mobs)
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

    const targetBlocks = Object.values(world.instancedMeshes).filter(Boolean) as THREE.InstancedMesh[];
    const mobMeshes = mobManager.mobs.map((m) => m.mesh);
    const intersects = raycaster.intersectObjects([...targetBlocks, ...mobMeshes], true);

    if (intersects.length === 0 || intersects[0].distance > 5.5) return;

    const hit = intersects[0];

    // Check hit mob
    const hitMob = mobManager.mobs.find((m) => {
      let cur: THREE.Object3D | null = hit.object;
      while (cur) {
        if (cur === m.mesh) return true;
        cur = cur.parent;
      }
      return false;
    });

    if (hitMob) {
      if (e.button === 0) {
        // Attack mob
        sound.playSwing();
        const baseDmg = currentItem?.damage || 1;
        const dir = hitMob.position.clone().sub(camera.position).normalize();
        const killed = mobManager.hurtMob(hitMob, baseDmg, dir);
        if (killed && hitMob.isHostile) {
          unlockAchievement('hunter');
        }
      }
      return;
    }

    // Hit voxel block
    const pos = new THREE.Vector3();
    if (hit.instanceId !== undefined) {
      const mat = new THREE.Matrix4();
      (hit.object as THREE.InstancedMesh).getMatrixAt(hit.instanceId, mat);
      pos.setFromMatrixPosition(mat);
    } else {
      pos.copy(hit.object.position);
    }

    const bx = Math.floor(pos.x);
    const by = Math.floor(pos.y);
    const bz = Math.floor(pos.z);
    const hitBlock = world.getBlock(bx, by, bz);

    if (!hitBlock) return;

    // LEFT CLICK: Break block or prime TNT
    if (e.button === 0) {
      sound.playHitBlock();

      if (hitBlock === BLOCKS.TNT) {
        // Prime TNT!
        world.removeBlock(bx, by, bz, true);
        sound.playCreeperHiss();
        setTimeout(() => {
          world.explode(bx, by, bz, 4.0);
          unlockAchievement('tnt');
        }, 1500);
        return;
      }

      // Check tool suitability and mine
      const def = BLOCK_DEFS[hitBlock];
      const removed = world.removeBlock(bx, by, bz, true);
      if (removed) {
        sound.playBreakBlock();
        world.setCrackStage(null, -1);

        // Drops logic
        if (def && gameMode !== 'creative') {
          for (const drop of def.drops) {
            if (!drop.chance || Math.random() < drop.chance) {
              mobManager.spawnDroppedItem(drop.itemId, drop.count, new THREE.Vector3(bx + 0.5, by + 0.5, bz + 0.5));
            }
          }
        }

        if (removed === BLOCKS.STONE) unlockAchievement('pickaxe');
      }
    }

    // RIGHT CLICK: Place block or interact
    else if (e.button === 2) {
      const def = BLOCK_DEFS[hitBlock];

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
        const normal = hit.face ? hit.face.normal : new THREE.Vector3(0, 1, 0);
        const placePos = new THREE.Vector3(bx, by, bz).add(normal);

        // Check intersection with player box
        const playerBoxMin = camera.position.clone().sub(new THREE.Vector3(refs.player.radius, refs.player.height, refs.player.radius));
        const playerBoxMax = camera.position.clone().add(new THREE.Vector3(refs.player.radius, 0.2, refs.player.radius));

        const blockBoxMin = placePos.clone();
        const blockBoxMax = placePos.clone().addScalar(1);

        const intersectsPlayer =
          playerBoxMin.x <= blockBoxMax.x &&
          playerBoxMax.x >= blockBoxMin.x &&
          playerBoxMin.y <= blockBoxMax.y &&
          playerBoxMax.y >= blockBoxMin.y &&
          playerBoxMin.z <= blockBoxMax.z &&
          playerBoxMax.z >= blockBoxMin.z;

        if (!intersectsPlayer) {
          world.addBlock(placePos.x, placePos.y, placePos.z, currentItem.blockType as BlockId);
          sound.playPlaceBlock();

          if (gameMode !== 'creative') {
            setInventory((prev) => {
              const next = [...prev];
              next[activeSlot] = {
                ...next[activeSlot],
                count: next[activeSlot].count - 1,
                itemId: next[activeSlot].count - 1 <= 0 ? null : next[activeSlot].itemId,
              };
              return next;
            });
          }
        }
      }
    }
  };

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

  // Crafting handlers
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
    const newGrid = grid.map((row) => row.map((cell) => (cell ? null : null)));
    setGrid(newGrid);

    if (result.itemId === 'crafting_table') unlockAchievement('workbench');
    if (result.itemId.includes('pickaxe')) unlockAchievement('pickaxe');
  };

  return (
    <div
      className="relative w-screen h-screen overflow-hidden bg-black select-none text-white font-sans"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* 3D WebGL Canvas */}
      <canvas ref={canvasRef} className="w-full h-full block cursor-crosshair" onMouseDown={handleMouseDown} />

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
          <div className="bg-neutral-900 border border-white/20 p-6 rounded-2xl shadow-2xl max-w-lg w-full space-y-5">
            <div className="flex justify-between items-center border-b border-white/10 pb-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span>🎒</span> プレイヤーインベントリ &amp; 簡易クラフト
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

            {/* 2x2 Crafting Grid */}
            <div className="bg-neutral-950 p-4 rounded-xl border border-white/10 flex items-center justify-around">
              <div>
                <div className="text-xs text-neutral-400 mb-2 font-mono">CRAFTING (2x2)</div>
                <div className="grid grid-cols-2 gap-2">
                  {[0, 1].map((r) =>
                    [0, 1].map((c) => {
                      const itemId = craft2x2[r][c];
                      const item = itemId ? ITEMS[itemId] : null;
                      const texUrl = item && threeRefs.current ? threeRefs.current.atlas.dataUrls[item.textureId] : null;
                      return (
                        <div
                          key={`${r}-${c}`}
                          onClick={() => {
                            // Cycle simple placement from active item
                            const active = inventory[activeSlot];
                            if (active.itemId) {
                              const newGrid = craft2x2.map((row) => [...row]);
                              newGrid[r][c] = newGrid[r][c] ? null : active.itemId;
                              setCraft2x2(newGrid);
                            } else {
                              const newGrid = craft2x2.map((row) => [...row]);
                              newGrid[r][c] = null;
                              setCraft2x2(newGrid);
                            }
                          }}
                          className="w-12 h-12 bg-neutral-900 border border-white/15 rounded-lg flex items-center justify-center cursor-pointer hover:border-white/40"
                        >
                          {texUrl && <img src={texUrl} alt="" className="w-8 h-8 object-contain pixelated" />}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Arrow */}
              <div className="text-2xl text-neutral-500 font-bold">➔</div>

              {/* Crafting Result */}
              <div>
                <div className="text-xs text-neutral-400 mb-2 font-mono">RESULT</div>
                <div
                  onClick={() => handleCraftTakeResult(2)}
                  className={`w-14 h-14 bg-neutral-900 border-2 rounded-xl flex items-center justify-center relative cursor-pointer ${
                    craft2x2Result
                      ? 'border-emerald-400 bg-emerald-950/40 shadow-[0_0_15px_rgba(52,211,153,0.3)]'
                      : 'border-white/10 cursor-not-allowed opacity-50'
                  }`}
                >
                  {craft2x2Result && threeRefs.current && (
                    <>
                      <img
                        src={threeRefs.current.atlas.dataUrls[ITEMS[craft2x2Result.itemId]?.textureId || 'stone']}
                        alt=""
                        className="w-9 h-9 object-contain pixelated"
                      />
                      <span className="absolute bottom-1 right-1 text-xs font-bold text-emerald-300">
                        {craft2x2Result.count}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Quick Crafting Buttons (Instant 1-Click Craft) */}
            <div>
              <div className="text-xs text-neutral-400 mb-1.5 font-mono">QUICK RECIPES (クリックで即時制作)</div>
              <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto pr-1">
                {CRAFTING_RECIPES.filter((r) => r.gridSize === 2).map((rec) => {
                  const resItem = ITEMS[rec.result.itemId];
                  const texUrl = resItem && threeRefs.current ? threeRefs.current.atlas.dataUrls[resItem.textureId] : null;
                  return (
                    <button
                      key={rec.id}
                      onClick={() => handlePickupItem(rec.result.itemId, rec.result.count)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 border border-white/10 rounded-lg text-xs"
                    >
                      {texUrl && <img src={texUrl} alt="" className="w-5 h-5 object-contain pixelated" />}
                      <span>{rec.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Backpack Inventory (27 slots) */}
            <div>
              <div className="text-xs text-neutral-400 mb-1.5 font-mono">BACKPACK (バックパック)</div>
              <div className="grid grid-cols-9 gap-1.5 bg-neutral-950 p-2.5 rounded-xl border border-white/10">
                {inventory.slice(9, 36).map((slot, idx) => {
                  const item = slot.itemId ? ITEMS[slot.itemId] : null;
                  const texUrl = item && threeRefs.current ? threeRefs.current.atlas.dataUrls[item.textureId] : null;
                  return (
                    <div
                      key={idx}
                      className="w-10 h-10 bg-neutral-900 border border-white/10 rounded-lg flex items-center justify-center relative hover:border-white/40"
                    >
                      {texUrl && <img src={texUrl} alt="" className="w-6 h-6 object-contain pixelated" />}
                      {slot.count > 1 && (
                        <span className="absolute bottom-0 right-0.5 text-[10px] font-bold text-white">{slot.count}</span>
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
          <div className="bg-neutral-900 border border-white/20 p-6 rounded-2xl shadow-2xl max-w-xl w-full space-y-5">
            <div className="flex justify-between items-center border-b border-white/10 pb-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span>🛠️</span> 作業台 (3x3 クラフト)
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

            {/* 3x3 Grid & Output */}
            <div className="bg-neutral-950 p-4 rounded-xl border border-white/10 flex items-center justify-around">
              <div>
                <div className="grid grid-cols-3 gap-2">
                  {[0, 1, 2].map((r) =>
                    [0, 1, 2].map((c) => {
                      const itemId = craft3x3[r][c];
                      const item = itemId ? ITEMS[itemId] : null;
                      const texUrl = item && threeRefs.current ? threeRefs.current.atlas.dataUrls[item.textureId] : null;
                      return (
                        <div
                          key={`${r}-${c}`}
                          onClick={() => {
                            const active = inventory[activeSlot];
                            const newGrid = craft3x3.map((row) => [...row]);
                            newGrid[r][c] = newGrid[r][c] ? null : active.itemId;
                            setCraft3x3(newGrid);
                          }}
                          className="w-12 h-12 bg-neutral-900 border border-white/15 rounded-lg flex items-center justify-center cursor-pointer hover:border-white/40"
                        >
                          {texUrl && <img src={texUrl} alt="" className="w-8 h-8 object-contain pixelated" />}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="text-2xl text-neutral-500 font-bold">➔</div>

              <div>
                <div className="text-xs text-neutral-400 mb-2 font-mono">RESULT</div>
                <div
                  onClick={() => handleCraftTakeResult(3)}
                  className={`w-16 h-16 bg-neutral-900 border-2 rounded-xl flex items-center justify-center relative cursor-pointer ${
                    craft3x3Result
                      ? 'border-emerald-400 bg-emerald-950/40 shadow-[0_0_15px_rgba(52,211,153,0.3)]'
                      : 'border-white/10 cursor-not-allowed opacity-50'
                  }`}
                >
                  {craft3x3Result && threeRefs.current && (
                    <>
                      <img
                        src={threeRefs.current.atlas.dataUrls[ITEMS[craft3x3Result.itemId]?.textureId || 'stone']}
                        alt=""
                        className="w-10 h-10 object-contain pixelated"
                      />
                      <span className="absolute bottom-1 right-1 text-xs font-bold text-emerald-300">
                        {craft3x3Result.count}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Quick 3x3 Recipe Shortcuts */}
            <div>
              <div className="text-xs text-neutral-400 mb-1.5 font-mono">RECIPE BOOK (ワンクリックで即作成)</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-36 overflow-y-auto pr-1">
                {CRAFTING_RECIPES.map((rec) => {
                  const resItem = ITEMS[rec.result.itemId];
                  const texUrl = resItem && threeRefs.current ? threeRefs.current.atlas.dataUrls[resItem.textureId] : null;
                  return (
                    <button
                      key={rec.id}
                      onClick={() => handlePickupItem(rec.result.itemId, rec.result.count)}
                      className="flex items-center gap-2 p-2 bg-neutral-800 hover:bg-neutral-700 border border-white/10 rounded-lg text-xs text-left"
                    >
                      {texUrl && <img src={texUrl} alt="" className="w-6 h-6 object-contain pixelated" />}
                      <span className="font-semibold truncate">{rec.name}</span>
                    </button>
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
          <div className="bg-neutral-900 border border-white/20 p-6 rounded-2xl shadow-2xl max-w-md w-full space-y-6">
            <div className="flex justify-between items-center border-b border-white/10 pb-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Flame className="w-5 h-5 text-orange-500" /> かまど (精錬・調理)
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

            <div className="bg-neutral-950 p-6 rounded-xl border border-white/10 flex items-center justify-around">
              {/* Left Column: Input + Fuel */}
              <div className="flex flex-col items-center gap-4">
                {/* Input Slot */}
                <div
                  onClick={() => {
                    const active = inventory[activeSlot];
                    if (active.itemId) {
                      setFurnaceInput(active);
                    }
                  }}
                  className="w-14 h-14 bg-neutral-900 border border-white/20 rounded-xl flex items-center justify-center cursor-pointer relative hover:border-orange-400"
                >
                  {furnaceInput.itemId && threeRefs.current && (
                    <>
                      <img
                        src={threeRefs.current.atlas.dataUrls[ITEMS[furnaceInput.itemId]?.textureId || 'stone']}
                        alt=""
                        className="w-8 h-8 object-contain pixelated"
                      />
                      <span className="absolute bottom-1 right-1 text-xs font-bold">{furnaceInput.count}</span>
                    </>
                  )}
                  {!furnaceInput.itemId && <span className="text-[10px] text-neutral-500 font-mono">材料</span>}
                </div>

                {/* Animated Flame */}
                <Flame className={`w-6 h-6 transition-all ${furnaceProgress > 0 ? 'text-amber-400 animate-pulse' : 'text-neutral-600'}`} />

                {/* Fuel Slot */}
                <div className="w-14 h-14 bg-neutral-900 border border-white/20 rounded-xl flex items-center justify-center text-[10px] text-neutral-500 font-mono">
                  燃料
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
                className={`w-16 h-16 bg-neutral-900 border-2 rounded-xl flex items-center justify-center relative cursor-pointer ${
                  furnaceOutput.itemId ? 'border-orange-400 bg-orange-950/30' : 'border-white/10'
                }`}
              >
                {furnaceOutput.itemId && threeRefs.current && (
                  <>
                    <img
                      src={threeRefs.current.atlas.dataUrls[ITEMS[furnaceOutput.itemId]?.textureId || 'stone']}
                      alt=""
                      className="w-10 h-10 object-contain pixelated"
                    />
                    <span className="absolute bottom-1 right-1 text-xs font-bold text-orange-300">
                      {furnaceOutput.count}
                    </span>
                  </>
                )}
                {!furnaceOutput.itemId && <span className="text-[10px] text-neutral-500 font-mono">成果物</span>}
              </div>
            </div>

            <div className="text-xs text-neutral-400 font-mono text-center">
              鉄鉱石 ➔ 鉄インゴット | 金鉱石 ➔ 金インゴット | 砂 ➔ ガラス | 生の肉 ➔ ステーキ
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
