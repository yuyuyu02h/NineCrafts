import * as THREE from 'three';

export type GraphicsQuality = 'low' | 'balanced' | 'high';
export const GRAPHICS = {
  low: { pixelRatio: 0.85, shadowSize: 512, particles: false },
  balanced: { pixelRatio: 1.25, shadowSize: 1024, particles: true },
  high: { pixelRatio: 1.75, shadowSize: 2048, particles: true },
} as const;

export function applyGraphics(renderer: THREE.WebGLRenderer, light: THREE.DirectionalLight,
  particles: THREE.Points, quality: GraphicsQuality, shadows: boolean, deviceRatio: number) {
  const config = GRAPHICS[quality];
  renderer.setPixelRatio(Math.min(deviceRatio, config.pixelRatio));
  if (light.shadow.mapSize.x !== config.shadowSize) {
    light.shadow.map?.dispose(); light.shadow.map = null;
    light.shadow.mapSize.set(config.shadowSize, config.shadowSize);
  }
  // Existing materials must be recompiled when shadows are toggled; Three.js handles this on render.
  renderer.shadowMap.enabled = shadows;
  light.castShadow = shadows;
  particles.visible = config.particles;
}
