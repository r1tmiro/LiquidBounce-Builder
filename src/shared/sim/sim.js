/**
 * Game simulation for "Among Us: Night Shift".
 *
 * Authoritative, deterministic and completely free of rendering concerns, so the
 * exact same code runs inside the Node server (online games) and inside the
 * renderer (offline single player with bots).
 */
import { NavGrid } from './grid.js';
import { makeRng, shuffle, clamp, dist } from './rng.js';
import {
  TASKS, VENTS, VENT_LINKS, SPAWNS, PLAYER_COLORS, PLAYER_NAMES, ROOMS, EMERGENCY_BUTTON,
} from '../map/definition.js';

export const PHASE = { LOBBY: 'lobby', PLAYING: 'playing', MEETING: 'meeting', GAMEOVER: 'gameover' };
export const ROLE = { CREW: 'crew', IMPOSTOR: 'impostor' };

export const RULES = {
  playerRadius: 0.42,
  walkSpeed: 2.55,
  runSpeed: 3.85,
  killRange: 1.45,
  killCooldown: 22,
  ventCooldown: 9,
  reportRange: 1.9,
  sabotageCooldown: 42,
  meetingDuration: 28,
  taskDuration: 300,
  sabotageFixTime: 45,
  taskCountMin: 2,
  taskCountMax: 4,
};

let nextId = 1;

export class Sim {
  constructor(opts = {}) {
    this.opts = opts;
    this.rng = makeRng(opts.seed ?? Math.floor(Math.random() * 1e9));
    this.grid = new NavGrid();
    this.grid.build();
    this.players = new Map();
    this.bodies = [];
    this.events = [];
    this.phase = PHASE.LOBBY;
    this.time = 0;
    this.duration = opts.duration ?? RULES.taskDuration;
    this.impostorCount = opts.impostors ?? 2;
    this.meeting = null;
    this.sabotage = null;
    this.winner = null;
    this.winReason = '';
    this.emergencyUsed = false;
    this.emergencyPos = { ...EMERGENCY_BUTTON.pos, x: EMERGENCY_BUTTON.pos[0], z: EMERGENCY_BUTTON.pos[2] };
    this.ventGraph = this.buildVentGraph();
    this.started = false;
    this.taskSessions = new Map();
  }

  // ------------------------------------------------------------------ setup

  buildVentGraph() {
    const g = new Map();
    for (const v of VENTS) g.set(v.id, []);
    for (const [a, b] of VENT_LINKS) {
      g.get(a)?.push(b);
      g.get(b)?.push(a);
    }
    return g;
  }

  addPlayer({ name, color, bot = false, id = null, ready = false } = {}) {
    const pid = id || `p${nextId++}`;
    const used = new Set([...this.players.values()].map(p => p.color));
    let c = color && !used.has(color) ? color : PLAYER_COLORS.find(x => !used.has(x)) || PLAYER_COLORS[0];
    const usedNames = new Set([...this.players.values()].map(p => p.name));
    const n = name && !usedNames.has(name) ? name : PLAYER_NAMES.find(x => !usedNames.has(x)) || `Crew${pid}`;
    const spawn = SPAWNS[this.players.size % SPAWNS.length];
    const player = {
      id: pid,
      name: n,
      color: c,
      isBot: bot,
      role: ROLE.CREW,
      alive: true,
      ghost: false,
      x: spawn.pos[0] + (this.rng() - 0.5) * 2.5,
      z: spawn.pos[2] + (this.rng() - 0.5) * 2.5,
      yaw: this.rng() * Math.PI * 2,
      vx: 0, vz: 0,
      speed: 0,
      input: { mx: 0, mz: 0, run: false },
      tasks: [],
      taskIndex: 0,
      taskActive: null,
      venting: false,
      ventProgress: 0,
      ventTarget: null,
      killCooldown: 0,
      ventCooldown: 0,
      sabotageCooldown: 10,
      bodyId: null,
      ready,
      lastAction: 0,
      hasVents: false,
    };
    this.players.set(pid, player);
    return player;
  }

  removePlayer(id) {
    this.players.delete(id);
  }

  setReady(id, ready) {
    const p = this.players.get(id);
    if (p) p.ready = ready;
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.phase = PHASE.PLAYING;
    this.time = 0;
    const ids = [...this.players.keys()];
    // choose impostors
    const shuffled = shuffle(ids, this.rng);
    const impostors = new Set(shuffled.slice(0, Math.min(this.impostorCount, ids.length)));
    let taskTotal = 0;
    for (const p of this.players.values()) {
      p.role = impostors.has(p.id) ? ROLE.IMPOSTOR : ROLE.CREW;
      const count = p.role === ROLE.CREW
        ? this.rngInt(RULES.taskCountMin, RULES.taskCountMax)
        : this.rngInt(RULES.taskCountMin, RULES.taskCountMax) - 1;
      const pool = shuffle(TASKS, this.rng);
      p.tasks = pool.slice(0, Math.max(1, count)).map(t => ({
        id: t.id, type: t.type, label: t.label, room: t.room,
        pos: t.pos, progress: 0, done: false,
      }));
      if (p.role === ROLE.CREW) taskTotal += p.tasks.length;
    }
    this.totalTasks = taskTotal;
    this.emit({ type: 'gameStart', impostors: [...impostors] });
  }

  rngInt(a, b) { return a + Math.floor(this.rng() * (b - a + 1)); }

  /** Accepts a player object or an id and returns the player (or null). */
  resolvePlayer(p) {
    if (!p) return null;
    if (typeof p === 'string') return this.players.get(p) || null;
    return this.players.get(p.id) || null;
  }

  emit(ev) {
    ev.t = this.time;
    this.events.push(ev);
    if (this.events.length > 256) this.events.splice(0, this.events.length - 256);
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ----------------------------------------------------------------- update

  update(dt) {
    if (this.phase !== PHASE.PLAYING) {
      if (this.phase === PHASE.MEETING) this.updateMeeting(dt);
      return;
    }
    dt = Math.min(dt, 0.05);
    this.time += dt;

    for (const p of this.players.values()) {
      p.killCooldown = Math.max(0, p.killCooldown - dt);
      p.ventCooldown = Math.max(0, p.ventCooldown - dt);
      p.sabotageCooldown = Math.max(0, p.sabotageCooldown - dt);
      if (p.venting) { this.updateVenting(p, dt); continue; }
      this.movePlayer(p, dt);
    }

    // sabotage timer
    if (this.sabotage) {
      this.sabotage.timer -= dt;
      if (this.sabotage.timer <= 0) {
        if (this.sabotage.kind === 'reactor') {
          this.endGame(ROLE.IMPOSTOR, 'The reactor failed.');
          return;
        }
        this.emit({ type: 'sabotageEnd', kind: this.sabotage.kind });
        this.sabotage = null;
      }
    }

    // Round deadline: crew must finish their tasks before evacuation closes.
    if (this.time >= this.duration) { this.endGame(ROLE.IMPOSTOR, 'Time ran out. The ship was lost.'); return; }
    // win conditions
    this.checkWin();
  }

  movePlayer(p, dt) {
    const speed = p.input.run ? RULES.runSpeed : RULES.walkSpeed;
    const len = Math.hypot(p.input.mx, p.input.mz);
    let tx = 0, tz = 0;
    if (len > 0.01) {
      tx = (p.input.mx / len) * speed;
      tz = (p.input.mz / len) * speed;
      p.yaw = Math.atan2(tx, tz);
    }
    // smooth acceleration
    const accel = p.ghost ? 12 : 18;
    p.vx += (tx - p.vx) * Math.min(1, accel * dt);
    p.vz += (tz - p.vz) * Math.min(1, accel * dt);
    const nx = p.x + p.vx * dt;
    const nz = p.z + p.vz * dt;
    const res = this.grid.resolve(nx, nz, RULES.playerRadius);
    p.x = res.x; p.z = res.z;
    p.speed = Math.hypot(p.vx, p.vz);
    if (p.speed < 0.05) p.speed = 0;
  }

  updateVenting(p, dt) {
    p.ventProgress += dt * 1.6;
    if (p.ventProgress >= 1) {
      p.ventProgress = 0;
      p.venting = false;
      const target = VENTS.find(v => v.id === p.ventTarget);
      if (target) {
        p.x = target.pos[0];
        p.z = target.pos[2];
        this.emit({ type: 'vent', player: p.id, vent: target.id });
      }
      p.ventTarget = null;
    }
  }

  // ----------------------------------------------------------------- input

  setInput(id, input) {
    const p = this.players.get(id);
    if (!p) return;
    p.input.mx = Number.isFinite(input.mx) ? clamp(input.mx, -1, 1) : 0;
    p.input.mz = Number.isFinite(input.mz) ? clamp(input.mz, -1, 1) : 0;
    p.input.run = !!input.run;
  }

  /** Discrete commands from clients. */
  command(id, cmd) {
    const p = this.players.get(id);
    if (!p || !cmd || typeof cmd !== 'object') return;
    switch (cmd.type) {
      case 'taskBegin': return this.cmdTaskBegin(p, cmd);
      case 'task': return this.cmdTask(p, cmd);
      case 'kill': return this.cmdKill(p, cmd);
      case 'report': return this.cmdReport(p, cmd);
      case 'meeting': return this.cmdEmergencyMeeting(p);
      case 'vote': return this.cmdVote(p, cmd);
      case 'vent': return this.cmdVent(p, cmd);
      case 'sabotage': return this.cmdSabotage(p, cmd);
      case 'fixSabotage': return this.cmdFixSabotage(p, cmd);
      case 'chat': {
        if (this.phase !== PHASE.MEETING || !p.alive || typeof cmd.text !== 'string') return;
        const now = Date.now();
        if (now - (p.lastChat || 0) < 700) return;
        p.lastChat = now;
        this.emit({type:'chat', player:p.id, name:p.name, text:cmd.text.trim().slice(0,180)});
        return;
      }
      case 'ready': this.setReady(id, !!cmd.value); return;
      case 'leave': this.players.delete(id); return;
      default: return;
    }
  }

  cmdTaskBegin(p, cmd) {
    if (!p.alive && !p.ghost || this.phase !== PHASE.PLAYING) return;
    const task = p.tasks.find(t => t.id === cmd.id && !t.done);
    if (!task || dist(p.x, p.z, task.pos[0], task.pos[2]) > 2.5) return;
    this.taskSessions.set(p.id + ':' + task.id, this.time);
  }

  cmdTask(p, cmd) {
    p = this.resolvePlayer(p);
    if (!p || this.phase !== PHASE.PLAYING) return;
    const task = p.tasks.find(t => t.id === cmd.id && !t.done);
    if (!task || dist(p.x, p.z, task.pos[0], task.pos[2]) > 2.5) return;
    const since = this.taskSessions.get(p.id + ':' + task.id);
    if (since === undefined) return;
    if (!Number.isFinite(cmd.progress)) return;
    task.progress = Math.max(task.progress, clamp(cmd.progress, 0, 1));
    if (task.progress >= 1) {
      task.done = true;
      this.taskSessions.delete(p.id + ':' + task.id);
      this.emit({ type: 'taskDone', player: p.id, task: task.id, label: task.label });
      this.checkWin();
    }
  }

  cmdKill(p, cmd) {
    p = this.resolvePlayer(p);
    if (!p || this.phase !== PHASE.PLAYING) return;
    if (p.role !== ROLE.IMPOSTOR || !p.alive) return;
    if (p.killCooldown > 0) return;
    const target = this.players.get(cmd.target);
    if (!target || !target.alive || target.id === p.id || target.role === ROLE.IMPOSTOR || p.venting || target.venting) return;
    if (dist(p.x, p.z, target.x, target.z) > RULES.killRange) return;
    if (!this.grid.lineOfSight({ x: p.x, z: p.z }, { x: target.x, z: target.z })) return;
    target.alive = false;
    target.ghost = true;
    target.bodyId = `b${nextId++}`;
    target.vx = 0; target.vz = 0;
    this.bodies.push({
      id: target.bodyId, x: target.x, z: target.z, color: target.color, name: target.name,
      reported: false, playerId: target.id,
    });
    p.killCooldown = RULES.killCooldown;
    this.emit({ type: 'kill', killer: p.id, victim: target.id, x: target.x, z: target.z });
    this.checkWin();
  }

  cmdReport(p, cmd) {
    p = this.resolvePlayer(p);
    if (!p || this.phase !== PHASE.PLAYING) return;
    if (!p.alive) return;
    const body = this.bodies.find(b => b.id === cmd.body);
    if (!body || body.reported) return;
    if (dist(p.x, p.z, body.x, body.z) > RULES.reportRange) return;
    body.reported = true;
    this.startMeeting('report', p.id, body.id);
  }

  cmdEmergencyMeeting(p) {
    p = this.resolvePlayer(p);
    if (!p || this.phase !== PHASE.PLAYING) return;
    if (!p.alive || this.emergencyUsed) return;
    if (dist(p.x, p.z, this.emergencyPos.x, this.emergencyPos.z) > 2.2) return;
    this.emergencyUsed = true;
    this.startMeeting('emergency', p.id, null);
  }

  cmdVent(p, cmd) {
    p = this.resolvePlayer(p);
    if (!p || this.phase !== PHASE.PLAYING) return;
    if (p.role !== ROLE.IMPOSTOR || !p.alive) return;
    if (p.ventCooldown > 0) return;
    const vent = VENTS.find(v => v.id === cmd.vent);
    if (!vent) return;
    if (dist(p.x, p.z, vent.pos[0], vent.pos[2]) > 1.6) return;
    const targets = this.ventGraph.get(vent.id) || [];
    if (!targets.length) return;
    p.venting = true;
    p.ventProgress = 0;
    p.ventTarget = targets[Math.floor(this.rng() * targets.length)];
    p.ventCooldown = RULES.ventCooldown;
    this.emit({ type: 'ventEnter', player: p.id, vent: vent.id });
  }

  cmdSabotage(p, cmd) {
    p = this.resolvePlayer(p);
    if (!p || this.phase !== PHASE.PLAYING) return;
    if (p.role !== ROLE.IMPOSTOR || !p.alive) return;
    if (p.sabotageCooldown > 0 || this.sabotage) return;
    const kind = cmd.kind === 'reactor' ? 'reactor' : 'lights';
    this.sabotage = { kind, timer: kind === 'reactor' ? RULES.sabotageFixTime : 999, by: p.id };
    p.sabotageCooldown = RULES.sabotageCooldown;
    this.emit({ type: 'sabotage', kind, by: p.id });
  }

  cmdFixSabotage(p) {
    p = this.resolvePlayer(p);
    if (!p || !this.sabotage) return;
    if (!p.alive || !['reactor', 'electrical'].includes(this.grid.roomAt(p.x, p.z)?.id)) return;
    if (this.sabotage) {
      this.sabotage = null;
      this.emit({ type: 'sabotageEnd', kind: 'repaired' });
    }
  }

  // ---------------------------------------------------------------- meeting

  startMeeting(reason, byPlayer, bodyId) {
    if (this.phase !== PHASE.PLAYING) return;
    this.phase = PHASE.MEETING;
    const deadPlayers = [...this.players.values()].filter(p => !p.alive);
    this.meeting = {
      reason, by: byPlayer, bodyId,
      timer: RULES.meetingDuration,
      votes: new Map(),
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, color: p.color, alive: p.alive,
        voted: null, hasVoted: false, isGhost: !p.alive,
      })),
    };
    this.emit({ type: 'meeting', reason, by: byPlayer, bodyId });
  }

  cmdVote(p, cmd) {
    p = this.resolvePlayer(p);
    if (!p || !p.alive || this.phase !== PHASE.MEETING || !this.meeting || this.meeting.votes.has(p.id)) return;
    const target = cmd.target || null;
    if (target && !this.players.get(target)?.alive) return;
    this.meeting.votes.set(p.id, target);
    const entry = this.meeting.players.find(x => x.id === p.id);
    if (entry) { entry.voted = target; entry.hasVoted = true; }
    this.emit({ type: 'vote', voter: p.id, target });
  }

  updateMeeting(dt) {
    if (!this.meeting) { this.phase = PHASE.PLAYING; return; }
    this.meeting.timer -= dt;
    if (!this.meeting.spoken && this.meeting.timer < 24) {
      this.meeting.spoken = true;
      const speaker = this.alivePlayers().find(p => p.isBot);
      if (speaker) this.emit({type:'chat', name:speaker.name, text:'Stay together. Did anyone see someone near the vents?'});
    }
    for (const entry of this.meeting.players) {
      const bot = this.players.get(entry.id);
      if (bot?.isBot && bot.alive && !entry.hasVoted && this.meeting.timer < 12 + this.rng() * 9) {
        const choices = this.alivePlayers().filter(p => p.id !== bot.id);
        const vote = this.rng() < 0.5 ? null : choices[Math.floor(this.rng() * choices.length)]?.id;
        this.cmdVote(bot, { target: vote });
      }
    }
    const aliveVoters = this.meeting.players.filter(x => x.alive);
    const allVoted = aliveVoters.every(x => x.hasVoted);
    if (this.meeting.timer <= 0 || (allVoted && aliveVoters.length > 0)) {
      this.resolveMeeting();
    }
  }

  resolveMeeting() {
    const m = this.meeting;
    const counts = new Map();
    for (const [voter, target] of m.votes) {
      if (!target) continue;
      counts.set(target, (counts.get(target) || 0) + 1);
    }
    let ejected = null;
    const skips = [...m.votes.values()].filter(x => !x).length;
    let best = skips;
    let tie = false;
    for (const [target, count] of counts) {
      if (count > best) { best = count; ejected = target; tie = false; }
      else if (count === best) tie = true;
    }
    if (tie) ejected = null;
    if (ejected) {
      const p = this.players.get(ejected);
      if (p) {
        p.alive = false;
        p.ghost = true;
        p.isEjected = true;
        this.emit({ type: 'ejected', player: ejected, name: p.name, color: p.color });
        if (p.role === ROLE.IMPOSTOR) {
          this.impostorsLeft = Math.max(0, (this.impostorsLeft ?? this.impostorCount) - 1);
        }
      }
    } else {
      this.emit({ type: 'ejected', player: null });
    }
    this.meeting = null;
    this.phase = PHASE.PLAYING;
    this.checkWin();
  }

  // ------------------------------------------------------------------- win

  alivePlayers() { return [...this.players.values()].filter(p => p.alive); }
  aliveImpostors() { return this.alivePlayers().filter(p => p.role === ROLE.IMPOSTOR); }
  aliveCrew() { return this.alivePlayers().filter(p => p.role === ROLE.CREW); }

  checkWin() {
    if (this.phase === PHASE.GAMEOVER || this.phase === PHASE.LOBBY) return;
    const imps = this.aliveImpostors();
    const crew = this.aliveCrew();
    if (imps.length === 0) {
      this.endGame(ROLE.CREW, 'The impostors were expelled.');
      return;
    }
    if (crew.length <= imps.length && crew.length > 0) {
      this.endGame(ROLE.IMPOSTOR, 'The impostors claimed the ship.');
      return;
    }
    if (crew.length === 0) {
      this.endGame(ROLE.IMPOSTOR, 'The ship fell silent.');
      return;
    }
    // task bar
    let done = 0, total = 0;
    for (const p of this.players.values()) {
      if (p.role !== ROLE.CREW) continue;
      for (const t of p.tasks) { total++; if (t.done) done++; }
    }
    this.taskProgress = total ? done / total : 0;
    if (this.taskProgress >= 1) {
      this.endGame(ROLE.CREW, 'All tasks completed.');
    }
  }

  endGame(winner, reason) {
    this.phase = PHASE.GAMEOVER;
    this.winner = winner;
    this.winReason = reason;
    this.emit({ type: 'gameOver', winner, reason });
  }

  // -------------------------------------------------------------- snapshot

  snapshotFor(id = null) {
    const me = id ? this.players.get(id) : null;
    return {
      phase: this.phase,
      time: this.time,
      duration: this.duration,
      taskProgress: this.taskProgress || 0,
      winner: this.winner,
      winReason: this.winReason,
      emergencyUsed: this.emergencyUsed,
      sabotage: this.sabotage ? { kind: this.sabotage.kind, timer: this.sabotage.timer } : null,
      meeting: this.meeting ? {
        reason: this.meeting.reason,
        by: this.meeting.by,
        bodyId: this.meeting.bodyId,
        timer: this.meeting.timer,
        players: this.meeting.players.map(p => ({
          id: p.id, name: p.name, color: p.color, alive: p.alive,
          hasVoted: p.hasVoted,
        })),

      } : null,
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, color: p.color, x: p.x, z: p.z, yaw: p.yaw,
        speed: p.speed, alive: p.alive, ghost: p.ghost, isBot: p.isBot,
        venting: p.venting, bodyId: p.bodyId, ready: p.ready,
        role: (me && p.id === me.id) ? p.role : undefined,
        killCooldown: me?.id === p.id ? p.killCooldown : undefined,
        ventCooldown: me?.id === p.id ? p.ventCooldown : undefined,
        threat: me && me.role !== ROLE.IMPOSTOR && p.role === ROLE.IMPOSTOR && dist(me.x, me.z, p.x, p.z) < 12 && this.grid.lineOfSight(me, p) ? true : undefined,
        impostorMark: (me && me.role === ROLE.IMPOSTOR) ? p.role : undefined,
        tasks: (me && p.id === me.id) ? p.tasks.map(t => ({
          id: t.id, label: t.label, room: t.room, type: t.type, progress: t.progress, done: t.done,
        })) : undefined,
        taskCount: (me && p.id === me.id) ? p.tasks.length : undefined,
        doneCount: (me && p.id === me.id) ? p.tasks.filter(t => t.done).length : undefined,
      })),
      bodies: this.bodies.map(b => ({ id: b.id, x: b.x, z: b.z, color: b.color, name: b.name, reported: b.reported })),
    };
  }

  /** Info the renderer needs that is not part of the public snapshot. */
  privateInfoFor(id) {
    const p = this.players.get(id);
    if (!p) return null;
    return {
      role: p.role,
      tasks: p.tasks.map(t => ({ id: t.id, label: t.label, type: t.type, progress: t.progress, done: t.done })),
      canVent: p.role === ROLE.IMPOSTOR,
      canKill: p.role === ROLE.IMPOSTOR,
      killCooldown: p.killCooldown,
      ventCooldown: p.ventCooldown,
    };
  }
}
