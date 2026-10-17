/** Keyboard / mouse input with pointer lock. */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;
    this.sensitivity = 1;
    this.invertY = false;
    this.buttons = new Set();
    this._pressed = new Set();
    this._clicked = new Set();
    this.onLockChange = null;

    window.addEventListener('keydown', e => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName)) return;
      if (e.repeat) return;
      const k = e.code;
      this.keys.add(k);
      this._pressed.add(k);
      if (['Tab', 'Space', 'KeyE', 'KeyF', 'KeyQ', 'KeyR', 'KeyM'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', e => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); this.buttons.clear(); });

    document.addEventListener('pointerlockchange', () => {
      this.mouseDX = 0; this.mouseDY = 0;
      this.locked = document.pointerLockElement === canvas;
      this.onLockChange && this.onLockChange(this.locked);
    });
    document.addEventListener('mousemove', e => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });
    canvas.addEventListener('mousedown', e => {
      this.buttons.add(e.button);
      this._clicked.add(e.button);
    });
    window.addEventListener('mouseup', e => this.buttons.delete(e.button));
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  requestLock() {
    if (!this.locked && this.canvas.requestPointerLock) {
      const p = this.canvas.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  }

  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  down(code) { return this.keys.has(code); }
  pressed(code) { return this._pressed.has(code); }
  clicked(btn = 0) { return this._clicked.has(btn); }

  /** Movement vector in local space (x = strafe, z = forward). */
  moveAxis() {
    let x = 0, z = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) z += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) z -= 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    return { x, z };
  }

  get running() { return this.down('ShiftLeft') || this.down('ShiftRight'); }

  consumeMouse() {
    const dx = this.mouseDX * 0.0022 * this.sensitivity;
    const dy = this.mouseDY * 0.0022 * this.sensitivity * (this.invertY ? -1 : 1);
    this.mouseDX = 0; this.mouseDY = 0;
    return { dx, dy };
  }

  endFrame() {
    this._pressed.clear();
    this._clicked.clear();
  }
}
