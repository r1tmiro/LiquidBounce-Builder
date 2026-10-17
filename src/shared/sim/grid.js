/**
 * Navigation grid: wall extraction, collision and A* pathfinding.
 * Pure logic, no rendering dependencies - runs on the server and in the browser.
 */
import { ROOMS, CORRIDORS, DOORS, WALL_HEIGHT, PROPS } from '../map/definition.js';

const EPS = 1e-4;

export class NavGrid {
  constructor(cell = 0.4) {
    this.cell = cell;
    this.walls = [];       // wall segments {x1,z1,x2,z2}
    this.rects = [];       // walkable rectangles {x,z,w,d,room,corridor}
    this.doors = [];       // doorway rectangles (also walkable)
    this.rooms = [];
    this.minX = 0; this.minZ = 0; this.w = 0; this.h = 0;
    this.blocked = null;   // Uint8Array
    this.roomOf = null;    // Int16Array (room index or -1)
    this.obstacles = PROPS.filter(p => (p.pos[1] || 0) < 0.1).flatMap(p => {
      const radius = {table:1,reactor:1.45,crate:.5,barrel:.35,server_rack:.5,chair:.25}[p.model];
      return radius ? [{x:p.pos[0],z:p.pos[2],radius:radius*(p.scale||1)}] : [];
    });
  }

  build() {
    this.rects = [];
    this.rooms = ROOMS.map(r => ({ ...r, x: r.rect[0], z: r.rect[1], w: r.rect[2], d: r.rect[3] }));
    for (const r of this.rooms) this.rects.push({ ...r, kind: 'room' });
    for (const c of CORRIDORS) {
      this.rects.push({ x: c.rect[0], z: c.rect[1], w: c.rect[2], d: c.rect[3], id: c.id, kind: 'corridor' });
    }

    // ---- doorways ----
    this.doors = [];
    for (const d of DOORS) {
      const room = this.rooms.find(r => r.id === d.room);
      if (!room) continue;
      const hw = d.width / 2;
      let rect;
      if (d.side === 'north') rect = { x: d.at - hw, z: room.z - 0.9, w: d.width, d: 1.8 };
      else if (d.side === 'south') rect = { x: d.at - hw, z: room.z + room.d - 0.9, w: d.width, d: 1.8 };
      else if (d.side === 'west') rect = { x: room.x - 0.9, z: d.at - hw, w: 1.8, d: d.width };
      else rect = { x: room.x + room.w - 0.9, z: d.at - hw, w: 1.8, d: d.width };
      this.doors.push(rect);
    }

    // ---- walls: walk the perimeter of every rect, keep the parts that are not
    //      covered by a doorway and not inside another rect's interior.
    this.walls = [];
    const step = 0.25;
    for (const rect of this.rects) {
      const edges = [
        { fixed: 'z', at: rect.z, from: rect.x, to: rect.x + rect.w, dir: [0, -1] },
        { fixed: 'z', at: rect.z + rect.d, from: rect.x, to: rect.x + rect.w, dir: [0, 1] },
        { fixed: 'x', at: rect.x, from: rect.z, to: rect.z + rect.d, dir: [-1, 0] },
        { fixed: 'x', at: rect.x + rect.w, from: rect.z, to: rect.z + rect.d, dir: [1, 0] },
      ];
      for (const e of edges) {
        const len = e.to - e.from;
        const n = Math.max(1, Math.round(len / step));
        const pts = [];
        for (let i = 0; i <= n; i++) {
          const t = e.from + (len * i) / n;
          const p = e.fixed === 'z' ? { x: t, z: e.at } : { x: e.at, z: t };
          const open = this.isDoorOpening(p.x, p.z) || this.isInterior(p.x, p.z, rect);
          pts.push({ x: p.x, z: p.z, open });
        }
        // emit wall runs
        let run = null;
        for (const p of pts) {
          if (!p.open) {
            if (!run) run = { x1: p.x, z1: p.z, x2: p.x, z2: p.z };
            else { run.x2 = p.x; run.z2 = p.z; }
          } else {
            if (run) { this.walls.push(run); run = null; }
          }
        }
        if (run) this.walls.push(run);
      }
    }
    // merge collinear duplicates
    this.walls = this.mergeWalls(this.walls);

    // ---- grid ----
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const r of this.rects) {
      minX = Math.min(minX, r.x); minZ = Math.min(minZ, r.z);
      maxX = Math.max(maxX, r.x + r.w); maxZ = Math.max(maxZ, r.z + r.d);
    }
    this.minX = minX - 1; this.minZ = minZ - 1;
    this.w = Math.ceil((maxX - minX + 2) / this.cell);
    this.h = Math.ceil((maxZ - minZ + 2) / this.cell);

    const n = this.w * this.h;
    this.blocked = new Uint8Array(n);
    this.roomOf = new Int16Array(n).fill(-1);

    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        const { x, z } = this.cellCenter(i, j);
        let inRect = -1;
        for (let k = 0; k < this.rects.length; k++) {
          const r = this.rects[k];
          if (x > r.x + EPS && x < r.x + r.w - EPS && z > r.z + EPS && z < r.z + r.d - EPS) { inRect = k; break; }
        }
        const inDoor = this.doors.some(d => x > d.x && x < d.x + d.w && z > d.z && z < d.z + d.d);
        if (inRect < 0 && !inDoor) { this.blocked[j * this.w + i] = 1; continue; }
        this.roomOf[j * this.w + i] = inRect >= 0 && this.rects[inRect].kind === 'room'
          ? this.rooms.findIndex(r => r.id === this.rects[inRect].id) : -1;
      }
    }

    // inflate walls by the player radius so the character never clips into them
    this.inflateWalls(0.42);
  }

  mergeWalls(walls) {
    const key = w => {
      const a = `${w.x1.toFixed(2)},${w.z1.toFixed(2)}`;
      const b = `${w.x2.toFixed(2)},${w.z2.toFixed(2)}`;
      return a < b ? `${a}|${b}` : `${b}|${a}`;
    };
    const seen = new Set();
    const out = [];
    for (const w of walls) {
      const k = key(w);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(w);
    }
    return out;
  }

  /** add a circular obstacle (props) that blocks navigation */
  addObstacle(x, z, radius) {
    this.obstacles.push({ x, z, radius });
  }

  inflateWalls(radius) {
    const c = this.cell;
    const reach = Math.ceil((radius + c) / c);
    for (const w of this.walls) {
      const minI = Math.max(0, Math.floor((Math.min(w.x1, w.x2) - radius - this.minX) / c) - 1);
      const maxI = Math.min(this.w - 1, Math.ceil((Math.max(w.x1, w.x2) + radius - this.minX) / c) + 1);
      const minJ = Math.max(0, Math.floor((Math.min(w.z1, w.z2) - radius - this.minZ) / c) - 1);
      const maxJ = Math.min(this.h - 1, Math.ceil((Math.max(w.z1, w.z2) + radius - this.minZ) / c) + 1);
      for (let j = minJ; j <= maxJ; j++) {
        for (let i = minI; i <= maxI; i++) {
          const p = this.cellCenter(i, j);
          if (pointSegDist(p.x, p.z, w.x1, w.z1, w.x2, w.z2) < radius + c * 0.35) {
            this.blocked[j * this.w + i] = 1;
          }
        }
      }
    }
    for (const o of this.obstacles) {
      const minI = Math.max(0, Math.floor((o.x - o.radius - this.minX) / c));
      const maxI = Math.min(this.w - 1, Math.ceil((o.x + o.radius - this.minX) / c));
      const minJ = Math.max(0, Math.floor((o.z - o.radius - this.minZ) / c));
      const maxJ = Math.min(this.h - 1, Math.ceil((o.z + o.radius - this.minZ) / c));
      for (let j = minJ; j <= maxJ; j++) {
        for (let i = minI; i <= maxI; i++) {
          const p = this.cellCenter(i, j);
          if (Math.hypot(p.x - o.x, p.z - o.z) < o.radius + 0.42) this.blocked[j * this.w + i] = 1;
        }
      }
    }
  }

  isInterior(x, z, except) {
    for (const r of this.rects) {
      if (r === except) continue;
      if (x > r.x + EPS && x < r.x + r.w - EPS && z > r.z + EPS && z < r.z + r.d - EPS) return true;
    }
    return false;
  }

  isDoorOpening(x, z) {
    for (const d of this.doors) {
      if (x > d.x - 0.05 && x < d.x + d.w + 0.05 && z > d.z - 0.05 && z < d.z + d.d + 0.05) return true;
    }
    return false;
  }

  cellCenter(i, j) {
    return { x: this.minX + (i + 0.5) * this.cell, z: this.minZ + (j + 0.5) * this.cell };
  }

  cellIndex(x, z) {
    const i = Math.floor((x - this.minX) / this.cell);
    const j = Math.floor((z - this.minZ) / this.cell);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return j * this.w + i;
  }

  isWalkable(x, z) {
    const idx = this.cellIndex(x, z);
    return idx >= 0 && this.blocked[idx] === 0;
  }

  /** Resolve a circle of `radius` at (x,z) against walls + blocked cells. */
  resolve(x, z, radius) {
    let px = x, pz = z;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const i0 = Math.floor((px - radius - this.minX) / this.cell);
      const i1 = Math.floor((px + radius - this.minX) / this.cell);
      const j0 = Math.floor((pz - radius - this.minZ) / this.cell);
      const j1 = Math.floor((pz + radius - this.minZ) / this.cell);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
          if (this.blocked[j * this.w + i] === 0) continue;
          const cx = this.minX + (i + 0.5) * this.cell;
          const cz = this.minZ + (j + 0.5) * this.cell;
          const half = this.cell / 2;
          const qx = Math.max(cx - half, Math.min(px, cx + half));
          const qz = Math.max(cz - half, Math.min(pz, cz + half));
          let dx = px - qx, dz = pz - qz;
          let d = Math.hypot(dx, dz);
          if (d >= radius) continue;
          if (d < 1e-6) {
            // deep inside the cell: push along the shortest axis
            dx = px - cx; dz = pz - cz;
            if (Math.abs(dx) > Math.abs(dz)) { dx = Math.sign(dx) || 1; dz = 0; }
            else { dz = Math.sign(dz) || 1; dx = 0; }
            d = 1;
          }
          const push = (radius - d) / d;
          px += dx * push;
          pz += dz * push;
          moved = true;
        }
      }
      if (!moved) break;
    }
    return { x: px, z: pz };
  }

  /** Nearest walkable cell centre to (x,z). */
  nearestFree(x, z, maxRadius = 12) {
    if (this.isWalkable(x, z)) return { x, z };
    const c = this.cell;
    const steps = Math.ceil(maxRadius / c);
    const ci = Math.floor((x - this.minX) / c);
    const cj = Math.floor((z - this.minZ) / c);
    for (let r = 1; r <= steps; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = ci + di, j = cj + dj;
          if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
          if (this.blocked[j * this.w + i] === 0) {
            const p = this.cellCenter(i, j);
            return p;
          }
        }
      }
    }
    return { x, z };
  }

  roomAt(x, z) {
    const idx = this.cellIndex(x, z);
    if (idx < 0) return null;
    const ri = this.roomOf[idx];
    return ri >= 0 ? this.rooms[ri] : null;
  }

  /** A* over the grid; returns an array of {x,z} waypoints (smoothed). */
  findPath(sx, sz, tx, tz) {
    const start = this.nearestFree(sx, sz);
    const goal = this.nearestFree(tx, tz);
    const s = this.cellIndex(start.x, start.z);
    const g = this.cellIndex(goal.x, goal.z);
    if (s < 0 || g < 0) return null;
    if (this.blocked[s] || this.blocked[g]) return null;

    const n = this.w * this.h;
    const gScore = new Float32Array(n).fill(Infinity);
    const fScore = new Float32Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const open = new BinaryHeap();
    const gx = goal.x - this.minX, gz = goal.z - this.minZ;
    const h = i => {
      const p = this.cellCenter(i % this.w, Math.floor(i / this.w));
      return Math.hypot(p.x - goal.x, p.z - goal.z);
    };
    gScore[s] = 0;
    fScore[s] = h(s);
    open.push(s, fScore[s]);
    const closed = new Uint8Array(n);
    let found = false;
    let guard = 0;
    while (open.size && guard++ < 200000) {
      const cur = open.pop();
      if (cur === g) { found = true; break; }
      if (closed[cur]) continue;
      closed[cur] = 1;
      const ci = cur % this.w, cj = Math.floor(cur / this.w);
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue;
          const ni = ci + di, nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= this.w || nj >= this.h) continue;
          const nIdx = nj * this.w + ni;
          if (this.blocked[nIdx] || closed[nIdx]) continue;
          if (di !== 0 && dj !== 0) {
            // no corner cutting
            if (this.blocked[cj * this.w + ni] || this.blocked[nj * this.w + ci]) continue;
          }
          const step = (di !== 0 && dj !== 0) ? 1.4142 : 1;
          const tentative = gScore[cur] + step;
          if (tentative < gScore[nIdx]) {
            came[nIdx] = cur;
            gScore[nIdx] = tentative;
            fScore[nIdx] = tentative + h(nIdx);
            open.push(nIdx, fScore[nIdx]);
          }
        }
      }
    }
    if (!found) return null;
    const path = [];
    let cur = g;
    while (cur !== -1) {
      const p = this.cellCenter(cur % this.w, Math.floor(cur / this.w));
      path.push({ x: p.x, z: p.z });
      cur = came[cur];
    }
    path.reverse();
    path[0] = { x: start.x, z: start.z };
    path[path.length - 1] = { x: goal.x, z: goal.z };
    return this.smooth(path);
  }

  /** Remove redundant waypoints using line-of-sight checks. */
  smooth(path) {
    if (path.length <= 2) return path;
    const out = [path[0]];
    let anchor = 0;
    for (let i = 2; i < path.length; i++) {
      if (!this.lineOfSight(path[anchor], path[i])) {
        out.push(path[i - 1]);
        anchor = i - 1;
      }
    }
    out.push(path[path.length - 1]);
    return out;
  }

  lineOfSight(a, b) {
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(dist / (this.cell * 0.5)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      if (!this.isWalkable(x, z)) return false;
    }
    return true;
  }

  randomPointInRoom(roomId, rng = Math.random) {
    const room = this.rooms.find(r => r.id === roomId);
    if (!room) return null;
    for (let i = 0; i < 60; i++) {
      const x = room.x + 1 + rng() * (room.w - 2);
      const z = room.z + 1 + rng() * (room.d - 2);
      if (this.isWalkable(x, z)) return { x, z };
    }
    return null;
  }
}

class BinaryHeap {
  constructor() { this.items = []; this.priorities = []; }
  get size() { return this.items.length; }
  push(item, priority) {
    this.items.push(item); this.priorities.push(priority);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.priorities[parent] <= this.priorities[i]) break;
      this.swap(i, parent); i = parent;
    }
  }
  pop() {
    const top = this.items[0];
    const lastItem = this.items.pop();
    const lastPrio = this.priorities.pop();
    if (this.items.length) {
      this.items[0] = lastItem; this.priorities[0] = lastPrio;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let smallest = i;
        if (l < this.items.length && this.priorities[l] < this.priorities[smallest]) smallest = l;
        if (r < this.items.length && this.priorities[r] < this.priorities[smallest]) smallest = r;
        if (smallest === i) break;
        this.swap(i, smallest); i = smallest;
      }
    }
    return top;
  }
  swap(a, b) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.priorities[a], this.priorities[b]] = [this.priorities[b], this.priorities[a]];
  }
}

export function pointSegDist(px, pz, x1, z1, x2, z2) {
  const dx = x2 - x1, dz = z2 - z1;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - x1) * dx + (pz - z1) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cz = z1 + t * dz;
  return Math.hypot(px - cx, pz - cz);
}

export const WALL_TOP = WALL_HEIGHT;
