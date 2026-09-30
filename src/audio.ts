// Procedural Web Audio API sound synthesizer for VoxelVerse

class SoundEngine {
  private ctx: AudioContext | null = null;
  public soundEnabled: boolean = true;
  public musicEnabled: boolean = true;
  public volume: number = 0.5;
  private nextMusicTime: number = 0;
  private musicTimeout: number | null = null;

  private init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public unlock() {
    this.init();
    if (this.musicEnabled && !this.musicTimeout) {
      this.scheduleMusic();
    }
  }

  private createGain(vol: number): GainNode | null {
    if (!this.ctx || !this.soundEnabled) return null;
    const gain = this.ctx.createGain();
    gain.gain.value = vol * this.volume;
    gain.connect(this.ctx.destination);
    return gain;
  }

  // Step sound
  public playStep(material: 'grass' | 'stone' | 'wood' | 'sand' = 'grass') {
    if (!this.soundEnabled || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      gain.connect(this.ctx.destination);
      osc.connect(filter);
      filter.connect(gain);

      if (material === 'grass') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(140 + Math.random() * 40, now);
        osc.frequency.exponentialRampToValueAtTime(40, now + 0.08);
        filter.type = 'lowpass';
        filter.frequency.value = 600;
        gain.gain.setValueAtTime(0.08 * this.volume, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.08);
        osc.start(now);
        osc.stop(now + 0.08);
      } else if (material === 'stone') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(220 + Math.random() * 60, now);
        osc.frequency.exponentialRampToValueAtTime(60, now + 0.06);
        filter.type = 'bandpass';
        filter.frequency.value = 1200;
        gain.gain.setValueAtTime(0.06 * this.volume, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.06);
        osc.start(now);
        osc.stop(now + 0.06);
      } else if (material === 'wood') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(180 + Math.random() * 30, now);
        osc.frequency.exponentialRampToValueAtTime(50, now + 0.1);
        filter.type = 'lowpass';
        filter.frequency.value = 800;
        gain.gain.setValueAtTime(0.09 * this.volume, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
      } else {
        // Sand
        this.playNoise(0.06, 400, 0.06);
      }
    } catch {
      // Audio context might be restricted
    }
  }

  // Block punch / hit
  public playHitBlock() {
    if (!this.soundEnabled || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      gain.connect(this.ctx.destination);
      osc.connect(gain);

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(160 + Math.random() * 40, now);
      osc.frequency.exponentialRampToValueAtTime(60, now + 0.07);
      gain.gain.setValueAtTime(0.12 * this.volume, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.07);

      osc.start(now);
      osc.stop(now + 0.07);
    } catch {}
  }

  // Block break sound (crisp snap & pop)
  public playBreakBlock() {
    if (!this.soundEnabled || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      gain.connect(this.ctx.destination);
      osc.connect(gain);

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(260 + Math.random() * 80, now);
      osc.frequency.exponentialRampToValueAtTime(80, now + 0.15);

      gain.gain.setValueAtTime(0.25 * this.volume, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.15);

      osc.start(now);
      osc.stop(now + 0.15);

      // Noise pop
      this.playNoise(0.12, 1000, 0.15);
    } catch {}
  }

  // Block place sound
  public playPlaceBlock() {
    if (!this.soundEnabled || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      gain.connect(this.ctx.destination);
      osc.connect(gain);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(80, now + 0.1);

      gain.gain.setValueAtTime(0.2 * this.volume, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.1);

      osc.start(now);
      osc.stop(now + 0.1);
    } catch {}
  }

  // Swing weapon / tool
  public playSwing() {
    if (!this.soundEnabled || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      gain.connect(this.ctx.destination);
      osc.connect(gain);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(450, now);
      osc.frequency.exponentialRampToValueAtTime(150, now + 0.12);

      gain.gain.setValueAtTime(0.15 * this.volume, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.12);

      osc.start(now);
      osc.stop(now + 0.12);
    } catch {}
  }

  // Hurt sound (player or mob)
  public playHurt(isMob = false) {
    if (!this.soundEnabled || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      gain.connect(this.ctx.destination);
      osc.connect(gain);

      osc.type = isMob ? 'sawtooth' : 'triangle';
      const baseFreq = isMob ? 200 : 180;
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.5, now + 0.15);

      gain.gain.setValueAtTime(0.25 * this.volume, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.15);

      osc.start(now);
      osc.stop(now + 0.15);
    } catch {}
  }

  // Eating food
  public playEat() {
    if (!this.soundEnabled || !this.ctx) return;
    try {
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          if (!this.ctx) return;
          const now = this.ctx.currentTime;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          gain.connect(this.ctx.destination);
          osc.connect(gain);

          osc.type = 'triangle';
          osc.frequency.setValueAtTime(320 + Math.random() * 80, now);
          osc.frequency.linearRampToValueAtTime(120, now + 0.08);

          gain.gain.setValueAtTime(0.18 * this.volume, now);
          gain.gain.linearRampToValueAtTime(0, now + 0.08);

          osc.start(now);
          osc.stop(now + 0.08);
        }, i * 90);
      }
    } catch {}
  }

  // Item pickup chime
  public playPickup() {
    if (!this.soundEnabled || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      gain.connect(this.ctx.destination);
      osc.connect(gain);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(950, now + 0.1);

      gain.gain.setValueAtTime(0.2 * this.volume, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.1);

      osc.start(now);
      osc.stop(now + 0.1);
    } catch {}
  }

  // UI Item slot click / pop sound
  public playPop() {
    if (!this.soundEnabled || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      gain.connect(this.ctx.destination);
      osc.connect(gain);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.05);

      gain.gain.setValueAtTime(0.15 * this.volume, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.05);

      osc.start(now);
      osc.stop(now + 0.05);
    } catch {}
  }

  // Water splash sound (hitting water surface with impact)
  public playSplash() {
    if (!this.soundEnabled || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      // White noise splash with lowpass sweep
      this.playNoise(0.28, 800, 0.35, 'bandpass');
      // Sub-surface bloop
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      gain.connect(this.ctx.destination);
      osc.connect(gain);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(90, now + 0.25);

      gain.gain.setValueAtTime(0.3 * this.volume, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.25);

      osc.start(now);
      osc.stop(now + 0.25);
    } catch {}
  }

  // Swimming stroke / water movement paddle
  public playSwim() {
    if (!this.soundEnabled || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      this.playNoise(0.12, 600, 0.2, 'lowpass');
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      gain.connect(this.ctx.destination);
      osc.connect(gain);

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(140 + Math.random() * 30, now);
      osc.frequency.exponentialRampToValueAtTime(70, now + 0.16);

      gain.gain.setValueAtTime(0.14 * this.volume, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.16);

      osc.start(now);
      osc.stop(now + 0.16);
    } catch {}
  }

  // Underwater bubble pop
  public playBubble() {
    if (!this.soundEnabled || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      gain.connect(this.ctx.destination);
      osc.connect(gain);

      osc.type = 'sine';
      const f0 = 400 + Math.random() * 200;
      osc.frequency.setValueAtTime(f0, now);
      osc.frequency.exponentialRampToValueAtTime(f0 * 1.8, now + 0.08);

      gain.gain.setValueAtTime(0.1 * this.volume, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.08);

      osc.start(now);
      osc.stop(now + 0.08);
    } catch {}
  }

  // Crafting / Success chime
  public playCraft() {
    if (!this.soundEnabled || !this.ctx) return;
    try {
      const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
      notes.forEach((freq, idx) => {
        setTimeout(() => {
          if (!this.ctx) return;
          const now = this.ctx.currentTime;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          gain.connect(this.ctx.destination);
          osc.connect(gain);

          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now);

          gain.gain.setValueAtTime(0.2 * this.volume, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

          osc.start(now);
          osc.stop(now + 0.2);
        }, idx * 70);
      });
    } catch {}
  }

  // Creeper hiss
  public playCreeperHiss() {
    if (!this.soundEnabled || !this.ctx) return;
    this.playNoise(0.25, 2500, 1.2, 'highpass');
  }

  // Explosion (TNT or Creeper)
  public playExplosion() {
    if (!this.soundEnabled || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      // Low boom
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      gain.connect(this.ctx.destination);
      osc.connect(gain);

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(100, now);
      osc.frequency.exponentialRampToValueAtTime(25, now + 0.8);

      gain.gain.setValueAtTime(0.6 * this.volume, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.8);

      osc.start(now);
      osc.stop(now + 0.8);

      // Noise explosion
      this.playNoise(0.45, 800, 0.9, 'lowpass');
    } catch {}
  }

  // Arrow shoot
  public playShootBow() {
    if (!this.soundEnabled || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      gain.connect(this.ctx.destination);
      osc.connect(gain);

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(300, now);
      osc.frequency.exponentialRampToValueAtTime(700, now + 0.08);

      gain.gain.setValueAtTime(0.25 * this.volume, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.1);

      osc.start(now);
      osc.stop(now + 0.1);
    } catch {}
  }

  // Zombie groan
  public playZombieGroan() {
    if (!this.soundEnabled || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(450, now);
      gain.connect(this.ctx.destination);
      filter.connect(gain);
      osc.connect(filter);

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(95, now);
      osc.frequency.linearRampToValueAtTime(75, now + 0.4);
      osc.frequency.linearRampToValueAtTime(90, now + 0.7);

      gain.gain.setValueAtTime(0.18 * this.volume, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.7);

      osc.start(now);
      osc.stop(now + 0.7);
    } catch {}
  }

  // Noise helper (for explosions, water, hiss, steps)
  private playNoise(volume: number, filterFreq: number, duration: number, filterType: BiquadFilterType = 'lowpass') {
    if (!this.ctx || !this.soundEnabled) return;
    try {
      const bufferSize = this.ctx.sampleRate * duration;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = filterFreq;

      const gain = this.ctx.createGain();
      const now = this.ctx.currentTime;
      gain.gain.setValueAtTime(volume * this.volume, now);
      gain.gain.linearRampToValueAtTime(0, now + duration);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      noise.start(now);
    } catch {}
  }

  // Ambient procedural music (soft calming chords)
  private scheduleMusic() {
    if (!this.musicEnabled) return;
    const playChord = () => {
      if (!this.musicEnabled || !this.ctx) return;
      try {
        const chords = [
          [261.63, 329.63, 392.0], // C major
          [220.0, 261.63, 329.63], // A minor
          [174.61, 220.0, 261.63], // F major
          [196.0, 246.94, 293.66], // G major
        ];
        const chord = chords[Math.floor(Math.random() * chords.length)];
        const now = this.ctx.currentTime;

        chord.forEach((freq, i) => {
          if (!this.ctx) return;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          const filter = this.ctx.createBiquadFilter();

          filter.type = 'lowpass';
          filter.frequency.value = 500;

          gain.connect(this.ctx.destination);
          filter.connect(gain);
          osc.connect(filter);

          osc.type = 'sine';
          osc.frequency.value = freq;

          const startDelay = i * 0.15;
          const noteStart = now + startDelay;
          gain.gain.setValueAtTime(0, noteStart);
          gain.gain.linearRampToValueAtTime(0.04 * this.volume, noteStart + 0.8);
          gain.gain.linearRampToValueAtTime(0, noteStart + 3.5);

          osc.start(noteStart);
          osc.stop(noteStart + 3.6);
        });
      } catch {}

      // Play next chord every 12 to 20 seconds
      this.musicTimeout = window.setTimeout(playChord, 12000 + Math.random() * 8000);
    };

    this.musicTimeout = window.setTimeout(playChord, 3000);
  }
}

export const sound = new SoundEngine();
