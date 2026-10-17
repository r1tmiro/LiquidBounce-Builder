/** Ship map (minimap + fullscreen map). */
import { ROOMS, CORRIDORS, DOORS, TASKS, VENTS, EMERGENCY_BUTTON } from '../../../shared/map/definition.js';

const BOUNDS = { minX: 2, minZ: 2, maxX: 82, maxZ: 74 };

export class Minimap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  draw(opts) {
    const {
      players = [], bodies = [], myId = null, role = 'crew',
      showTasks = true, showLabels = true, showVents = false, big = false,
    } = opts;
    const { ctx, canvas } = this;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const pad = big ? 30 : 8;
    const sx = (w - pad * 2) / (BOUNDS.maxX - BOUNDS.minX);
    const sz = (h - pad * 2) / (BOUNDS.maxZ - BOUNDS.minZ);
    const s = Math.min(sx, sz);
    const ox = pad + ((w - pad * 2) - (BOUNDS.maxX - BOUNDS.minX) * s) / 2;
    const oz = pad + ((h - pad * 2) - (BOUNDS.maxZ - BOUNDS.minZ) * s) / 2;
    const X = x => ox + (x - BOUNDS.minX) * s;
    const Z = z => oz + (z - BOUNDS.minZ) * s;

    // backdrop
    ctx.fillStyle = 'rgba(6,10,14,.72)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(120,160,200,.18)';
    ctx.strokeRect(.5, .5, w - 1, h - 1);

    // corridors
    ctx.fillStyle = 'rgba(120,160,200,.10)';
    for (const c of CORRIDORS) {
      ctx.fillRect(X(c.rect[0]), Z(c.rect[1]), c.rect[2] * s, c.rect[3] * s);
    }
    // rooms
    for (const r of ROOMS) {
      ctx.fillStyle = 'rgba(150,190,230,.16)';
      ctx.fillRect(X(r.rect[0]), Z(r.rect[1]), r.rect[2] * s, r.rect[3] * s);
      ctx.strokeStyle = 'rgba(150,190,230,.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(X(r.rect[0]) + .5, Z(r.rect[1]) + .5, r.rect[2] * s - 1, r.rect[3] * s - 1);
      if (showLabels) {
        ctx.fillStyle = 'rgba(200,220,240,.6)';
        ctx.font = `${big ? 13 : 8}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(r.name.toUpperCase(), X(r.rect[0] + r.rect[2] / 2), Z(r.rect[1] + r.rect[3] / 2) + 3);
      }
    }
    // doorways
    ctx.fillStyle = 'rgba(255,159,67,.55)';
    for (const d of DOORS) {
      const room = ROOMS.find(r => r.id === d.room);
      if (!room) continue;
      if (d.side === 'north' || d.side === 'south') {
        const z = d.side === 'north' ? room.rect[1] : room.rect[1] + room.rect[3];
        ctx.fillRect(X(d.at - d.width / 2), Z(z) - 1.5, d.width * s, 3);
      } else {
        const x = d.side === 'west' ? room.rect[0] : room.rect[0] + room.rect[2];
        ctx.fillRect(X(x) - 1.5, Z(d.at - d.width / 2), 3, d.width * s);
      }
    }
    // emergency button
    ctx.fillStyle = '#e03a3a';
    ctx.beginPath();
    ctx.arc(X(EMERGENCY_BUTTON.pos[0]), Z(EMERGENCY_BUTTON.pos[2]), big ? 6 : 3, 0, Math.PI * 2);
    ctx.fill();

    if (showVents) {
      ctx.fillStyle = 'rgba(150,190,230,.5)';
      for (const v of VENTS) {
        ctx.fillRect(X(v.pos[0]) - 2, Z(v.pos[2]) - 2, 4, 4);
      }
    }

    if (showTasks) {
      ctx.fillStyle = 'rgba(255,159,67,.85)';
      for (const t of TASKS) {
        ctx.fillRect(X(t.pos[0]) - 2.5, Z(t.pos[2]) - 2.5, 5, 5);
      }
    }

    // bodies
    for (const b of bodies) {
      if (b.reported) continue;
      ctx.strokeStyle = '#e03a3a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(X(b.x) - 4, Z(b.z) - 4);
      ctx.lineTo(X(b.x) + 4, Z(b.z) + 4);
      ctx.moveTo(X(b.x) + 4, Z(b.z) - 4);
      ctx.lineTo(X(b.x) - 4, Z(b.z) + 4);
      ctx.stroke();
    }

    // players
    for (const p of players) {
      if (!p.alive) continue;
      const px = X(p.x), pz = Z(p.z);
      const isMe = p.id === myId;
      const isImp = role === 'impostor' && p.impostorMark === 'impostor';
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(px, pz, isMe ? (big ? 8 : 4.5) : (big ? 7 : 4), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = isMe ? '#ffffff' : 'rgba(0,0,0,.6)';
      ctx.lineWidth = isMe ? 2 : 1;
      ctx.stroke();
      if (isImp) {
        ctx.strokeStyle = '#e03a3a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, pz, (isMe ? 8 : 4.5) + 3.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (big) {
        ctx.fillStyle = 'rgba(230,240,250,.9)';
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(p.name, px, pz - 12);
      }
    }
  }
}
