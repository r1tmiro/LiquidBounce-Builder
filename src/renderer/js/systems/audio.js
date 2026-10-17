/**
 * Procedural audio - every sound is synthesised with the Web Audio API so the
 * game ships without a single audio file.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.8;
    this.started = false;
    this.ambientNodes = null;
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.ratio.value = 6;
    this.master.connect(this.comp);
    this.comp.connect(this.ctx.destination);
    this.noiseBuffer = this.makeNoise(2.0);
    return this.ctx;
  }

  resume() {
    this.ensure();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.started = true;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.2;
    }
    return buf;
  }

  now() { return this.ctx.currentTime; }

  /** Positional-ish output: pan by relative x, gain by distance. */
  spatial(relX = 0, dist = 0, maxDist = 18) {
    const g = this.ctx.createGain();
    const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    const atten = Math.max(0, 1 - dist / maxDist);
    g.gain.value = atten * atten;
    if (pan) {
      pan.pan.value = Math.max(-1, Math.min(1, relX / 8));
      g.connect(pan);
      pan.connect(this.master);
    } else {
      g.connect(this.master);
    }
    return g;
  }

  // ------------------------------------------------------------- one-shots

  footstep(running = false, relX = 0, dist = 0) {
    if (!this.started) return;
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.9 + Math.random() * 0.35;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 150 + Math.random() * 90;
    filt.Q.value = 1.1;
    const g = this.spatial(relX, dist, 14);
    const vol = (running ? 0.5 : 0.3) * g.gain.value;
    g.gain.value = vol;
    src.connect(filt);
    filt.connect(g);
    src.start(t);
    src.stop(t + 0.14);
  }

  click() {
    if (!this.started) return;
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(440, t + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + 0.1);
  }

  beep(freq = 660, dur = 0.09, type = 'square', vol = 0.1) {
    if (!this.started) return;
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  taskDone() {
    if (!this.started) return;
    const ctx = this.ensure();
    const t = ctx.currentTime;
    [523, 659, 784, 1046].forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + i * 0.07);
      g.gain.linearRampToValueAtTime(0.11, t + i * 0.07 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.07 + 0.28);
      osc.connect(g); g.connect(this.master);
      osc.start(t + i * 0.07); osc.stop(t + i * 0.07 + 0.3);
    });
  }

  taskError() {
    if (!this.started) return;
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + 0.34);
  }

  kill(relX = 0, dist = 0) {
    if (!this.started) return;
    const ctx = this.ensure();
    const t = ctx.currentTime;
    // metallic shriek
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 1.6;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.setValueAtTime(2400, t);
    filt.frequency.exponentialRampToValueAtTime(300, t + 0.5);
    filt.Q.value = 3.2;
    const g = this.spatial(relX, dist, 40);
    g.gain.value = 0.8;
    src.connect(filt); filt.connect(g);
    src.start(t); src.stop(t + 0.6);
    // low impact
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.7);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.6, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    osc.connect(og); og.connect(this.master);
    osc.start(t); osc.stop(t + 0.95);
  }

  vent() {
    if (!this.started) return;
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.setValueAtTime(500, t);
    filt.frequency.linearRampToValueAtTime(1800, t + 0.35);
    filt.Q.value = 6;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    src.connect(filt); filt.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 0.5);
  }

  meeting() {
    if (!this.started) return;
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 1.2);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.32, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    osc.connect(filt); filt.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + 1.5);
  }

  heartbeat(intensity = 1) {
    if (!this.started) return;
    const ctx = this.ensure();
    const t = ctx.currentTime;
    for (const [off, amp] of [[0, 0.5], [0.19, 0.32]]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(72, t + off);
      osc.frequency.exponentialRampToValueAtTime(34, t + off + 0.16);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + off);
      g.gain.linearRampToValueAtTime(amp * intensity, t + off + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.22);
      osc.connect(g); g.connect(this.master);
      osc.start(t + off); osc.stop(t + off + 0.25);
    }
  }

  breath(relX = 0, dist = 0) {
    if (!this.started) return;
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.55;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.setValueAtTime(620, t);
    filt.frequency.linearRampToValueAtTime(320, t + 0.8);
    filt.Q.value = 1.6;
    const g = this.spatial(relX, dist, 16);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
    src.connect(filt); filt.connect(g);
    src.start(t); src.stop(t + 1.0);
  }

  alarm() {
    if (!this.started) return;
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.linearRampToValueAtTime(900, t + 0.5);
    osc.frequency.linearRampToValueAtTime(520, t + 1.0);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.08);
    g.gain.setValueAtTime(0.16, t + 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + 1.25);
  }

  // -------------------------------------------------------------- ambient

  startAmbient() {
    if (!this.started || this.ambientNodes) return;
    const ctx = this.ensure();
    const g = ctx.createGain();
    g.gain.value = 0.0;
    g.connect(this.master);
    g.gain.linearRampToValueAtTime(0.16, ctx.currentTime + 4);

    // deep drone
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 41;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 61.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220; lp.Q.value = 2;
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.06;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 70;
    lfo.connect(lfoGain); lfoGain.connect(lp.frequency);
    o1.connect(lp); o2.connect(lp); lp.connect(g);

    // air hiss
    const air = ctx.createBufferSource();
    air.buffer = this.noiseBuffer;
    air.loop = true;
    const airFilt = ctx.createBiquadFilter();
    airFilt.type = 'bandpass'; airFilt.frequency.value = 640; airFilt.Q.value = 0.7;
    const airGain = ctx.createGain(); airGain.gain.value = 0.05;
    air.connect(airFilt); airFilt.connect(airGain); airGain.connect(g);

    o1.start(); o2.start(); lfo.start(); air.start();
    this.ambientNodes = { g, o1, o2, lfo, air };
  }

  setDread(level) {
    if (!this.ambientNodes) return;
    const t = this.ctx.currentTime;
    this.ambientNodes.g.gain.setTargetAtTime(0.14 + level * 0.26, t, 0.6);
    this.ambientNodes.o1.frequency.setTargetAtTime(41 + level * 12, t, 1.2);
    this.ambientNodes.o2.frequency.setTargetAtTime(61.5 + level * 9, t, 1.2);
  }
}
