/**
 * Task minigames - each one is a self contained canvas puzzle drawn in the
 * "ship console" visual style.
 */

const C = {
  bg: '#06090d',
  panel: '#0e141c',
  line: 'rgba(120,160,200,.22)',
  text: '#cfe0ef',
  dim: '#7f8fa2',
  amber: '#ff9f43',
  cyan: '#49d7e8',
  green: '#52d17a',
  red: '#e03a3a',
  yellow: '#e8d44a',
  blue: '#4a8ce0',
  purple: '#9a6adf',
};

const WIRE_COLORS = [
  { name: 'RED', hex: '#e03a3a' },
  { name: 'BLUE', hex: '#4a8ce0' },
  { name: 'YELLOW', hex: '#e8d44a' },
  { name: 'GREEN', hex: '#52d17a' },
  { name: 'PINK', hex: '#e05ab0' },
];

export class Minigame {
  constructor(canvas, task, hooks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.task = task;
    this.hooks = hooks;            // { onProgress, onComplete, onFail, onClose }
    this.progress = 0;
    this.done = false;
    this.time = 0;
    this.dragging = null;
    this.keys = new Set();
    this._bind();
  }

  _bind() {
    const c = this.canvas;
    const pos = e => {
      const r = c.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) * (c.width / r.width),
        y: (e.clientY - r.top) * (c.height / r.height),
      };
    };
    this._onDown = e => { const p = pos(e); this.onDown(p.x, p.y); };
    this._onMove = e => { const p = pos(e); this.onMove(p.x, p.y); };
    this._onUp = e => { const p = pos(e); this.onUp(p.x, p.y); };
    this._onKeyDown = e => { this.keys.add(e.code); this.onKey(e.code, true); };
    this._onKeyUp = e => { this.keys.delete(e.code); this.onKey(e.code, false); };
    c.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  dispose() {
    const c = this.canvas;
    c.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
  }

  onDown() {} onMove() {} onUp() {} onKey() {}

  setProgress(p) {
    this.progress = Math.max(this.progress, Math.min(1, p));
    this.hooks.onProgress?.(this.progress);
    if (this.progress >= 1 && !this.done) {
      this.done = true;
      this.hooks.onComplete?.();
    }
  }

  fail(msg) { this.hooks.onFail?.(msg); }

  // ------------------------------------------------------------- helpers

  frame(title, subtitle) {
    const { ctx, canvas } = this;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#080c12');
    g.addColorStop(1, '#04070a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // subtle grid
    ctx.strokeStyle = 'rgba(80,120,160,.07)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    if (title) {
      ctx.font = '600 15px "JetBrains Mono", Consolas, monospace';
      ctx.fillStyle = C.amber;
      ctx.textAlign = 'left';
      ctx.fillText(title.toUpperCase(), 22, 32);
      if (subtitle) {
        ctx.font = '400 12px Inter, sans-serif';
        ctx.fillStyle = C.dim;
        ctx.fillText(subtitle, 22, 52);
      }
    }
    return { w, h };
  }

  glowText(text, x, y, color = C.cyan, size = 26, align = 'left') {
    const { ctx } = this;
    ctx.font = `700 ${size}px "JetBrains Mono", Consolas, monospace`;
    ctx.textAlign = align;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.shadowBlur = 0;
  }

  bar(x, y, w, h, value, color) {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
    ctx.fillStyle = color;
    ctx.fillRect(x + 2, y + 2, (w - 4) * Math.max(0, Math.min(1, value)), h - 4);
  }

  disposeAll() { this.dispose(); }
}

// ───────────────────────────────── wires ─────────────────────────────────
export class WiresGame extends Minigame {
  constructor(canvas, task, hooks) {
    super(canvas, task, hooks);
    this.left = WIRE_COLORS.map((c, i) => ({ ...c, y: 120 + i * 78, connected: false }));
    this.right = WIRE_COLORS.map((c, i) => ({ ...c, y: 120 + i * 78, connected: false }));
    for (let i = this.right.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.right[i], this.right[j]] = [this.right[j], this.right[i]];
    }
    this.selected = null;
    this.connections = [];
  }

  onDown(x, y) {
    if (this.done) return;
    for (const w of this.left) {
      if (Math.abs(y - w.y) < 26 && x < 260) {
        if (w.connected) return;
        this.selected = this.selected === w ? null : w;
        this.hooks.onTick?.();
        return;
      }
    }
    for (const w of this.right) {
      if (Math.abs(y - w.y) < 26 && x > 460) {
        if (w.connected || !this.selected) return;
        if (this.selected.hex === w.hex) {
          this.selected.connected = true;
          w.connected = true;
          this.connections.push({ x1: 150, y1: this.selected.y, x2: 570, y2: w.y, hex: w.hex });
          this.selected = null;
          this.setProgress(this.connections.length / this.left.length);
        } else {
          this.fail('Wrong wire');
          this.selected = null;
        }
      }
    }
  }

  update(dt) { this.time += dt; }

  render() {
    const { ctx } = this;
    this.frame('Calibrate Wiring', 'Connect each wire to its matching colour.');
    // left bank
    for (const w of this.left) {
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.fillRect(40, w.y - 20, 110, 40);
      ctx.strokeStyle = C.line; ctx.strokeRect(40.5, w.y - 19.5, 109, 39);
      ctx.fillStyle = w.hex;
      ctx.shadowColor = w.hex; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(62, w.y, 8, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.font = '600 13px "JetBrains Mono", monospace';
      ctx.fillStyle = w.connected ? C.dim : C.text;
      ctx.textAlign = 'left';
      ctx.fillText(w.name, 80, w.y + 5);
    }
    // right bank
    for (const w of this.right) {
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.fillRect(570, w.y - 20, 110, 40);
      ctx.strokeStyle = C.line; ctx.strokeRect(570.5, w.y - 19.5, 109, 39);
      ctx.fillStyle = w.hex;
      ctx.shadowColor = w.hex; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(658, w.y, 8, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.font = '600 13px "JetBrains Mono", monospace';
      ctx.fillStyle = w.connected ? C.dim : C.text;
      ctx.textAlign = 'right';
      ctx.fillText(w.name, 596, w.y + 5);
    }
    // cables
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    for (const c of this.connections) {
      ctx.strokeStyle = c.hex;
      ctx.shadowColor = c.hex; ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(c.x1, c.y1);
      ctx.bezierCurveTo(300, c.y1, 420, c.y2, c.x2, c.y2);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    if (this.selected) {
      const sx = 150, sy = this.selected.y;
      ctx.strokeStyle = this.selected.hex;
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(570, sy); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

// ───────────────────────────────── divert ─────────────────────────────────
export class DivertGame extends Minigame {
  constructor(canvas, task, hooks) {
    super(canvas, task, hooks);
    this.sliders = [0, 1, 2, 3].map(i => ({
      value: Math.random() * 0.8 + 0.1,
      target: 0.15 + Math.random() * 0.7,
    }));
  }

  onDown(x, y) {
    for (let i = 0; i < this.sliders.length; i++) {
      const x0 = 70 + i * 150;
      if (x > x0 - 30 && x < x0 + 30 && y > 110 && y < 390) {
        this.dragging = i;
        this.setSlider(i, y);
      }
    }
  }

  onMove(x, y) { if (this.dragging !== null) this.setSlider(this.dragging, y); }
  onUp() {
    if (this.dragging !== null) {
      this.dragging = null;
      this.check();
    }
  }

  setSlider(i, y) {
    const v = Math.max(0, Math.min(1, (390 - y) / 280));
    this.sliders[i].value = v;
  }

  check() {
    let ok = true;
    for (const s of this.sliders) if (Math.abs(s.value - s.target) > 0.07) ok = false;
    if (ok) this.setProgress(1);
  }

  update(dt) {
    this.time += dt;
    if (this.dragging === null && !this.done) {
      let allGood = true;
      for (const s of this.sliders) if (Math.abs(s.value - s.target) > 0.07) allGood = false;
      if (allGood) this.setProgress(1);
    }
  }

  render() {
    const { ctx, canvas } = this;
    this.frame('Divert Power', 'Drag each lever to the marked position.');
    for (let i = 0; i < this.sliders.length; i++) {
      const s = this.sliders[i];
      const x0 = 70 + i * 150;
      const top = 110, bottom = 390, h = bottom - top;
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(x0 - 16, top, 32, h);
      ctx.strokeStyle = C.line; ctx.strokeRect(x0 - 15.5, top + .5, 31, h - 1);
      // target zone
      const ty = bottom - s.target * h;
      ctx.fillStyle = 'rgba(82,209,122,.16)';
      ctx.fillRect(x0 - 14, ty - 12, 28, 24);
      ctx.strokeStyle = 'rgba(82,209,122,.6)';
      ctx.strokeRect(x0 - 14.5, ty - 12.5, 29, 25);
      // knob
      const ky = bottom - s.value * h;
      const good = Math.abs(s.value - s.target) <= 0.07;
      ctx.fillStyle = good ? C.green : C.amber;
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 12;
      ctx.fillRect(x0 - 22, ky - 9, 44, 18);
      ctx.shadowBlur = 0;
      ctx.font = '600 12px "JetBrains Mono", monospace';
      ctx.fillStyle = C.dim; ctx.textAlign = 'center';
      ctx.fillText(['LIGHT', 'OXYGEN', 'COMMS', 'FUEL'][i], x0, 425);
      ctx.fillStyle = good ? C.green : C.dim;
      ctx.fillText(good ? 'LOCKED' : `${Math.round(s.value * 100)}%`, x0, 443);
    }
  }
}

// ───────────────────────────────── fuel ─────────────────────────────────
export class FuelGame extends Minigame {
  constructor(canvas, task, hooks) {
    super(canvas, task, hooks);
    this.value = 0.05;
    this.holding = false;
    this.target = 0.72 + Math.random() * 0.2;
    this.drain = 0;
  }

  onDown() { this.holding = true; }
  onUp() { this.holding = false; }
  onKey(code, down) { if (code === 'Space') this.holding = down; }

  update(dt) {
    this.time += dt;
    if (this.holding) {
      this.value += dt * 0.42;
      this.drain = 0;
    } else {
      this.drain += dt;
      if (this.drain > 0.35) this.value = Math.max(0, this.value - dt * 0.18);
    }
    if (this.value >= this.target) this.setProgress(1);
    else if (this.value > this.target + 0.12) {
      this.value = 0.05;
      this.fail('Overfilled - the tank vented');
    }
  }

  render() {
    const { ctx, canvas } = this;
    this.frame('Refuel', 'Hold the button to fill the tank. Fill up to the green band.');
    const x = 250, y = 110, w = 220, h = 240;
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = C.line; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
    // target band
    const ty = y + h - this.target * h;
    ctx.fillStyle = 'rgba(82,209,122,.18)';
    ctx.fillRect(x + 2, ty, w - 4, h * (this.target - 0.06));
    // fuel
    const fh = Math.min(1, this.value) * h;
    const grad = ctx.createLinearGradient(0, y + h, 0, y);
    grad.addColorStop(0, '#8a5a1a');
    grad.addColorStop(1, '#ffb347');
    ctx.fillStyle = grad;
    ctx.shadowColor = '#ff9f43'; ctx.shadowBlur = 16;
    ctx.fillRect(x + 4, y + h - fh, w - 8, fh);
    ctx.shadowBlur = 0;
    this.glowText(`${Math.round(Math.min(1, this.value) * 100)}%`, x + w / 2, y - 22, C.amber, 30, 'center');
    // hold button
    const bx = 250, by = 390, bw = 220, bh = 46;
    ctx.fillStyle = this.holding ? 'rgba(255,159,67,.3)' : 'rgba(255,255,255,.05)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = this.holding ? C.amber : C.line;
    ctx.strokeRect(bx + .5, by + .5, bw - 1, bh - 1);
    ctx.font = '700 14px "JetBrains Mono", monospace';
    ctx.fillStyle = this.holding ? C.amber : C.dim;
    ctx.textAlign = 'center';
    ctx.fillText(this.holding ? 'FILLING…' : 'HOLD TO FILL', bx + bw / 2, by + 29);
  }
}

// ───────────────────────────────── upload ─────────────────────────────────
export class UploadGame extends Minigame {
  constructor(canvas, task, hooks) {
    super(canvas, task, hooks);
    this.value = 0;
    this.marker = Math.random();
    this.dir = 1;
    this.glitch = null;
    this.glitchTimer = 1.2;
    this.missed = 0;
  }

  update(dt) {
    this.time += dt;
    this.value = Math.min(1, this.value + dt * 0.09);
    this.marker += this.dir * dt * 0.55;
    if (this.marker > 1) { this.marker = 1; this.dir = -1; }
    if (this.marker < 0) { this.marker = 0; this.dir = 1; }
    this.glitchTimer -= dt;
    if (!this.glitch && this.glitchTimer <= 0) {
      this.glitch = { start: 0.25 + Math.random() * 0.5, width: 0.10 + Math.random() * 0.08 };
      this.glitchTimer = 2.4 + Math.random() * 1.6;
    }
    if (this.glitch) {
      const inside = this.marker >= this.glitch.start && this.marker <= this.glitch.start + this.glitch.width;
      if (inside && this.keys.has('Space')) this.onKey('Space', true);
      if (this.glitch.resolved) {
        this.glitch = null;
      } else if (this.marker > this.glitch.start + this.glitch.width + 0.06) {
        this.glitch = null;
        this.value = Math.max(0, this.value - 0.12);
        this.fail('Upload corrupted');
      }
    }
    this.setProgress(this.value);
  }

  onKey(code, down) {
    if (code !== 'Space' || !down || !this.glitch || this.glitch.resolved) return;
    const inside = this.marker >= this.glitch.start && this.marker <= this.glitch.start + this.glitch.width;
    if (inside) {
      this.glitch.resolved = true;
      this.value = Math.min(1, this.value + 0.12);
      this.hooks.onTick?.();
    }
  }

  onDown() { this.onKey('Space', true); }

  render() {
    const { ctx } = this;
    this.frame('Upload Data', 'Hold SPACE (or click) when the marker is inside the green window.');
    const x = 90, y = 150, w = 540, h = 40;
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = C.line; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
    // progress fill
    ctx.fillStyle = 'rgba(73,215,232,.28)';
    ctx.fillRect(x + 2, y + 2, (w - 4) * this.value, h - 4);
    // glitch window
    if (this.glitch) {
      const gx = x + this.glitch.start * w;
      const gw = this.glitch.width * w;
      ctx.fillStyle = 'rgba(82,209,122,.25)';
      ctx.fillRect(gx, y, gw, h);
      ctx.strokeStyle = C.green;
      ctx.strokeRect(gx + .5, y + .5, gw - 1, h - 1);
    }
    // marker
    const mx = x + this.marker * w;
    ctx.fillStyle = C.amber;
    ctx.shadowColor = C.amber; ctx.shadowBlur = 14;
    ctx.fillRect(mx - 2, y - 8, 4, h + 16);
    ctx.shadowBlur = 0;
    this.glowText(`${Math.round(this.value * 100)}%`, x + w / 2, y - 40, C.cyan, 28, 'center');
    ctx.font = '400 12px Inter, sans-serif';
    ctx.fillStyle = C.dim; ctx.textAlign = 'center';
    ctx.fillText('PACKET SYNC', x + w / 2, y + h + 28);
  }
}

// ───────────────────────────────── scan ─────────────────────────────────
export class ScanGame extends Minigame {
  constructor(canvas, task, hooks) {
    super(canvas, task, hooks);
    this.pos = Math.random();
    this.dir = 1;
    this.speed = 0.55 + Math.random() * 0.25;
    this.target = 0.2 + Math.random() * 0.6;
    this.hits = 0;
    this.need = 3;
    this.misses = 0;
  }

  onDown() { this.attempt(); }
  onKey(code, down) { if (code === 'Space' && down) this.attempt(); }

  attempt() {
    if (this.done) return;
    if (Math.abs(this.pos - this.target) < 0.07) {
      this.hits++;
      this.target = 0.15 + Math.random() * 0.7;
      this.speed = 0.5 + Math.random() * 0.45;
      this.hooks.onTick?.();
      if (this.hits >= this.need) this.setProgress(1);
    } else {
      this.misses++;
      this.fail('Signal lost');
    }
  }

  update(dt) {
    this.time += dt;
    this.pos += this.dir * this.speed * dt;
    if (this.pos > 1) { this.pos = 1; this.dir = -1; }
    if (this.pos < 0) { this.pos = 0; this.dir = 1; }
  }

  render() {
    const { ctx } = this;
    this.frame('Calibrate Distortion', 'Press SPACE when the sweep crosses the target.');
    const x = 80, y = 170, w = 560, h = 54;
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = C.line; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
    const tx = x + this.target * w;
    ctx.fillStyle = 'rgba(232,212,74,.18)';
    ctx.fillRect(tx - 18, y, 36, h);
    ctx.strokeStyle = C.yellow;
    ctx.strokeRect(tx - 18.5, y + .5, 37, h - 1);
    const px = x + this.pos * w;
    ctx.fillStyle = C.cyan;
    ctx.shadowColor = C.cyan; ctx.shadowBlur = 16;
    ctx.fillRect(px - 2, y - 12, 4, h + 24);
    ctx.shadowBlur = 0;
    for (let i = 0; i < this.need; i++) {
      ctx.beginPath();
      ctx.arc(300 + i * 40, 300, 10, 0, Math.PI * 2);
      ctx.fillStyle = i < this.hits ? C.green : 'rgba(255,255,255,.12)';
      ctx.fill();
    }
    this.glowText(`SIGNAL ${this.hits}/${this.need}`, 360, 120, C.cyan, 22, 'center');
  }
}

// ───────────────────────────────── empty ─────────────────────────────────
export class EmptyGame extends Minigame {
  constructor(canvas, task, hooks) {
    super(canvas, task, hooks);
    this.level = 0.25 + Math.random() * 0.5;
    this.holding = false;
  }

  onDown() { this.holding = true; }
  onUp() { this.holding = false; }
  onKey(code, down) { if (code === 'Space') this.holding = down; }

  update(dt) {
    this.time += dt;
    if (this.holding) {
      this.level = Math.max(0, this.level - dt * 0.32);
      if (this.level <= 0) this.setProgress(1);
    }
  }

  render() {
    const { ctx } = this;
    this.frame('Empty Garbage', 'Hold the button to empty the chute.');
    const x = 220, y = 110, w = 280, h = 230;
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = C.line; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
    const fh = this.level * h;
    ctx.fillStyle = 'rgba(120,90,50,.6)';
    ctx.fillRect(x + 4, y + h - fh, w - 8, fh);
    ctx.strokeStyle = 'rgba(180,140,90,.5)';
    ctx.strokeRect(x + 4.5, y + h - fh + .5, w - 9, fh - 1);
    this.glowText(`${Math.round(this.level * 100)}% FULL`, x + w / 2, y - 22, this.level < 0.2 ? C.green : C.amber, 26, 'center');
    const bx = 220, by = 380, bw = 280, bh = 46;
    ctx.fillStyle = this.holding ? 'rgba(255,159,67,.3)' : 'rgba(255,255,255,.05)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = this.holding ? C.amber : C.line;
    ctx.strokeRect(bx + .5, by + .5, bw - 1, bh - 1);
    ctx.font = '700 14px "JetBrains Mono", monospace';
    ctx.fillStyle = this.holding ? C.amber : C.dim;
    ctx.textAlign = 'center';
    ctx.fillText(this.holding ? 'DISCHARGING…' : 'HOLD TO EMPTY', bx + bw / 2, by + 29);
  }
}

// ───────────────────────────────── start ─────────────────────────────────
export class StartGame extends Minigame {
  constructor(canvas, task, hooks) {
    super(canvas, task, hooks);
    this.seq = [1, 2, 3, 4, 5].sort(() => Math.random() - 0.5);
    this.input = [];
    this.reveal = 3.0;
    this.started = false;
  }

  onDown(x, y) {
    if (!this.started) return;
    for (let i = 0; i < 5; i++) {
      const lx = 120 + i * 100;
      if (x > lx - 34 && x < lx + 34 && y > 180 && y < 320) {
        const want = this.seq[this.input.length];
        if (i + 1 === want) {
          this.input.push(i + 1);
          this.hooks.onTick?.();
          if (this.input.length === this.seq.length) this.setProgress(1);
        } else {
          this.input = [];
          this.fail('Sequence lost - try again');
        }
        return;
      }
    }
  }

  update(dt) {
    this.time += dt;
    if (this.reveal > 0) {
      this.reveal -= dt;
      if (this.reveal <= 0) this.started = true;
    }
  }

  render() {
    const { ctx } = this;
    this.frame('Start Reactor', this.reveal > 0 ? 'Memorise the sequence…' : 'Pull the levers in order');
    for (let i = 0; i < 5; i++) {
      const lx = 120 + i * 100;
      const lit = this.reveal > 0 ? this.seq.indexOf(i + 1) >= 0 : this.input.includes(i + 1);
      const active = this.reveal > 0 && this.seq[this.seq.length - 1] === i + 1;
      ctx.fillStyle = lit ? 'rgba(255,159,67,.25)' : 'rgba(0,0,0,.45)';
      ctx.fillRect(lx - 34, 180, 68, 140);
      ctx.strokeStyle = lit ? C.amber : C.line;
      ctx.strokeRect(lx - 33.5, 180.5, 67, 139);
      ctx.fillStyle = lit ? C.amber : C.dim;
      ctx.font = '700 26px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), lx, 262);
      if (active) {
        ctx.strokeStyle = C.cyan;
        ctx.shadowColor = C.cyan; ctx.shadowBlur = 12;
        ctx.strokeRect(lx - 36.5, 177.5, 73, 145);
        ctx.shadowBlur = 0;
      }
    }
    ctx.font = '400 12px Inter, sans-serif';
    ctx.fillStyle = C.dim;
    if (this.reveal > 0) this.glowText(this.seq.join('  →  '), 360, 110, C.cyan, 20, 'center');
    ctx.fillText(this.reveal > 0 ? `Starting in ${Math.ceil(this.reveal)}…` : `Step ${this.input.length + 1} of ${this.seq.length}`, 360, 360);
  }
}

// ───────────────────────────────── unlock ─────────────────────────────────
export class UnlockGame extends Minigame {
  constructor(canvas, task, hooks) {
    super(canvas, task, hooks);
    this.levers = [false, false];
    this.holding = false;
  }

  onDown(x, y) {
    for (let i = 0; i < 2; i++) {
      const lx = 220 + i * 280;
      if (x > lx - 40 && x < lx + 40 && y > 160 && y < 280) {
        this.levers[i] = !this.levers[i];
        this.hooks.onTick?.();
        if (this.levers[0] && this.levers[1]) this.setProgress(1);
      }
    }
  }

  onKey(code, down) { if (code === 'Space') this.holding = down; }

  update(dt) { this.time += dt; }

  render() {
    const { ctx } = this;
    this.frame('Unlock Manifolds', 'Throw both manifold levers.');
    for (let i = 0; i < 2; i++) {
      const lx = 220 + i * 280;
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(lx - 40, 160, 80, 120);
      ctx.strokeStyle = this.levers[i] ? C.green : C.line;
      ctx.strokeRect(lx - 39.5, 160.5, 79, 119);
      ctx.fillStyle = this.levers[i] ? C.green : C.dim;
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = this.levers[i] ? 14 : 0;
      ctx.beginPath();
      ctx.arc(lx, this.levers[i] ? 210 : 230, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.font = '600 12px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = C.dim;
      ctx.fillText(`MANIFOLD ${i + 1}`, lx, 310);
    }
  }
}

const REGISTRY = {
  wires: WiresGame,
  divert: DivertGame,
  fuel: FuelGame,
  upload: UploadGame,
  scan: ScanGame,
  empty: EmptyGame,
  start: StartGame,
  unlock: UnlockGame,
};

export function createMinigame(canvas, task, hooks) {
  const Cls = REGISTRY[task.type] || UploadGame;
  return new Cls(canvas, task, hooks);
}
