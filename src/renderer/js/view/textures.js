/**
 * Procedural textures - the ship is textured with generated canvas maps so the
 * game ships with zero external art dependencies.
 */
import * as THREE from 'three';

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function noise(ctx, size, amount, alpha = 0.06) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

/** Height map -> normal map (Sobel). */
export function heightToNormal(heightCanvas, strength = 2.2) {
  const size = heightCanvas.width;
  const src = heightCanvas.getContext('2d').getImageData(0, 0, size, size).data;
  const out = canvas(size);
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (x, y) => {
    const xx = (x + size) % size, yy = (y + size) % size;
    return src[(yy * size + xx) * 4] / 255;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

function tex(c, repeat = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function dataTex(c, repeat = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

/** Riveted hull plating used for walls. */
export function wallMaps(size = 512) {
  const c = canvas(size), ctx = c.getContext('2d');
  const h = canvas(size), hx = h.getContext('2d');
  ctx.fillStyle = '#3a4150';
  ctx.fillRect(0, 0, size, size);
  hx.fillStyle = '#808080';
  hx.fillRect(0, 0, size, size);

  // large panel grid
  const panels = 4;
  const step = size / panels;
  for (let i = 0; i < panels; i++) {
    for (let j = 0; j < panels; j++) {
      const shade = 0.86 + Math.random() * 0.28;
      ctx.fillStyle = `rgba(${Math.floor(58 * shade)},${Math.floor(65 * shade)},${Math.floor(80 * shade)},1)`;
      ctx.fillRect(i * step + 3, j * step + 3, step - 6, step - 6);
      hx.fillStyle = `rgba(${Math.floor(128 * shade)},${Math.floor(128 * shade)},${Math.floor(128 * shade)},1)`;
      hx.fillRect(i * step + 3, j * step + 3, step - 6, step - 6);
      // panel seam
      ctx.strokeStyle = 'rgba(10,12,16,.85)';
      ctx.lineWidth = 4;
      ctx.strokeRect(i * step, j * step, step, step);
      hx.strokeStyle = '#4a4a4a';
      hx.lineWidth = 5;
      hx.strokeRect(i * step, j * step, step, step);
      // rivets
      for (let k = 0; k < 8; k++) {
        const rx = i * step + 14 + (k % 4) * (step - 28) / 3;
        const ry = j * step + 14 + Math.floor(k / 4) * (step - 28);
        ctx.fillStyle = 'rgba(160,172,190,.5)';
        ctx.beginPath(); ctx.arc(rx, ry, 3.1, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,.35)';
        ctx.beginPath(); ctx.arc(rx, ry + 1.4, 2.2, 0, Math.PI * 2); ctx.fill();
        hx.fillStyle = '#d8d8d8';
        hx.beginPath(); hx.arc(rx, ry, 3.1, 0, Math.PI * 2); hx.fill();
      }
    }
  }
  // grime streaks
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const hgt = 20 + Math.random() * 120;
    const g = ctx.createLinearGradient(x, y, x, y + hgt);
    g.addColorStop(0, 'rgba(12,14,18,.30)');
    g.addColorStop(1, 'rgba(12,14,18,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, 2 + Math.random() * 7, hgt);
  }
  noise(ctx, size, 26);
  return {
    map: tex(c),
    normalMap: dataTex(heightToNormal(h, 1.6)),
    roughnessMap: dataTex(c, 1),
  };
}

/** Dark metal floor plates. */
export function floorMaps(size = 512) {
  const c = canvas(size), ctx = c.getContext('2d');
  const h = canvas(size), hx = h.getContext('2d');
  ctx.fillStyle = '#242a34';
  ctx.fillRect(0, 0, size, size);
  hx.fillStyle = '#7a7a7a';
  hx.fillRect(0, 0, size, size);

  const step = size / 4;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const shade = 0.85 + Math.random() * 0.3;
      ctx.fillStyle = `rgba(${Math.floor(40 * shade)},${Math.floor(46 * shade)},${Math.floor(56 * shade)},1)`;
      ctx.fillRect(i * step + 2, j * step + 2, step - 4, step - 4);
      hx.fillStyle = `rgba(${Math.floor(122 * shade)},${Math.floor(122 * shade)},${Math.floor(122 * shade)},1)`;
      hx.fillRect(i * step + 2, j * step + 2, step - 4, step - 4);
      // diamond tread
      ctx.strokeStyle = 'rgba(120,136,158,.16)';
      hx.strokeStyle = '#a8a8a8';
      ctx.lineWidth = 2; hx.lineWidth = 3;
      for (let k = 0; k < 6; k++) {
        const ox = i * step + 12 + k * (step - 24) / 5;
        const oy = j * step + 12;
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + 14, oy + 14); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ox + 14, oy); ctx.lineTo(ox, oy + 14); ctx.stroke();
        hx.beginPath(); hx.moveTo(ox, oy); hx.lineTo(ox + 14, oy + 14); hx.stroke();
        hx.beginPath(); hx.moveTo(ox + 14, oy); hx.lineTo(ox, oy + 14); hx.stroke();
      }
      ctx.strokeStyle = 'rgba(8,10,14,.8)';
      ctx.lineWidth = 3;
      ctx.strokeRect(i * step, j * step, step, step);
    }
  }
  // stains
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 12 + Math.random() * 46;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(10,12,16,.35)');
    g.addColorStop(1, 'rgba(10,12,16,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  noise(ctx, size, 22);
  return {
    map: tex(c),
    normalMap: dataTex(heightToNormal(h, 1.3)),
    roughnessMap: dataTex(c, 1),
  };
}

/** Perforated ceiling panels. */
export function ceilingMaps(size = 256) {
  const c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = '#1b1f27';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(8,10,13,.75)';
  for (let y = 0; y < size; y += 16) {
    for (let x = 0; x < size; x += 16) {
      ctx.beginPath(); ctx.arc(x + 8, y + 8, 3.4, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.strokeStyle = 'rgba(60,70,86,.5)';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, size, size);
  noise(ctx, size, 14);
  return { map: tex(c) };
}

/** Rusted metal for props. */
export function metalMaps(size = 256) {
  const c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = '#4a4f58';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 200; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 2 + Math.random() * 26;
    ctx.fillStyle = `rgba(${120 + Math.random() * 60},${60 + Math.random() * 40},${30 + Math.random() * 30},${0.05 + Math.random() * 0.12})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  noise(ctx, size, 30);
  return { map: tex(c), roughnessMap: dataTex(c, 1) };
}

/** Radial soft glow sprite used for lights and embers. */
export function glowSprite(size = 128, color = '#ffb765') {
  const c = canvas(size), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, color);
  g.addColorStop(0.25, color.replace(')', ',0.55)').replace('rgb', 'rgba'));
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
