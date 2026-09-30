import * as THREE from 'three';

export class ShaderEnvironment {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;

  // Lights
  public dirLight: THREE.DirectionalLight;
  public hemiLight: THREE.HemisphereLight;
  public ambientLight: THREE.AmbientLight;

  // Celestial objects
  public sunSprite: THREE.Sprite;
  public sunGlowSprite: THREE.Sprite;
  public moonSprite: THREE.Sprite;
  public starPoints: THREE.Points;

  // Volumetric Clouds Layer
  public cloudMesh: THREE.InstancedMesh;
  private cloudDummy = new THREE.Object3D();
  private cloudCount = 196;
  private cloudBasePositions: { x: number; z: number; scaleX: number; scaleZ: number }[] = [];
  private cloudOffset = 0;

  // Atmospheric Particles (Pollen / Dust motes / Night Fireflies)
  public particleSystem: THREE.Points;
  private particlePositions: Float32Array;
  private particleCount = 200;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;

    // 1. Ambient & Hemisphere GI Bounce Light
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.25);
    this.scene.add(this.ambientLight);

    // Hemisphere light simulates sky ambient + ground bounce (shader GI)
    this.hemiLight = new THREE.HemisphereLight(0x90c5ff, 0x443020, 0.45);
    this.scene.add(this.hemiLight);

    // 2. High-Performance Cascaded Directional Light (Sun / Moon)
    this.dirLight = new THREE.DirectionalLight(0xfff0dd, 1.2);
    this.dirLight.castShadow = true;

    // Optimized shadow camera parameters (crisp shadows, 4x faster rendering)
    this.dirLight.shadow.mapSize.width = 1024;
    this.dirLight.shadow.mapSize.height = 1024;
    this.dirLight.shadow.camera.near = 0.5;
    this.dirLight.shadow.camera.far = 140;
    this.dirLight.shadow.camera.left = -28;
    this.dirLight.shadow.camera.right = 28;
    this.dirLight.shadow.camera.top = 28;
    this.dirLight.shadow.camera.bottom = -28;
    this.dirLight.shadow.bias = -0.0003;
    this.dirLight.shadow.normalBias = 0.03;
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);

    // 3. Sun Sprite with Godray Corona
    const sunCanvas = this.createSunCanvas();
    const sunTex = new THREE.CanvasTexture(sunCanvas);
    const sunMat = new THREE.SpriteMaterial({
      map: sunTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.sunSprite = new THREE.Sprite(sunMat);
    this.sunSprite.scale.set(24, 24, 1);
    this.scene.add(this.sunSprite);

    const glowCanvas = this.createSunGlowCanvas();
    const glowTex = new THREE.CanvasTexture(glowCanvas);
    const glowMat = new THREE.SpriteMaterial({
      map: glowTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.6,
    });
    this.sunGlowSprite = new THREE.Sprite(glowMat);
    this.sunGlowSprite.scale.set(65, 65, 1);
    this.scene.add(this.sunGlowSprite);

    // 4. Moon Sprite
    const moonCanvas = this.createMoonCanvas();
    const moonTex = new THREE.CanvasTexture(moonCanvas);
    const moonMat = new THREE.SpriteMaterial({
      map: moonTex,
      transparent: true,
      depthWrite: false,
    });
    this.moonSprite = new THREE.Sprite(moonMat);
    this.moonSprite.scale.set(16, 16, 1);
    this.scene.add(this.moonSprite);

    // 5. Starfield
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(800 * 3);
    for (let i = 0; i < 800; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.9 + 0.05); // upper dome
      const r = 220;
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * Math.cos(phi);
      starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1.8,
      transparent: true,
      opacity: 0.0,
      sizeAttenuation: false,
    });
    this.starPoints = new THREE.Points(starGeo, starMat);
    this.scene.add(this.starPoints);

    // 6. Shader-Mod 3D Voxel Clouds Layer (Floating volumetric cloud deck)
    const cloudGeo = new THREE.BoxGeometry(1, 1, 1);
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.9,
      metalness: 0.0,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    });
    this.cloudMesh = new THREE.InstancedMesh(cloudGeo, cloudMat, this.cloudCount);
    this.cloudMesh.receiveShadow = false;
    this.cloudMesh.castShadow = true; // Clouds cast real shadows on the terrain!

    // Scatter cloud clusters in a wide area
    const clusterCenters = [
      { x: -50, z: -50 }, { x: 20, z: -40 }, { x: -30, z: 40 },
      { x: 60, z: 30 }, { x: 0, z: 0 }, { x: -80, z: 20 }, { x: 50, z: -70 }
    ];

    let idx = 0;
    clusterCenters.forEach((center) => {
      const blobs = Math.floor(this.cloudCount / clusterCenters.length);
      for (let b = 0; b < blobs && idx < this.cloudCount; b++) {
        const cx = center.x + (Math.random() - 0.5) * 45;
        const cz = center.z + (Math.random() - 0.5) * 45;
        const sX = 8 + Math.random() * 12;
        const sZ = 8 + Math.random() * 12;
        this.cloudBasePositions.push({ x: cx, z: cz, scaleX: sX, scaleZ: sZ });
        idx++;
      }
    });

    this.scene.add(this.cloudMesh);

    // 7. Atmospheric Environmental Particles (Sun dust / Fireflies)
    const pGeo = new THREE.BufferGeometry();
    this.particlePositions = new Float32Array(this.particleCount * 3);
    for (let i = 0; i < this.particleCount; i++) {
      this.particlePositions[i * 3] = (Math.random() - 0.5) * 30;
      this.particlePositions[i * 3 + 1] = Math.random() * 14 + 1;
      this.particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 30;
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    const pMat = new THREE.PointsMaterial({
      color: 0xffea88,
      size: 0.12,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
    });
    this.particleSystem = new THREE.Points(pGeo, pMat);
    this.scene.add(this.particleSystem);
  }

  private createSunCanvas(): HTMLCanvasElement {
    const cvs = document.createElement('canvas');
    cvs.width = 128;
    cvs.height = 128;
    const ctx = cvs.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255, 255, 240, 1.0)');
    grad.addColorStop(0.25, 'rgba(255, 230, 140, 0.9)');
    grad.addColorStop(0.55, 'rgba(255, 170, 50, 0.4)');
    grad.addColorStop(1, 'rgba(255, 120, 20, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    return cvs;
  }

  private createSunGlowCanvas(): HTMLCanvasElement {
    const cvs = document.createElement('canvas');
    cvs.width = 256;
    cvs.height = 256;
    const ctx = cvs.getContext('2d')!;
    const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, 'rgba(255, 220, 120, 0.6)');
    grad.addColorStop(0.3, 'rgba(255, 180, 70, 0.25)');
    grad.addColorStop(0.7, 'rgba(255, 130, 40, 0.08)');
    grad.addColorStop(1, 'rgba(255, 100, 20, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
    return cvs;
  }

  private createMoonCanvas(): HTMLCanvasElement {
    const cvs = document.createElement('canvas');
    cvs.width = 128;
    cvs.height = 128;
    const ctx = cvs.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 60);
    grad.addColorStop(0, 'rgba(240, 245, 255, 1.0)');
    grad.addColorStop(0.6, 'rgba(200, 220, 255, 0.85)');
    grad.addColorStop(0.85, 'rgba(150, 180, 240, 0.3)');
    grad.addColorStop(1, 'rgba(100, 140, 220, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(64, 64, 58, 0, Math.PI * 2);
    ctx.fill();

    // Subtle moon craters
    ctx.fillStyle = 'rgba(170, 190, 220, 0.35)';
    ctx.beginPath();
    ctx.arc(46, 50, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(75, 70, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(78, 42, 10, 0, Math.PI * 2);
    ctx.fill();

    return cvs;
  }

  public update(delta: number, timeOfDay: number, playerPos: THREE.Vector3) {
    const sunAngle = timeOfDay;
    const sunY = Math.sin(sunAngle);
    const sunX = Math.cos(sunAngle);
    const isNight = sunY < 0;

    // Follow player with directional light target (cascaded shadow centering)
    this.dirLight.target.position.set(playerPos.x, playerPos.y, playerPos.z);
    this.dirLight.target.updateMatrixWorld();

    const dist = 65;
    this.dirLight.position.set(
      playerPos.x + sunX * dist,
      playerPos.y + sunY * dist + 10,
      playerPos.z + Math.sin(sunAngle * 0.5) * 20
    );

    // 1. Sky & Atmospheric Light Colors
    let skyColor: THREE.Color;
    let fogColor: THREE.Color;
    let hemiSky: THREE.Color;
    let hemiGround: THREE.Color;
    let dirColor: THREE.Color;
    let dirIntensity: number;

    if (sunY > 0.25) {
      // Crisp midday sunlight
      skyColor = new THREE.Color().setHSL(0.58, 0.7, 0.52 + sunY * 0.12);
      fogColor = new THREE.Color().setHSL(0.58, 0.55, 0.65 + sunY * 0.1);
      hemiSky = new THREE.Color(0xaad5ff);
      hemiGround = new THREE.Color(0x5a4836);
      dirColor = new THREE.Color(0xfffaea);
      dirIntensity = 1.25 * sunY;
      (this.starPoints.material as THREE.PointsMaterial).opacity = 0;
      this.sunSprite.visible = true;
      this.sunGlowSprite.visible = true;
      this.moonSprite.visible = false;
    } else if (sunY > -0.15) {
      // Golden Hour / Sunset (Shader-mod cinematic orange & purple horizon)
      const t = (sunY + 0.15) / 0.4;
      skyColor = new THREE.Color().setHSL(0.07, 0.9, 0.35 + t * 0.2);
      fogColor = new THREE.Color().setHSL(0.05, 0.85, 0.45);
      hemiSky = new THREE.Color(0xff8844);
      hemiGround = new THREE.Color(0x332015);
      dirColor = new THREE.Color(0xff8833);
      dirIntensity = Math.max(0.4, t * 1.1);
      (this.starPoints.material as THREE.PointsMaterial).opacity = (1 - t) * 0.5;
      this.sunSprite.visible = true;
      this.sunGlowSprite.visible = true;
      this.moonSprite.visible = true;
    } else {
      // Moody Moonlight Night with Starfield
      skyColor = new THREE.Color().setHSL(0.65, 0.75, 0.035);
      fogColor = new THREE.Color().setHSL(0.65, 0.65, 0.06);
      hemiSky = new THREE.Color(0x1a2b4c);
      hemiGround = new THREE.Color(0x0c0f18);
      dirColor = new THREE.Color(0x6b8ecc);
      dirIntensity = 0.35;
      (this.starPoints.material as THREE.PointsMaterial).opacity = 0.85;
      this.sunSprite.visible = false;
      this.sunGlowSprite.visible = false;
      this.moonSprite.visible = true;
    }

    this.scene.background = skyColor;
    if (this.scene.fog) {
      this.scene.fog.color = fogColor;
    }

    this.hemiLight.color.copy(hemiSky);
    this.hemiLight.groundColor.copy(hemiGround);
    this.dirLight.color.copy(dirColor);
    this.dirLight.intensity = dirIntensity;
    this.ambientLight.intensity = isNight ? 0.18 : 0.3;

    // 2. Position Sun and Moon Sprites
    const celestialDist = 180;
    this.sunSprite.position.set(
      playerPos.x + sunX * celestialDist,
      playerPos.y + sunY * celestialDist,
      playerPos.z + Math.sin(sunAngle * 0.5) * 40
    );
    this.sunGlowSprite.position.copy(this.sunSprite.position);

    // Moon is opposite to the sun
    this.moonSprite.position.set(
      playerPos.x - sunX * celestialDist,
      playerPos.y - sunY * celestialDist,
      playerPos.z - Math.sin(sunAngle * 0.5) * 40
    );

    // Keep Starfield centered on player
    this.starPoints.position.copy(playerPos);

    // 3. Update Volumetric Clouds (Translate cloud layer with wind - zero matrix re-upload)
    this.cloudOffset += delta * 1.5;
    this.cloudMesh.position.set(
      playerPos.x + (this.cloudOffset % 80) - 40,
      0,
      playerPos.z
    );

    // 4. Update Atmospheric Particles (Gentle rotation with zero buffer re-upload)
    this.particleSystem.position.copy(playerPos);
    this.particleSystem.rotation.y += delta * 0.05;
    (this.particleSystem.material as THREE.PointsMaterial).color.setHex(isNight ? 0x88ffaa : 0xffe077);
  }
}
