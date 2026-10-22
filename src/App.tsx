import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { BLOCKS, BLOCK_DEFS, BlockId, ITEMS } from './blocks';
import { buildGameTextures, TextureAtlas } from './textures';
import { VoxelWorld, BEDROCK_Y } from './world';
import { MobManager } from './mobs';
import { sound } from './audio';
import { GameMode, Achievement } from './types';
import { CRAFTING_RECIPES, matchRecipe } from './recipes';
import { ShaderEnvironment } from './environment';
import { gameStorage, type GameStorage } from './storage';
import { SAVE_VERSION, type GameSave } from './save';
import { useItems } from './useItems';
import { clickInventory, clickCraftCell, craftGrid, quickCraft, insertStack, stack, returnCursor, ensureFurnace, clickFurnaceSlot, collectFurnace, wearTool, ensureChest, clickChest, collectChestSlot, quickMoveInventory } from './items';
import { consumeSlot, stepFurnace } from './furnace';
import { miningRule, toolSignature } from './mining';
import { ItemMenu } from './ItemMenu';
import { TouchControls } from './TouchControls';
import { bindGameMouse } from './mouseInput';
import { FixedStepper, GameSession, findSafeSpawn, resetPlayerView, normalizeYaw } from './simulation';
import { disposeObjects } from './resources';
import { bodyBox, mobHeight } from './combat';
import { GameDialog } from './Dialog';
import { viewFog } from './environmentSettings';
import { movePlayer, WALK_SPEED, SPRINT_SPEED, SNEAK_SPEED } from './playerMotion';
import { SurvivalHud } from './SurvivalHud';
import { CleanupScope } from './lifecycle';
import {
  Volume2,
  VolumeX,
  Settings,
  HelpCircle,
  Sparkles,
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

export default function App({ storage = gameStorage }: { storage?: GameStorage }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [initialization, setInitialization] = useState(0);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const initializationFailureRef = useRef<((error: unknown) => void) | null>(null);
  const recoverySnapshotRef = useRef<GameSave | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [storageStatus, setStorageStatus] = useState('保存データを確認中…');
  const persistenceRef = useRef({ initialized: false, canWrite: false, busy: false, lastSavedAt: null as number | null });

  // Game UI States
  const sessionRef = useRef(new GameSession());
  const [isDead, setIsDead] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const playingRef = useRef(false);
  const setPlaying = useCallback((value: boolean) => {
    if (value) sessionRef.current.play(); else sessionRef.current.pause();
    const active = sessionRef.current.phase === 'playing';
    playingRef.current = active; setIsPlaying(active);
  }, []);
  const [touchEnabled, setTouchEnabled] = useState(() => window.matchMedia('(pointer: coarse)').matches);
  const touchEnabledRef = useRef(touchEnabled);
  touchEnabledRef.current = touchEnabled;
  const touchMoveRef = useRef({ x: 0, z: 0 });
  const primaryHeldRef = useRef(false);
  const [miningView, setMiningView] = useState({ percent: 0, label: '' });
  const [itemMessage, setItemMessage] = useState('');
  const [activeChestKey, setActiveChestKey] = useState<string | null>(null);
  const [activeFurnaceKey, setActiveFurnaceKey] = useState<string | null>(null);
  const { items, itemsRef, updateItems, publishItems } = useItems();
  const { inventory, cursorItem } = items;
  const [gameMode, setGameMode] = useState<GameMode>('survival');
  const [activeSlot, setActiveSlot] = useState(0); // 0 - 8
  const [health, setHealthView] = useState(20);
  const setHealth = (value: React.SetStateAction<number>) => { const state = sessionRef.current; state.health = typeof value === 'function' ? value(state.health) : value; }; // 0 - 20 (10 hearts)
  const [hunger, setHungerView] = useState(20);
  const setHunger = (value: React.SetStateAction<number>) => { const state = sessionRef.current; state.hunger = typeof value === 'function' ? value(state.hunger) : value; }; // 0 - 20 (10 drumsticks)
  const [oxygen, setOxygenView] = useState(10);
  const setOxygen = (value: React.SetStateAction<number>) => { const state = sessionRef.current; state.oxygen = typeof value === 'function' ? value(state.oxygen) : value; }; // 0 - 10 (10 bubbles underwater)
  const [isUnderwater, setIsUnderwater] = useState(false);
  const [timeString, setTimeString] = useState('12:00');
  const [coords, setCoords] = useState({ x: 0, y: 10, z: 0, biome: 'plains' });
  const [targetBlockName, setTargetBlockName] = useState<string | null>(null);

  // Active Screen Menus: null | 'inventory' | 'workbench' | 'furnace' | 'chest' | 'settings' | 'help'
  const [openModal, setOpenModal] = useState<string | null>(null);

  // Water physics timers & tracking
  const wasInWaterRef = useRef(false);
  const swimSoundTimerRef = useRef(0);
  const drownTimerRef = useRef(0);

  // Settings
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [fov, setFov] = useState(75);
  const [renderDist, setRenderDist] = useState(2);
  const [peaceful, setPeaceful] = useState(false);

  // Toast / Achievement notification
  const [toastMessage, setToastMessage] = useState<{ title: string; desc: string; icon: string } | null>(null);
  const [achievements, setAchievements] = useState<Achievement[]>(INITIAL_ACHIEVEMENTS);

  const stepSoundRef = useRef(0);
  const [showDebug, setShowDebug] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Synchronized refs for event handlers (avoids stale closures during PointerLock)
  const activeSlotRef = useRef(activeSlot);
  activeSlotRef.current = activeSlot;
  const gameModeRef = useRef(gameMode);
  gameModeRef.current = gameMode;
  const openModalRef = useRef(openModal);
  openModalRef.current = openModal;
  const setModal = useCallback((value: string | null) => { openModalRef.current = value; setOpenModal(value); }, []);

  // The save callback reads the latest committed UI snapshot, not the initialization closure.
  const saveUi = {
    activeSlot,
    achievements: achievements.filter(a => a.unlocked).map(a => a.id),
    settings: { gameMode, soundEnabled, musicEnabled, fov, renderDist, peaceful },
    health, hunger, oxygen,
  };
  const saveUiRef = useRef(saveUi);
  saveUiRef.current = saveUi;

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
    moveState: { forward: boolean; backward: boolean; left: boolean; right: boolean; jump: boolean; sprint: boolean; sneak: boolean };
    player: {
      velocity: THREE.Vector3;
      onGround: boolean;
      height: number;
      radius: number;
      flying: boolean;
      fallDistance: number;
    };
    timeOfDay: number;
    breakProgress: {
      pos: THREE.Vector3 | null;
      stage: number;
      timer: number;
      maxDuration: number;
      signature: string;
    };
    isNight: boolean;
  } | null>(null);

  const captureCurrentGame = useCallback((): GameSave | null => {
    const refs = threeRefs.current;
    if (!refs) return null;
    const persistence = persistenceRef.current;
    const ui = { ...saveUiRef.current, health: sessionRef.current.health, hunger: sessionRef.current.hunger, oxygen: sessionRef.current.oxygen };
    const { health, hunger, oxygen, ...rest } = ui;
    return structuredClone({
      ...rest,
      ...itemsRef.current,
      version: SAVE_VERSION,
      savedAt: Math.max(Date.now(), (persistence.lastSavedAt ?? 0) + 1),
      world: refs.world.exportSaveData(),
      primedTnt: refs.world.primedTnt,
      player: {
        position: refs.camera.position.toArray() as [number, number, number],
        rotation: [refs.camera.rotation.x, normalizeYaw(refs.camera.rotation.y), refs.camera.rotation.z],
        health, hunger, oxygen, flying: refs.player.flying,
      },
      timeOfDay: ((refs.timeOfDay % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2),
      drops: refs.mobManager.droppedItems.filter(d => d.life > 0).map(d => ({
        itemId: d.itemId, count: d.count, durability: d.durability,
        position: d.position.toArray() as [number, number, number],
        velocity: d.velocity.toArray() as [number, number, number], life: d.life,
      })),
    });
  }, []);

  const saveCurrentGame = useCallback(async () => {
    const persistence = persistenceRef.current;
    const refs = threeRefs.current;
    if (!refs || !persistence.initialized || !persistence.canWrite || persistence.busy) return;
    if (sessionRef.current.health <= 0) return;
    persistence.busy = true;
    setIsSaving(true);
    try {
      const snapshot = captureCurrentGame();
      if (!snapshot) return;
      await storage.save(snapshot, persistence.lastSavedAt);
      persistence.lastSavedAt = snapshot.savedAt;
      setStorageError(false);
      setStorageStatus(`保存しました（${new Date(snapshot.savedAt).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo' })}）`);
    } catch (error) {
      setStorageError(true);
      setStorageStatus(error instanceof Error ? error.message : '保存できませんでした。進行はこの画面に保持しています。');
    } finally {
      persistence.busy = false;
      setIsSaving(false);
    }
  }, []);

  useEffect(() => {
    if (!isReady) return;
    const interval = window.setInterval(() => { void saveCurrentGame(); }, 30_000);
    const onHidden = () => { if (document.hidden) void saveCurrentGame(); };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [isReady, saveCurrentGame]);

  useEffect(() => {
    if (openModal) void saveCurrentGame();
  }, [openModal, saveCurrentGame]);

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

  // Main Three.js Initialization
  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;

    const scope = new CleanupScope();
    let disposed = false;
    let failed = false;
    let animId = 0;
    setIsReady(false);
    const fail = (error: unknown) => {
      if (disposed || failed) return;
      failed = true;
      if (persistenceRef.current.initialized) {
        try { recoverySnapshotRef.current = captureCurrentGame(); } catch {}
      }
      persistenceRef.current.initialized = false;
      resetControls(); setPlaying(false); setModal(null);
      threeRefs.current?.controls.unlock();
      cancelAnimationFrame(animId);
      setIsReady(false);
      setFatalError(error instanceof Error ? error.message : '描画またはワールドの準備に失敗しました。');
    };
    initializationFailureRef.current = fail;
    const cleanup = () => {
      disposed = true;
      persistenceRef.current.initialized = false;
      cancelAnimationFrame(animId);
      sound.stopMusic(); scope.dispose(); threeRefs.current = null; initializationFailureRef.current = null;
    };
    try {
      // 1. Scene, Camera, Renderer
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x87ceeb);
      scene.fog = new THREE.Fog(0x87ceeb, 18, 38);

      const camera = new THREE.PerspectiveCamera(fov, window.innerWidth / window.innerHeight, 0.1, 1000);
      camera.position.set(8, 12, 8);
      camera.rotation.order = 'YXZ';

      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
      scope.own(() => renderer.dispose());
      scope.own(() => disposeObjects([...scene.children], true));
      const contextLost = (event: Event) => {
        event.preventDefault(); fail(new Error('描画が中断されました。進行はメモリに保持しています。「再試行」で画面を作り直せます。'));
      };
      canvas.addEventListener('webglcontextlost', contextLost);
      scope.own(() => canvas.removeEventListener('webglcontextlost', contextLost));
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;

      // 2. High Fidelity Shader Environment (Volumetric Clouds, Sun/Moon Corona, Starfield, Dynamic GI)
      const environment = new ShaderEnvironment(scene, camera);

      // 3. PointerLockControls
      const controls = new PointerLockControls(camera, canvas);
      scope.own(() => controls.dispose());

      controls.addEventListener('lock', () => {
        setItemMessage('');
        setPlaying(true);
        setModal(null);
        sound.unlock();
      });

      controls.addEventListener('unlock', () => {
        if (!touchEnabledRef.current) setPlaying(false);
        resetControls();
      });

      // 4. Texture Atlas & World
      const atlas = buildGameTextures();
      scope.own(() => { for (const texture of new Set([...Object.values(atlas.textures), ...atlas.crackTextures])) texture.dispose(); });
      const world = new VoxelWorld(scene, atlas);
      scope.own(() => world.dispose());
      const mobManager = new MobManager(scene, world);
      scope.own(() => mobManager.dispose());


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
        moveState: { forward: false, backward: false, left: false, right: false, jump: false, sprint: false, sneak: false },
        player: {
          velocity: new THREE.Vector3(),
          onGround: false,
          height: 1.62,
          radius: 0.32,
          flying: false,
          fallDistance: 0,
        },
        timeOfDay: Math.PI / 2, // Noon
        breakProgress: {
          pos: null as THREE.Vector3 | null,
          stage: 0,
          timer: 0,
          maxDuration: 0.5,
          signature: '',
        },
        isNight: false,
      };
      threeRefs.current = refs;
      world.onBlockRemoved = (x, y, z, type) => {
        const key = world.getKey(x, y, z), state = itemsRef.current;
        const furnace = type === BLOCKS.FURNACE ? state.furnaces[key] : null;
        const chest = type === BLOCKS.CHEST ? state.chests[key] : null;
        if (!furnace && !chest) return;
        const contents = furnace ? [furnace.input, furnace.fuel, furnace.output] : chest!;
        for (const value of contents) if (value.itemId) mobManager.spawnDroppedItem(value.itemId, value.count, new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5), value.durability);
        updateItems(state => {
          const furnaces = { ...state.furnaces }, chests = { ...state.chests };
          delete furnaces[key]; delete chests[key]; return { ...state, furnaces, chests };
        });
      };
      const initializeSave = async () => {
        let restored: GameSave | null = null;
        try {
          const recovery = recoverySnapshotRef.current;
          restored = recovery ?? await storage.load();
          if (disposed || failed) return;
          if (!recovery) {
            persistenceRef.current.canWrite = true;
            persistenceRef.current.lastSavedAt = restored?.savedAt ?? null;
          }
        } catch (error) {
          if (disposed || failed) return;
          // A failed load must never replace an existing save with a fresh world.
          persistenceRef.current.canWrite = false;
          setStorageError(true);
          setStorageStatus(`${error instanceof Error ? error.message : '保存データを読み込めませんでした。'} 保存を停止しています。再読み込みして確認してください。`);
        }
        if (disposed || failed) return;
        if (restored) {
          world.importSaveData(restored.world);
          world.renderDistance = restored.settings.renderDist;
          camera.fov = restored.settings.fov; camera.updateProjectionMatrix();
          camera.position.fromArray(restored.player.position);
          camera.rotation.set(restored.player.rotation[0], restored.player.rotation[1], 0, 'YXZ');
          world.primedTnt = restored.primedTnt;
          refs.timeOfDay = restored.timeOfDay;
          refs.player.flying = restored.settings.gameMode === 'creative' && restored.player.flying;
          setHealth(restored.player.health);
          setHunger(restored.player.hunger);
          setOxygen(restored.player.oxygen);
          updateItems(() => ({ inventory: restored.inventory, cursorItem: restored.cursorItem,
            craft2x2: restored.craft2x2, craft3x3: restored.craft3x3,
            furnaces: restored.furnaces, legacyFurnace: restored.legacyFurnace,
            chests: restored.chests, legacyChest: restored.legacyChest }));
          setActiveSlot(restored.activeSlot);
          setAchievements(INITIAL_ACHIEVEMENTS.map(a => ({ ...a, unlocked: restored.achievements.includes(a.id) })));
          setGameMode(restored.settings.gameMode);
          setSoundEnabled(restored.settings.soundEnabled);
          setMusicEnabled(restored.settings.musicEnabled);
          setFov(restored.settings.fov);
          setRenderDist(restored.settings.renderDist);
          setPeaceful(restored.settings.peaceful);
          for (const drop of restored.drops) {
            mobManager.spawnDroppedItem(drop.itemId, drop.count, new THREE.Vector3(...drop.position), drop.durability);
            const entity = mobManager.droppedItems[mobManager.droppedItems.length - 1];
            entity.position.fromArray(drop.position);
            entity.velocity.fromArray(drop.velocity);
            entity.life = drop.life;
          }
          setStorageStatus(`続きから再開できます（${new Date(restored.savedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}）`);
        } else {
          camera.position.copy(findSafeSpawn(world));
          if (persistenceRef.current.canWrite) setStorageStatus('30秒ごとに自動保存します。設定画面から手動でも保存できます。');
        }
        world.updateChunks(camera.position);
        // Earlier saves placed the eye only 2.5 blocks above terrain, embedding the feet.
        // Lift only an overlapping player, so normal saved positions remain untouched.
        for (let attempt = 0; attempt < 64; attempt++) {
          let floor = -Infinity;
          for (let x = Math.floor(camera.position.x - refs.player.radius); x <= Math.floor(camera.position.x + refs.player.radius); x++) {
            for (let z = Math.floor(camera.position.z - refs.player.radius); z <= Math.floor(camera.position.z + refs.player.radius); z++) {
              for (let y = Math.floor(camera.position.y - refs.player.height); y <= Math.floor(camera.position.y + 0.1); y++) {
                const block = world.getBlock(x, y, z);
                if (block && BLOCK_DEFS[block]?.isSolid) floor = Math.max(floor, y + 1);
              }
            }
          }
          if (!Number.isFinite(floor)) break;
          camera.position.y = floor + refs.player.height + 0.01;
        }
        const { biome } = world.getTerrainHeight(camera.position.x, camera.position.z);
        setCoords({ x: Math.floor(camera.position.x), y: Math.floor(camera.position.y), z: Math.floor(camera.position.z), biome });
        const hours = Math.floor(((refs.timeOfDay / (Math.PI * 2)) * 24 + 6) % 24);
        const minutes = Math.floor((refs.timeOfDay / (Math.PI * 2)) * 24 * 60 % 60);
        setTimeString(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`);
        environment.update(0, refs.timeOfDay, camera.position);
        if (scene.fog instanceof THREE.Fog) Object.assign(scene.fog, viewFog(world.renderDistance));
        persistenceRef.current.initialized = true;
        clock.getDelta();
        recoverySnapshotRef.current = null;
        setFatalError(null);
        setIsReady(true);
      };
      void initializeSave().catch(fail);

      // Window Resize Handler
      const handleResize = () => {
        try {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        } catch (error) { fail(error); }
      };
      window.addEventListener('resize', handleResize);
      scope.own(() => window.removeEventListener('resize', handleResize));

      // Main Game Animation Loop
      let uiTimer = 0;
      const stepper = new FixedStepper();

      const animate = () => {
        if (disposed || failed) return;
        try {
          animId = requestAnimationFrame(animate);
          const delta = Math.min(clock.getDelta(), 0.08);

          const ready = persistenceRef.current.initialized && !document.hidden;
          const active = ready && playingRef.current && !openModalRef.current;
          stepper.advance(delta, active, dt => {
            if (!playingRef.current) return;
            sessionRef.current.advance(dt);
            updateItems(state => {
              let changed = false;
              const furnaces = { ...state.furnaces };
              for (const [key, furnace] of Object.entries(furnaces)) {
                const next = stepFurnace(furnace, dt);
                if (next !== furnace) { furnaces[key] = next; changed = true; }
              }
              return changed ? { ...state, furnaces } : state;
            }, false);
            refs.world.updateTnt(dt);
            updateGame(dt, refs);
            if (playingRef.current) processPrimary(dt, refs);
          });
          uiTimer += delta;
          if (uiTimer >= 0.1) {
            uiTimer = 0;
            publishItems();
            setHealthView(sessionRef.current.health); setHungerView(sessionRef.current.hunger); setOxygenView(sessionRef.current.oxygen);
            const { biome } = world.getTerrainHeight(camera.position.x, camera.position.z);
            const x = Math.floor(camera.position.x), y = Math.floor(camera.position.y), z = Math.floor(camera.position.z);
            setCoords(previous => previous.x === x && previous.y === y && previous.z === z && previous.biome === biome ? previous : { x, y, z, biome });
            const hours = Math.floor(((refs.timeOfDay / (Math.PI * 2)) * 24 + 6) % 24);
            const minutes = Math.floor((refs.timeOfDay / (Math.PI * 2)) * 24 * 60 % 60);
            setTimeString(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`);
            const progress = refs.breakProgress;
            const percent = progress.pos ? Math.min(100, progress.timer / progress.maxDuration * 100) : 0;
            const label = miningHintRef.current;
            setMiningView(previous => previous.percent === percent && previous.label === label ? previous : { percent, label });
          }

          renderer.render(scene, camera);
        } catch (error) { fail(error); }
      };
      animate();

    } catch (error) { fail(error); scope.dispose(); }
    return cleanup;
  }, [initialization]);

  // Update FOV & Render Distance dynamically
  useEffect(() => {
    if (threeRefs.current && persistenceRef.current.initialized) {
      try {
        threeRefs.current.camera.fov = fov;
        threeRefs.current.camera.updateProjectionMatrix();
        threeRefs.current.world.renderDistance = renderDist;
        if (threeRefs.current.scene.fog instanceof THREE.Fog) {
          Object.assign(threeRefs.current.scene.fog, viewFog(renderDist));
        }
        threeRefs.current.world.updateChunks(threeRefs.current.camera.position);
      } catch (error) { initializationFailureRef.current?.(error); }
    }
  }, [fov, renderDist, isReady]);

  // Sound settings sync
  useEffect(() => {
    sound.soundEnabled = soundEnabled;
    sound.musicEnabled = musicEnabled;
  }, [soundEnabled, musicEnabled]);

  useEffect(() => {
    if (gameMode !== 'creative' && threeRefs.current) {
      threeRefs.current.player.flying = false;
      threeRefs.current.player.velocity.set(0, 0, 0);
    }
  }, [gameMode]);

  // Input and item transactions share one state, including the save snapshot.
  const miningHintRef = useRef('');
  const resetControls = useCallback(() => {
    primaryHeldRef.current = false;
    touchMoveRef.current = { x: 0, z: 0 };
    miningHintRef.current = '';
    const refs = threeRefs.current;
    if (!refs) return;
    Object.assign(refs.moveState, { forward: false, backward: false, left: false, right: false, jump: false, sprint: false, sneak: false });
    // Pausing clears held input, while the suspended simulation retains fall momentum.
    refs.breakProgress.pos = null;
    refs.breakProgress.timer = 0;
    refs.world.setCrackStage(null, -1);
  }, []);
  const beginPlay = useCallback(() => {
    const refs = threeRefs.current;
    const canvas = canvasRef.current;
    if (!refs || !canvas || !persistenceRef.current.initialized || sessionRef.current.phase === 'dead') return;
    try { sound.unlock(); } catch { setItemMessage('音声を開始できませんでした。操作は続けられます。'); }
    if (touchEnabledRef.current) { setItemMessage(''); setPlaying(true); }
    else {
      const failed = () => setItemMessage('視点操作を開始できません。「タッチ操作」をONにするとドラッグでも操作できます。');
      try { void Promise.resolve(canvas.requestPointerLock()).catch(failed); } catch { failed(); }
    }
  }, []);
  const openMenu = useCallback((menu: string) => {
    if (sessionRef.current.phase === 'dead') return;
    resetControls(); setPlaying(false);
    threeRefs.current?.controls.unlock();
    setModal(menu); setItemMessage('');
  }, []);
  const handlePickupItem = useCallback((itemId: string, count: number, durability?: number): number => {
    const result = insertStack(itemsRef.current.inventory, stack(itemId, count, durability));
    if (result.accepted) {
      updateItems(state => ({ ...state, inventory: result.inventory }));
      if (itemId === 'wood') unlockAchievement('wood');
      if (itemId === 'iron_ingot') unlockAchievement('iron');
    }
    return result.accepted;
  }, [unlockAchievement]);
  const closeMenu = useCallback(() => {
    const next = updateItems(returnCursor);
    setItemMessage(next.cursorItem ? '所持品が満杯です。持ち運び中の品は保持しています。' : '');
    setModal(null);
    void saveCurrentGame();
    beginPlay();
  }, []);

  useEffect(() => {
    const pause = () => { resetControls(); setPlaying(false); threeRefs.current?.controls.unlock(); };
    const hidden = () => { if (document.hidden) pause(); };
    const failed = () => { setPlaying(false); setItemMessage('視点操作を開始できません。「タッチ操作」をONにするとマウスのドラッグでも操作できます。'); };
    window.addEventListener('blur', pause);
    document.addEventListener('visibilitychange', hidden);
    document.addEventListener('pointerlockerror', failed);
    return () => {
      window.removeEventListener('blur', pause);
      document.removeEventListener('visibilitychange', hidden);
      document.removeEventListener('pointerlockerror', failed);
    };
  }, []);

  useEffect(() => { threeRefs.current?.mobManager.setPeaceful(peaceful); }, [peaceful]);

  const handlePlayerDamage = useCallback((dmg: number, source: string) => {
    const session = sessionRef.current, refs = threeRefs.current;
    if (!refs || !session.damage(dmg, source, gameModeRef.current === 'creative')) return;
    sound.playHurt(false);
    if (session.phase === 'dead') {
      resetControls(); setPlaying(false); setModal(null); setIsDead(true); refs.controls.unlock();
      setHealthView(0);
    } else refs.camera.rotation.z += (Math.random() - 0.5) * 0.12;
  }, []);
  const respawnPlayer = () => {
    const refs = threeRefs.current;
    if (!refs || sessionRef.current.phase !== 'dead') return;
    const position = findSafeSpawn(refs.world);
    refs.camera.position.copy(position); resetPlayerView(refs.camera, refs.player); resetControls();
    refs.player.fallDistance = 0;
    drownTimerRef.current = 0; swimSoundTimerRef.current = 0; wasInWaterRef.current = false;
    setIsUnderwater(false); sessionRef.current.respawn(); setIsDead(false);
    setHealthView(20); setHungerView(20); setOxygenView(10);
    refs.mobManager.setPeaceful(true); // Clear nearby threats and hostile projectiles at respawn.
    refs.world.updateChunks(position); beginPlay();
  };

  // Core Physics & Simulation Frame Update
  const updateGame = (delta: number, refs: NonNullable<typeof threeRefs.current>) => {
    const { camera, world, mobManager, player, moveState, environment } = refs;

    // 1. Day / Night Celestial Cycle & Shader Environment Update
    camera.rotation.z *= Math.exp(-12 * delta);
    refs.timeOfDay = (refs.timeOfDay + delta * 0.015) % (Math.PI * 2);
    const sunAngle = refs.timeOfDay;
    const sunY = Math.sin(sunAngle);
    const isNight = sunY < 0;
    refs.isNight = isNight;

    environment.update(delta, refs.timeOfDay, camera.position);
    world.animateWater(delta);

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
    const creative = gameModeRef.current === 'creative';
    const sprinting = moveState.sprint && !moveState.sneak && (creative || sessionRef.current.hunger > 6);
    const speed = player.flying ? (sprinting ? 16 : 10) : inWater ? 2.2 : moveState.sneak ? SNEAK_SPEED : sprinting ? SPRINT_SPEED : WALK_SPEED;

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
      if (moveState.sneak) {
        // Sneak dives downward
        player.velocity.y = Math.max(player.velocity.y - 12.0 * delta, -3.8);
      }
    } else {
      const gravity = player.flying ? 0 : 32.0;
      player.velocity.y = Math.max(-30, player.velocity.y - gravity * delta);
      if (player.flying) {
        player.velocity.y -= player.velocity.y * 8.0 * delta;
      }
    }

    // Yaw-only basis: looking vertically never reverses horizontal movement.
    const yaw = camera.rotation.y;
    const inputX = Number(moveState.right) - Number(moveState.left) + touchMoveRef.current.x;
    const inputZ = Number(moveState.forward) - Number(moveState.backward) - touchMoveRef.current.z;
    const magnitude = Math.max(1, Math.hypot(inputX, inputZ));
    const desiredX = (inputX * Math.cos(yaw) - inputZ * Math.sin(yaw)) / magnitude * speed;
    const desiredZ = (-inputX * Math.sin(yaw) - inputZ * Math.cos(yaw)) / magnitude * speed;
    const blend = 1 - Math.exp(-12 * delta);
    player.velocity.x += (desiredX - player.velocity.x) * blend;
    player.velocity.z += (desiredZ - player.velocity.z) * blend;
    const moving = Math.hypot(player.velocity.x, player.velocity.z) > 0.2;
    if (moving && player.onGround && !inWater && !moveState.sneak) {
      stepSoundRef.current += Math.hypot(player.velocity.x, player.velocity.z) * delta;
      if (stepSoundRef.current >= 1.8) { stepSoundRef.current %= 1.8; sound.playStep('grass'); }
    }
    if (!creative) sessionRef.current.survival(delta, moving ? Math.hypot(player.velocity.x, player.velocity.z) : 0, sprinting, handlePlayerDamage);
    if (player.flying) player.velocity.y = moveState.jump ? 8 : moveState.sneak ? -8 : 0;
    else if (!inWater && moveState.jump && player.onGround) {
      player.velocity.y = 9;
      if (!creative) sessionRef.current.exhaust(sprinting ? 0.2 : 0.05);
    }
    const beforeY = camera.position.y;
    const wasGrounded = player.onGround;
    player.onGround = movePlayer(world, camera.position, player.velocity, delta, player, moveState.sneak, wasGrounded);
    if (inWater || player.flying) player.fallDistance = 0;
    else {
      player.fallDistance += Math.max(0, beforeY - camera.position.y);
      if (player.onGround) {
        if (player.fallDistance > 3.5) handlePlayerDamage(Math.ceil(player.fallDistance - 3), '落下');
        player.fallDistance = 0;
      }
    }

    // Void fall safety
    if (camera.position.y < BEDROCK_Y - 5) {
      camera.position.set(8, 12, 8);
    camera.rotation.order = 'YXZ';
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
      if (gameModeRef.current !== 'creative') {
        setOxygen(o => Math.max(0, o - delta * 0.5));
        if (sessionRef.current.oxygen <= 0) {
          drownTimerRef.current += delta;
          if (drownTimerRef.current >= 1.2) { handlePlayerDamage(1, '溺死'); drownTimerRef.current = 0; }
        }
      } else { setOxygen(10); drownTimerRef.current = 0; }
      if (Math.random() < 0.04) {
        sound.playBubble();
      }
    } else {
      if (refs.scene.fog instanceof THREE.Fog) {
        refs.scene.fog.color.setHex(isNight ? 0x050b14 : 0x87ceeb);
        Object.assign(refs.scene.fog, viewFog(world.renderDistance));
      }
      setOxygen(10);
      drownTimerRef.current = 0;
    }

    // 6. Update Mobs & Spawns
    if (!playingRef.current) return;
    mobManager.setPeaceful(saveUiRef.current.settings.peaceful);
    mobManager.update(delta, camera.position, handlePlayerDamage, handlePickupItem, isNight);
    mobManager.handleSpawning(camera.position, isNight, saveUiRef.current.settings.peaceful, delta);

    // 7. Raycasting for Target Block / Face
    updateTargetBlock(refs);


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
      if (!persistenceRef.current.initialized || sessionRef.current.phase === 'dead') return;
      if (e.repeat && ['KeyE', 'KeyF', 'KeyR', 'F3', 'Escape'].includes(e.code)) return;
      if (e.code === 'F3') { e.preventDefault(); setShowDebug(value => !value); return; }
      // Toggle inventory with 'E'
      if (e.code === 'KeyE') {
        e.preventDefault();
        if (openModal) {
          closeMenu();
        } else {
          openMenu('inventory');
        }
        return;
      }

      // Escape to open Settings
      if (e.code === 'Escape') {
        if (openModal) {
          closeMenu();
        } else {
          openMenu('settings');
        }
        return;
      }

      const refs = threeRefs.current;
      if (!refs || !playingRef.current || openModalRef.current) return;

      const { moveState, player } = refs;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight'].includes(e.code)) e.preventDefault();
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
        case 'KeyR':
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          e.preventDefault(); moveState.sprint = !moveState.sprint;
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          moveState.sneak = true;
          break;
        case 'Space':
          moveState.jump = true;

          break;
        case 'KeyF':
          // Toggle flight in Creative mode
          if (gameModeRef.current === 'creative') {
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
          selectSlot(Number(e.code.slice(-1)) - 1);
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
        case 'ShiftRight':
          moveState.sneak = false;
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
      if (!playingRef.current) return;
      selectSlot((activeSlotRef.current + (e.deltaY > 0 ? 1 : 8)) % 9);
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

  const selectSlot = (index: number) => {
    activeSlotRef.current = index;
    setActiveSlot(index);
    const progress = threeRefs.current?.breakProgress;
    if (progress) { progress.pos = null; progress.timer = 0; }
  };

  const handleReturnCursor = () => {
    const next = updateItems(returnCursor);
    setItemMessage(next.cursorItem ? '空きが足りません。残りの品は持ったまま保持しています。' : '所持品へ戻しました。');
  };
  const handleSlotClick = (index: number, secondary = false, quick = false) => {
    updateItems(state => quick ? quickMoveInventory(state, index, openModalRef.current === 'chest' ? activeChestKey : null, openModalRef.current === 'furnace' ? activeFurnaceKey : null) : clickInventory(state, index, secondary)); sound.playPop(); setItemMessage('');
  };
  const handleCraftGridClick = (row: number, col: number, size: 2 | 3) => {
    const before = itemsRef.current;
    const next = updateItems(state => clickCraftCell(state, row, col, size, activeSlotRef.current));
    setItemMessage(next === before ? '材料を持って配置してください。道具は材料枠に入れられません。交換する材料の空きも必要です。' : '');
    if (next !== before) sound.playPop();
  };
  const handleCraftTakeResult = (size: 2 | 3) => {
    const before = itemsRef.current;
    const result = matchRecipe(size === 2 ? before.craft2x2 : before.craft3x3, size)?.result;
    const next = updateItems(state => craftGrid(state, size));
    if (!result) { setItemMessage('材料の配置がレシピに一致していません。'); return; }
    if (next === before) { setItemMessage('完成品を入れる空きがありません。材料はそのまま残しています。'); return; }
    sound.playCraft(); setItemMessage('制作しました。');
    if (result.itemId === 'crafting_table') unlockAchievement('workbench');
  };
  const handleQuickCraft = (id: string) => {
    const recipe = CRAFTING_RECIPES.find(r => r.id === id);
    if (!recipe || recipe.gridSize > (openModalRef.current === 'workbench' ? 3 : 2)) return;
    const result = quickCraft(itemsRef.current.inventory, recipe, gameModeRef.current === 'creative');
    if (result.reason) { setItemMessage(result.reason); return; }
    updateItems(state => ({ ...state, inventory: result.inventory }));
    setItemMessage(`${recipe.name}を制作しました。`); sound.playCraft();
    if (id === 'crafting_table') unlockAchievement('workbench');
  };
  const handleFurnaceSlot = (kind: 'input' | 'fuel' | 'output', secondary = false) => {
    if (!activeFurnaceKey) return;
    const before = itemsRef.current;
    const next = updateItems(state => kind === 'output' ? collectFurnace(state, activeFurnaceKey) : clickFurnaceSlot(state, activeFurnaceKey, kind, secondary));
    setItemMessage(next === before ? kind === 'output' ? '回収できません。完成品や所持品の空きを確認してください。' : '所持品を持って、材料には精錬できる品、燃料には石炭・原木・木材・棒を入れてください。' : '');
    if (next !== before) sound.playPop();
    if (kind === 'output' && next !== before) unlockAchievement('furnace');
    if (kind === 'output' && next !== before && next.inventory.some(slot => slot.itemId === 'iron_ingot')) unlockAchievement('iron');
  };

  const useItemAction = useCallback(() => {
    const refs = threeRefs.current;
    if (!refs || !playingRef.current || openModalRef.current) return;
    const index = activeSlotRef.current;
    const slot = itemsRef.current.inventory[index];
    const item = slot.itemId ? ITEMS[slot.itemId] : null;
    const creative = gameModeRef.current === 'creative';
    const { camera, world, mobManager } = refs;
    const consume = (slotIndex: number) => updateItems(state => {
      const inventory = state.inventory.slice(); inventory[slotIndex] = consumeSlot(inventory[slotIndex]);
      return { ...state, inventory };
    });
    const direction = camera.getWorldDirection(new THREE.Vector3());
    const hit = world.raycast(camera.position, direction, 5.5);
    if (hit) {
      const def = BLOCK_DEFS[hit.blockId];
      if (def.isInteractive === 'crafting_table') { openMenu('workbench'); return; }
      if (def.isInteractive === 'furnace') {
        const key = world.getKey(hit.blockPos.x, hit.blockPos.y, hit.blockPos.z);
        updateItems(state => ensureFurnace(state, key)); setActiveFurnaceKey(key);
        openMenu('furnace'); return;
      }
      if (def.isInteractive === 'chest') {
        const key = world.getKey(hit.blockPos.x, hit.blockPos.y, hit.blockPos.z);
        updateItems(state => ensureChest(state, key)); setActiveChestKey(key); openMenu('chest'); return;
      }
      if (def.isInteractive === 'bed') {
        if (refs.isNight) { refs.timeOfDay = Math.PI * 0.45; setHealth(20); unlockAchievement('bed'); sound.playCraft(); }
        return;
      }
    }
    if (item?.foodRestore && slot.count > 0) {
      if (sessionRef.current.hunger >= 20) { setItemMessage('満腹です。満腹度が高いと体力が自然回復します。'); return; }
      if (!creative) consume(index);
      setHunger(h => Math.min(20, h + item.foodRestore!.hunger)); sound.playEat(); return;
    }
    if (item?.toolType === 'bow') {
      if (!sessionRef.current.attack(0.6)) return;
      const arrowIndex = itemsRef.current.inventory.findIndex(s => s.itemId === 'arrow' && s.count > 0);
      if (!creative && arrowIndex < 0) { setItemMessage('矢がありません。'); return; }
      if (!creative) {
        updateItems(state => {
          const inventory = wearTool(state.inventory, index).slice();
          inventory[arrowIndex] = consumeSlot(inventory[arrowIndex]); return { ...state, inventory };
        });
      }
      mobManager.shootArrow(camera.position.clone().addScaledVector(direction, 0.5), direction, true, 26); return;
    }
    if (!hit || !item?.isBlock || !item.blockType || slot.count <= 0) return;
    const place = hit.blockPos.clone().add(hit.normal);
    if (world.getBlock(place.x, place.y, place.z) !== null) { setItemMessage('そこには置けません。アイテムは消費していません。'); return; }
    const min = camera.position.clone().sub(new THREE.Vector3(refs.player.radius, refs.player.height, refs.player.radius));
    const max = camera.position.clone().add(new THREE.Vector3(refs.player.radius, 0.1, refs.player.radius));
    if (min.x < place.x + 1 && max.x > place.x && min.y < place.y + 1 && max.y > place.y && min.z < place.z + 1 && max.z > place.z) return;
    world.addBlock(place.x, place.y, place.z, item.blockType as BlockId);
    if (!creative) consume(index);
    sound.playPlaceBlock();
  }, [unlockAchievement]);

  const processPrimary = (delta: number, refs: NonNullable<typeof threeRefs.current>) => {
    const { world, camera, mobManager, breakProgress: progress } = refs;
    const cancel = () => { progress.pos = null; progress.timer = 0; world.setCrackStage(null, -1); };
    if (!primaryHeldRef.current) { cancel(); miningHintRef.current = ''; return; }
    const index = activeSlotRef.current;
    const slot = itemsRef.current.inventory[index];
    const item = slot.itemId ? ITEMS[slot.itemId] : null;
    const direction = camera.getWorldDirection(new THREE.Vector3());
    const hit = world.raycast(camera.position, direction, 5.5);
    const ray = new THREE.Ray(camera.position, direction);
    let target: { mob: typeof mobManager.mobs[number]; distance: number } | null = null;
    for (const mob of mobManager.mobs) {
      const point = ray.intersectBox(bodyBox(mob.position, mobHeight(mob.type), mob.type === 'spider' ? 0.6 : 0.45), new THREE.Vector3());
      if (!point) continue;
      const distance = point.distanceTo(camera.position);
      if (distance <= 3 && (!hit || distance < hit.distance) && (!target || distance < target.distance)) target = { mob, distance };
    }
    if (target) {
      cancel(); miningHintRef.current = '';
      if (!sessionRef.current.attack()) return;
      const mob = target.mob;
      const killed = mobManager.hurtMob(mob, item?.damage ?? 1, mob.position.clone().sub(camera.position));
      if (gameModeRef.current !== 'creative') updateItems(state => ({ ...state, inventory: wearTool(state.inventory, index) }));
      if (killed && mob.isHostile) unlockAchievement('hunter');
      sound.playSwing(); return;
    }
    if (!hit) { cancel(); miningHintRef.current = ''; return; }
    const rule = miningRule(hit.blockId, slot, gameModeRef.current === 'creative');
    if (!rule.allowed) { cancel(); miningHintRef.current = rule.reason; return; }
    miningHintRef.current = `${BLOCK_DEFS[hit.blockId].name}を採掘中`;
    const signature = toolSignature(index, slot);
    if (!progress.pos?.equals(hit.blockPos) || progress.signature !== signature) {
      progress.pos = hit.blockPos.clone(); progress.timer = 0; progress.signature = signature;
      sound.playHitBlock();
    }
    progress.maxDuration = rule.seconds;
    progress.timer += delta;
    world.setCrackStage(hit.blockPos, Math.min(4, Math.floor(progress.timer / rule.seconds * 5)));
    if (progress.timer + 1e-9 < rule.seconds) return;
    const removed = world.removeBlock(hit.blockPos.x, hit.blockPos.y, hit.blockPos.z, true);
    cancel();
    if (!removed) return;
    if (gameModeRef.current !== 'creative') updateItems(state => ({ ...state, inventory: wearTool(state.inventory, index) }));
    if (removed === BLOCKS.TNT) {
      sound.playCreeperHiss();
      if (world.primeTnt(hit.blockPos.x, hit.blockPos.y, hit.blockPos.z)) unlockAchievement('tnt');
      else mobManager.spawnDroppedItem('tnt', 1, hit.blockPos.clone().addScalar(0.5));
      return;
    }
    if (gameModeRef.current !== 'creative') {
      for (const drop of BLOCK_DEFS[removed].drops) {
        if (drop.chance === undefined || Math.random() < drop.chance) mobManager.spawnDroppedItem(drop.itemId, drop.count, hit.blockPos.clone().addScalar(0.5));
      }
    }
    if (removed === BLOCKS.WOOD) unlockAchievement('wood');
    if (removed === BLOCKS.STONE && item?.toolType === 'pickaxe') unlockAchievement('pickaxe');
    sound.playBreakBlock();
  };

  const handleTouchMove = useCallback((x: number, z: number) => { touchMoveRef.current = { x, z }; }, []);
  const handleTouchLook = useCallback((dx: number, dy: number) => {
    const refs = threeRefs.current;
    if (!refs || !playingRef.current) return;
    refs.camera.rotation.order = 'YXZ';
    refs.camera.rotation.y = normalizeYaw(refs.camera.rotation.y - dx * 0.004);
    refs.camera.rotation.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, refs.camera.rotation.x - dy * 0.004));
  }, []);
  const handleTouchMine = useCallback((held: boolean) => { primaryHeldRef.current = held && playingRef.current; }, []);
  const handleTouchJump = useCallback((held: boolean) => { if (threeRefs.current) threeRefs.current.moveState.jump = held; }, []);
  const handleTouchSneak = useCallback((held: boolean) => { if (threeRefs.current) threeRefs.current.moveState.sneak = held; }, []);
  const handleTouchSprint = useCallback((held: boolean) => { if (threeRefs.current) threeRefs.current.moveState.sprint = held; }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return bindGameMouse(canvas, window,
      () => playingRef.current && !openModalRef.current,
      held => { primaryHeldRef.current = held; }, useItemAction);
  }, [useItemAction, initialization]);


  return (
    <div
      className="voxel-game relative w-full h-[100dvh] overflow-hidden bg-black select-none text-white font-sans"
      onContextMenu={(e) => e.preventDefault()}
      onMouseMove={(e) => { if (itemsRef.current.cursorItem && openModalRef.current && !touchEnabledRef.current) setMousePos({ x: e.clientX, y: e.clientY }); }}
    >
      {/* 3D WebGL Canvas */}
      <canvas key={initialization} ref={canvasRef} className="w-full h-full block cursor-crosshair touch-none" />

      {fatalError && <div className="game-overlay" style={{ zIndex: 80 }}>
        <section role="alertdialog" aria-modal="true" aria-labelledby="startup-error" className="game-panel max-w-md space-y-4">
          <h2 id="startup-error" className="text-lg font-bold">ゲームを開始・継続できません</h2>
          <p className="text-sm">{fatalError}</p>
          <p className="text-xs text-neutral-300">保存済みのワールドはそのまま残しています。ほかのタブを閉じると改善する場合があります。</p>
          <button autoFocus className="game-button w-full min-h-12" onClick={() => { setFatalError(null); setInitialization(value => value + 1); }}>再試行</button>
        </section>
      </div>}

      {storageError && (
        <div role="alert" className="absolute bottom-36 left-4 right-4 z-30 mx-auto max-w-lg rounded-lg border border-amber-400/40 bg-neutral-950/95 p-3 text-xs text-amber-200 pointer-events-none">
          {storageStatus}
        </div>
      )}

      {touchEnabled && <TouchControls active={isPlaying && !openModal} onMove={handleTouchMove} onLook={handleTouchLook}
        onMine={handleTouchMine} onJump={handleTouchJump} onSprint={handleTouchSprint} onSneak={handleTouchSneak} onUse={useItemAction}
        onMenu={() => openMenu('inventory')} onPause={() => openMenu('settings')}
        onFlight={gameMode === 'creative' ? () => { if (threeRefs.current) { threeRefs.current.player.flying = !threeRefs.current.player.flying; threeRefs.current.player.velocity.y = 0; } } : undefined} />}
      {isPlaying && (miningView.label || itemMessage || cursorItem?.itemId) && <div role="status" className="absolute top-24 sm:top-32 left-1/2 -translate-x-1/2 z-20 pointer-events-none max-w-[90vw] rounded-lg bg-black/75 px-3 py-2 text-xs text-center text-amber-100">
        {miningView.label || itemMessage || (cursorItem?.itemId ? `${ITEMS[cursorItem.itemId].name}×${cursorItem.count}を保持中。持ち物から戻せます。` : '')}
        {miningView.percent > 0 && <progress aria-label="採掘の進み具合" value={miningView.percent} max={100} className="block w-40 max-w-full mt-1 accent-amber-400" />}
      </div>}

      {/* Floating Dragging Cursor Item */}
      {cursorItem && cursorItem.itemId && openModal && !touchEnabled && (
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
      <div className={`${showDebug ? 'block' : 'hidden'} absolute top-4 left-4 z-20 pointer-events-none bg-black/60 backdrop-blur-md px-3.5 py-2.5 rounded-lg border border-white/10 font-mono text-xs shadow-lg space-y-1`}>
        <div className="flex items-center gap-2 text-emerald-400 font-bold tracking-wide">
          <Sparkles className="w-3.5 h-3.5" />
          <span>VOXELVERSE · DEBUG [F3]</span>
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
      <div className="hidden sm:flex absolute top-[max(1rem,env(safe-area-inset-top))] right-[max(1rem,env(safe-area-inset-right))] z-20 items-center gap-2">
        <div className="bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 text-xs font-mono font-semibold uppercase text-emerald-400">
          {gameMode} MODE
        </div>
        <button
          onClick={() => {
            sound.unlock();
            setSoundEnabled(!soundEnabled);
          }}
          className="p-3 min-w-11 min-h-11 bg-black/60 hover:bg-black/80 backdrop-blur-md rounded-lg border border-white/10 text-gray-300 hover:text-white transition"
          title="Toggle Sound"
        >
          {soundEnabled ? <Volume2 className="w-4 h-4 text-emerald-400" /> : <VolumeX className="w-4 h-4 text-rose-400" />}
        </button>
        <button
          onClick={() => {
            openMenu('settings');
          }}
          className="p-3 min-w-11 min-h-11 bg-black/60 hover:bg-black/80 backdrop-blur-md rounded-lg border border-white/10 text-gray-300 hover:text-white transition"
          title="Settings / Pause"
        >
          <Settings className="w-4 h-4" />
        </button>
        <button
          onClick={() => {
            openMenu('help');
          }}
          className="p-3 min-w-11 min-h-11 bg-black/60 hover:bg-black/80 backdrop-blur-md rounded-lg border border-white/10 text-gray-300 hover:text-white transition"
          title="Help & Controls"
        >
          <HelpCircle className="w-4 h-4" />
        </button>
      </div>

      {/* Achievement / Toast Popup */}
      {toastMessage && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 bg-gradient-to-r from-amber-600/90 to-yellow-500/90 backdrop-blur-md border-2 border-yellow-300 px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3 motion-reduce:animate-none">
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

      <SurvivalHud inventory={inventory} activeSlot={activeSlot} health={health} hunger={hunger} oxygen={oxygen}
        underwater={isUnderwater} creative={gameMode === 'creative'} textures={threeRefs.current?.atlas.dataUrls ?? {}}
        onSelect={selectSlot} playing={isPlaying} mining={miningView.percent > 0} />

      {/* Start / Pause Blocker Screen */}
      {isDead && <div className="absolute inset-0 z-50 bg-black/85 flex items-center justify-center p-4">
        <section role="dialog" aria-modal="true" aria-labelledby="death-title" className="max-w-sm w-full bg-neutral-900 p-6 rounded-2xl text-center space-y-4">
          <h2 id="death-title" className="text-xl font-bold text-rose-300">倒れました</h2>
          <p className="text-sm">{sessionRef.current.deathReason}。所持品は保持しています。</p>
          <button autoFocus onClick={respawnPlayer} className="min-h-12 w-full bg-emerald-500 text-black font-bold rounded-lg">安全な場所にリスポーン</button>
        </section>
      </div>}
      {!isPlaying && !isDead && !openModal && (
        <div className="absolute inset-0 z-40 bg-black/75 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center">
          <div className="game-panel max-w-md w-full space-y-5">
            <div className="space-y-2">
              <h1 className="text-3xl font-black tracking-wider text-emerald-400">VOXELVERSE</h1>
              <p className="text-xs text-neutral-400 font-mono">3D VOXEL SANDBOX &amp; SURVIVAL</p>
            </div>

            <p className="text-sm text-neutral-300 leading-relaxed">
              資源採掘、ツール制作、クラフト、夜のモンスターとの戦闘、そして自由な建築が楽しめるボクセルサバイバル。
            </p>

            <button
              onClick={() => {
                beginPlay();
              }}
              disabled={!isReady}
              className="game-button w-full min-h-12 disabled:opacity-50"
            >
              {isReady ? 'ゲームを開始 / 再開' : 'ワールドを準備中…'}
            </button>

            <p role="status" className={`text-xs leading-relaxed ${storageError ? 'text-amber-300' : 'text-neutral-400'}`}>
              {storageStatus}
            </p>
            {cursorItem?.itemId && <p className="text-xs text-amber-300">持ち運び中のアイテムも復元しました。[E]でインベントリを開いて戻せます。</p>}

            <button onClick={() => { resetControls(); setTouchEnabled(value => !value); }} className="min-h-11 px-4 rounded-lg border border-white/20 text-sm">タッチ操作: {touchEnabled ? 'ON' : 'OFF'}</button>
            {itemMessage && <p role="status" className="text-xs text-amber-200">{itemMessage}</p>}
            {touchEnabled && <p className="text-xs text-neutral-300">左スティックで移動、右側をドラッグで視点操作。採掘は長押し。下のホットバーをタップして装備を選びます。</p>}
            {/* Quick Controls Cheat Sheet */}
            <div className="text-xs text-neutral-400 grid grid-cols-2 gap-2 text-left bg-black/40 p-4 rounded-xl border border-white/5 font-mono">
              <div><b className="text-white">[ W A S D ]</b> 移動</div>
              <div><b className="text-white">[ SPACE ]</b> ジャンプ</div>
              <div><b className="text-white">[ 左長押し ]</b> 破壊 / 攻撃</div>
              <div><b className="text-white">[ 右クリック ]</b> 配置 / 食べる</div>
              <div><b className="text-white">[ E キー ]</b> インベントリ / クラフト</div>
              <div><b className="text-white">[ 1 - 9 ]</b> スロット選択</div>
              <div><b className="text-white">[ R ]</b> ダッシュ切り替え</div><div><b className="text-white">[ SHIFT ]</b> スニーク / 下降</div>
            </div>
          </div>
        </div>
      )}

      {(['inventory', 'workbench', 'furnace', 'chest'] as const).map(mode => openModal === mode && (
        <ItemMenu key={mode} mode={mode} items={items} activeSlot={activeSlot} creative={gameMode === 'creative'} paused
          chestKey={activeChestKey} onChest={(index, collect, secondary) => {
            if (!activeChestKey) return;
            const before = itemsRef.current;
            const next = updateItems(state => collect ? collectChestSlot(state, activeChestKey, index) : clickChest(state, activeChestKey, index, secondary));
            setItemMessage(next === before ? '空きが足りないため、残りはチェストに保持しています。' : '');
          }}
          furnaceKey={activeFurnaceKey} textures={threeRefs.current?.atlas.dataUrls ?? {}} message={itemMessage}
          onClose={closeMenu} onInventory={handleSlotClick} onCell={handleCraftGridClick} onCraft={handleCraftTakeResult}
          onQuick={handleQuickCraft} onFurnace={handleFurnaceSlot} onReturnCursor={handleReturnCursor} />
      ))}

      {/* Settings & Pause Modal */}
      {openModal === 'settings' && (
        <GameDialog id="settings-title" title="ゲームメニュー / 設定" onClose={closeMenu}>
            <div className="space-y-4">
              {/* Game Mode */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                <span className="text-sm font-semibold shrink-0">ゲームモード</span>
                <div className="flex gap-1 bg-neutral-950 p-1 border border-white/10 w-full sm:w-auto">
                  <button
                    onClick={() => setGameMode('survival')}
                    aria-pressed={gameMode === 'survival'} className={`flex-1 min-h-11 px-2 py-1 text-xs font-bold transition ${
                      gameMode === 'survival' ? 'bg-emerald-500 text-black' : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    サバイバル
                  </button>
                  <button
                    onClick={() => setGameMode('creative')}
                    aria-pressed={gameMode === 'creative'} className={`flex-1 min-h-11 px-2 py-1 text-xs font-bold transition ${
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
                  aria-label="視野角" type="range"
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
                  aria-label="描画距離" type="range"
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
                  aria-label="効果音" type="checkbox"
                  checked={soundEnabled}
                  onChange={(e) => setSoundEnabled(e.target.checked)}
                  className="w-4 h-4 accent-emerald-500"
                />
              </div>

              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold">BGM (環境音楽)</span>
                <input
                  aria-label="BGM" type="checkbox"
                  checked={musicEnabled}
                  onChange={(e) => setMusicEnabled(e.target.checked)}
                  className="w-4 h-4 accent-emerald-500"
                />
              </div>

              {/* Peaceful Mode */}
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold">平和モード (敵モブなし)</span>
                <input
                  aria-label="平和モード" type="checkbox"
                  checked={peaceful}
                  onChange={(e) => setPeaceful(e.target.checked)}
                  className="w-4 h-4 accent-emerald-500"
                />
              </div>
            </div>

            <section aria-label="ワールドの保存" className="border-t border-white/10 pt-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold">ワールドの保存</span>
                <button
                  type="button"
                  onClick={() => { void saveCurrentGame(); }}
                  disabled={!isReady || isSaving || !persistenceRef.current.canWrite}
                  className="min-h-11 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-bold"
                >
                  {isSaving ? '保存中…' : '今すぐ保存'}
                </button>
              </div>
              <p role="status" className={`text-xs leading-relaxed ${storageError ? 'text-amber-300' : 'text-neutral-400'}`}>{storageStatus}</p>
              <p className="text-[11px] text-neutral-500">同じブラウザ・同じURLで自動的に続きから再開します。保存完了を確認してから閉じてください。</p>
              {storageError && <p role="alert" className="text-xs text-amber-300">ブラウザのデータ消去やプライベートモード終了では保存が失われる場合があります。読み込み失敗中は既存データを上書きしません。</p>}
            </section>

            <button onClick={() => { resetControls(); setTouchEnabled(value => !value); }} className="min-h-11 w-full rounded-lg border border-white/20 text-sm">タッチ操作: {touchEnabled ? 'ON' : 'OFF'}</button>
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
                closeMenu();
              }}
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-black font-black text-sm uppercase rounded-xl transition shadow-lg"
            >
              設定を閉じてゲームに戻る
            </button>
        </GameDialog>
      )}

      {/* Help & Guide Modal */}
      {openModal === 'help' && (
        <GameDialog id="help-title" title="遊び方 / 操作ガイド" onClose={closeMenu}>
            <div className="space-y-4 text-xs text-neutral-300 leading-relaxed">
              <div className="bg-neutral-950 p-3.5 rounded-xl border border-white/10 space-y-1.5">
                <h3 className="font-bold text-emerald-400 text-sm">💡 サバイバルの基本フロー</h3>
                <p>1. <b>原木を採取:</b> 木を左クリックの長押しで伐採し、原木を手に入れます。</p>
                <p>2. <b>木材と作業台:</b> [E]キーでインベントリを開き、原木を木材に、木材4つで「作業台」を作成！</p>
                <p>3. <b>ツルハシの作成:</b> 作業台を設置して右クリックし、木のツルハシを作って石や鉱石を採掘！</p>
                <p>4. <b>夜への備え:</b> 夜になるとゾンビやクリーパー、スケルトンが出現します。松明で拠点を照らし、身を守りましょう。</p>
              </div>

              <div className="bg-neutral-950 p-3.5 rounded-xl border border-white/10 space-y-1">
                <h3 className="font-bold text-sky-400 text-sm">🎮 操作方法一覧</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] pt-1">
                  <p><b>[ W A S D ]</b> 移動</p>
                  <p><b>[ SPACE ]</b> ジャンプ (飛翔)</p>
                  <p><b>[ 左長押し ]</b> 破壊 / モブ攻撃</p>
                  <p><b>[ 右クリック ]</b> ブロック配置 / 飲食</p>
                  <p><b>[ E キー ]</b> インベントリ</p>
                  <p><b>[ 1 - 9 ]</b> ホットバー選択</p>
                  <p><b>[ R ]</b> ダッシュON／OFF</p><p><b>[ SHIFT ]</b> スニーク / 下降</p><p><b>[ F キー ]</b> 飛行切替 (クリエイティブ)</p><p><b>[ F3 ]</b> 座標を表示</p>
                  <p><b>[ ESC ]</b> ポーズ / 設定</p>
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                closeMenu();
              }}
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-black font-black text-sm uppercase rounded-xl transition"
            >
              閉じる
            </button>
        </GameDialog>
      )}
    </div>
  );
}
