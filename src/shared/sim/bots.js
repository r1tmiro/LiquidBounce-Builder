/**
 * Bot AI: crewmates work on tasks, impostors stalk and hunt.
 * Runs identically on the server and in offline single player.
 */
import { ROLE, RULES } from './sim.js';
import { TASKS, VENTS, ROOMS } from '../map/definition.js';
import { dist, clamp } from './rng.js';

const VISION = 9.5;
const HEARING = 6.0;

export class BotController {
  constructor(sim) {
    this.sim = sim;
  }

  update(dt) {
    if (this.sim.phase !== 'playing') return;
    for (const bot of this.sim.players.values()) {
      if (!bot.isBot) continue;
      if (bot.venting) continue;
      if (bot.role === ROLE.IMPOSTOR) this.updateImpostor(bot, dt);
      else this.updateCrew(bot, dt);
    }
  }

  // ------------------------------------------------------------------ crew

  updateCrew(bot, dt) {

    const sim = this.sim;

    // panic: run away from a visible impostor
    const threat = bot.alive ? this.findThreat(bot) : null;
    if (threat) {
      bot.brain = 'flee';
      this.flee(bot, threat, dt);
      return;
    }

    // report a body if one is close
    const body = bot.alive && sim.bodies.find(b => !b.reported && dist(bot.x, bot.z, b.x, b.z) < 4.5 && sim.grid.lineOfSight(bot, b));
    if (body) {
      bot.brain = 'report';
      if (!bot.path || bot.goal !== body.id) {
        bot.path = sim.grid.findPath(bot.x, bot.z, body.x, body.z) || [];
        bot.goal = body.id;
        bot.pathIndex = 0;
      }
      this.followPath(bot, dt, 1.35);
      if (dist(bot.x, bot.z, body.x, body.z) < RULES.reportRange) {
        sim.cmdReport(bot.id, { type: 'report', body: body.id });
        bot.goal = null; bot.path = null;
      }
      return;
    }

    // regular task work
    const task = bot.tasks.find(t => !t.done);
    if (!task) {
      this.wander(bot, dt);
      return;
    }
    const def = TASKS.find(t => t.id === task.id);
    if (!def) { task.done = true; return; }
    const target = { x: def.pos[0], z: def.pos[2] };

    if (!bot.path || bot.goal !== task.id) {
      bot.path = sim.grid.findPath(bot.x, bot.z, target.x, target.z) || [];
      bot.goal = task.id;
      bot.pathIndex = 0;
      if (!bot.path.length) { bot.goal = null; return; }
    }
    this.followPath(bot, dt, 0.92);

    if (dist(bot.x, bot.z, target.x, target.z) < 1.35) {
      // "do" the task
      bot.input.mx = 0; bot.input.mz = 0;
      const rate = 0.14;
      task.progress = Math.min(1, task.progress + rate * dt);
      if (task.progress >= 1) {
        task.done = true;
        sim.emit({ type: 'taskDone', player: bot.id, task: task.id, label: task.label });
        bot.goal = null; bot.path = null;
        bot.idle = 0.4 + this.sim.rng() * 0.8;
      }
    }
  }

  // -------------------------------------------------------------- impostor

  updateImpostor(bot, dt) {
    if (!bot.alive) { this.wander(bot, dt); return; }
    const sim = this.sim;
    bot.state = bot.state || 'hunt';

    // report a body to look innocent (sometimes)
    if (sim.bodies.length && this.sim.rng() < 0.004 && bot.state === 'hunt') {
      const body = sim.bodies[0];
      if (dist(bot.x, bot.z, body.x, body.z) < 12 && !body.reported) {
        bot.path = sim.grid.findPath(bot.x, bot.z, body.x, body.z) || [];
        bot.goal = body.id; bot.pathIndex = 0; bot.state = 'report';
      }
    }

    if (bot.state === 'report') {
      const body = sim.bodies.find(b => b.id === bot.goal);
      if (!body) { bot.state = 'hunt'; bot.goal = null; return; }
      this.followPath(bot, dt, 1.1);
      if (dist(bot.x, bot.z, body.x, body.z) < RULES.reportRange) {
        sim.cmdReport(bot.id, { type: 'report', body: body.id });
        bot.state = 'hunt'; bot.goal = null;
      }
      return;
    }

    // hunt: pick the closest visible crewmate
    const prey = this.findPrey(bot);
    if (prey) {
      bot.target = prey.id;
      if (dist(bot.x, bot.z, prey.x, prey.z) < RULES.killRange && bot.killCooldown <= 0) {
        sim.cmdKill(bot.id, { type: 'kill', target: prey.id });
        bot.state = 'flee';
        bot.fleeUntil = sim.time + 9;
        bot.goal = null; bot.path = null;
        return;
      }
      if (!bot.path || bot.goal !== prey.id || bot.repathTimer <= 0) {
        bot.path = sim.grid.findPath(bot.x, bot.z, prey.x, prey.z) || [];
        bot.goal = prey.id; bot.pathIndex = 0;
        bot.repathTimer = 0.5 + this.sim.rng() * 0.4;
      }
      bot.repathTimer -= dt;
      this.followPath(bot, dt, 1.02);
      return;
    }

    // no prey in sight: patrol, sabotage or vent
    bot.state = 'patrol';
    if (bot.sabotageCooldown <= 0 && !sim.sabotage && this.sim.rng() < 0.02) {
      sim.cmdSabotage(bot.id, { type: 'sabotage', kind: this.sim.rng() < 0.5 ? 'lights' : 'reactor' });
    }
    if (bot.ventCooldown <= 0 && this.sim.rng() < 0.012) {
      const vent = VENTS.find(v => dist(bot.x, bot.z, v.pos[0], v.pos[2]) < 2.2);
      if (vent) sim.cmdVent(bot.id, { type: 'vent', vent: vent.id });
    }
    // fake a task: stand at a console
    if (bot.fakeTimer === undefined) bot.fakeTimer = 6 + this.sim.rng() * 12;
    bot.fakeTimer -= dt;
    if (bot.fakeTimer <= 0) {
      bot.fakeTimer = 14 + this.sim.rng() * 20;
      const t = TASKS[Math.floor(this.sim.rng() * TASKS.length)];
      bot.path = sim.grid.findPath(bot.x, bot.z, t.pos[0], t.pos[2]) || [];
      bot.goal = 'fake-' + t.id; bot.pathIndex = 0;
    }
    this.followPath(bot, dt, 0.75);
    if (bot.goal && String(bot.goal).startsWith('fake-')) {
      const t = TASKS.find(x => 'fake-' + x.id === bot.goal);
      if (t && dist(bot.x, bot.z, t.pos[0], t.pos[2]) < 1.6) {
        bot.goal = null; bot.path = null;
        bot.fakeTimer = 10 + this.sim.rng() * 14;
      }
    }
  }

  // ------------------------------------------------------------- perception

  findPrey(bot) {
    let best = null, bestD = Infinity;
    for (const p of this.sim.players.values()) {
      if (p.id === bot.id || !p.alive || p.role === ROLE.IMPOSTOR) continue;
      const d = dist(bot.x, bot.z, p.x, p.z);
      if (d > VISION || !this.sim.grid.lineOfSight(bot, p)) continue;
      // must be in the same room or corridor
      const rb = this.sim.grid.roomAt(bot.x, bot.z);
      const pr = this.sim.grid.roomAt(p.x, p.z);
      if (rb && pr && rb.id !== pr.id) continue;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  findThreat(bot) {
    let best = null, bestD = Infinity;
    for (const p of this.sim.players.values()) {
      if (p.id === bot.id || !p.alive || p.role !== ROLE.IMPOSTOR) continue;
      const d = dist(bot.x, bot.z, p.x, p.z);
      if (d > HEARING || !this.sim.grid.lineOfSight(bot, p)) continue;
      const rb = this.sim.grid.roomAt(bot.x, bot.z);
      const pr = this.sim.grid.roomAt(p.x, p.z);
      if (rb && pr && rb.id !== pr.id) continue;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  // ------------------------------------------------------------- locomotion

  followPath(bot, dt, speedScale = 1) {
    if (!bot.path || bot.pathIndex >= bot.path.length) {
      bot.input.mx = 0; bot.input.mz = 0;
      return;
    }
    const wp = bot.path[bot.pathIndex];
    const dx = wp.x - bot.x, dz = wp.z - bot.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.65) {
      bot.pathIndex++;
      bot.input.mx = 0; bot.input.mz = 0;
      return;
    }
    bot.input.mx = (dx / d) * Math.min(1, speedScale);
    bot.input.mz = (dz / d) * Math.min(1, speedScale);
    bot.input.run = speedScale > 1.05;
  }

  flee(bot, threat, dt) {
    const dx = bot.x - threat.x, dz = bot.z - threat.z;
    const d = Math.hypot(dx, dz) || 1;
    let tx = bot.x + (dx / d) * 8;
    let tz = bot.z + (dz / d) * 8;
    if (!this.sim.grid.isWalkable(tx, tz)) {
      // pick a random free direction
      for (let i = 0; i < 8; i++) {
        const a = this.sim.rng() * Math.PI * 2;
        const nx = bot.x + Math.cos(a) * 6, nz = bot.z + Math.sin(a) * 6;
        if (this.sim.grid.isWalkable(nx, nz)) { tx = nx; tz = nz; break; }
      }
    }
    if (!bot.path || bot.goal !== 'flee' || bot.pathIndex >= bot.path.length) {
      bot.path = this.sim.grid.findPath(bot.x, bot.z, tx, tz) || [];
      bot.goal = 'flee'; bot.pathIndex = 0;
    }
    this.followPath(bot, dt, 1.45);
  }

  wander(bot, dt) {
    if (!bot.path || bot.pathIndex >= bot.path.length) {
      const room = ROOMS[Math.floor(this.sim.rng() * ROOMS.length)];
      const p = this.sim.grid.randomPointInRoom(room.id);
      if (p) {
        bot.path = this.sim.grid.findPath(bot.x, bot.z, p.x, p.z) || [];
        bot.pathIndex = 0;
      }
    }
    this.followPath(bot, dt, 0.55);
  }
}
