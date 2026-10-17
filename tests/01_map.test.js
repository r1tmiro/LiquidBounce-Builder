/** Map integrity: connectivity, collision, task/vent reachability. */
import { NavGrid } from '../src/shared/sim/grid.js';
import { Sim, ROLE, RULES } from '../src/shared/sim/sim.js';
import { BotController } from '../src/shared/sim/bots.js';
import { ROOMS, TASKS, VENTS, SPAWNS, DOORS } from '../src/shared/map/definition.js';
import { group, ok, eq } from './harness.js';

export function run() {
  group('Map geometry');
  const grid = new NavGrid();
  grid.build();

  ok(grid.walls.length > 40, `wall segments generated (${grid.walls.length})`);
  ok(grid.w * grid.h > 10000, `nav grid allocated (${grid.w}x${grid.h})`);

  // every room must contain walkable cells
  for (const room of ROOMS) {
    const x = room.rect[0] + room.rect[2] / 2;
    const z = room.rect[1] + room.rect[3] / 2;
    ok(grid.isWalkable(x, z), `room "${room.name}" centre is walkable`);
  }

  group('Connectivity');
  const spawn = SPAWNS[0].pos;
  for (const room of ROOMS) {
    const x = room.rect[0] + room.rect[2] / 2;
    const z = room.rect[1] + room.rect[3] / 2;
    const path = grid.findPath(spawn[0], spawn[2], x, z);
    ok(!!path && path.length > 0, `path exists from cafeteria to "${room.name}"`,
      path ? '' : 'no path');
  }

  group('Doors');
  for (const door of DOORS) {
    const room = ROOMS.find(r => r.id === door.room);
    const side = door.side;
    let ax, az, bx, bz;
    if (side === 'north') { ax = door.at; az = room.rect[1] - 1.2; bx = door.at; bz = room.rect[1] + 1.2; }
    else if (side === 'south') { ax = door.at; az = room.rect[1] + room.rect[3] - 1.2; bx = door.at; bz = room.rect[1] + room.rect[3] + 1.2; }
    else if (side === 'west') { ax = room.rect[0] - 1.2; az = door.at; bx = room.rect[0] + 1.2; bz = door.at; }
    else { ax = room.rect[0] + room.rect[2] - 1.2; az = door.at; bx = room.rect[0] + room.rect[2] + 1.2; bz = door.at; }
    const path = grid.findPath(ax, az, bx, bz);
    ok(!!path, `door ${door.room}/${side} is passable`);
  }

  group('Tasks & vents');
  for (const t of TASKS) {
    ok(grid.isWalkable(t.pos[0], t.pos[2]), `task ${t.id} stand position is walkable`);
    const path = grid.findPath(spawn[0], spawn[2], t.pos[0], t.pos[2]);
    ok(!!path, `task ${t.id} is reachable`);
  }
  for (const v of VENTS) {
    const path = grid.findPath(spawn[0], spawn[2], v.pos[0], v.pos[2]);
    ok(!!path, `vent ${v.id} is reachable`);
  }

  group('Collision');
  const start = { x: 14, z: 38 };
  const res = grid.resolve(start.x, start.z, RULES.playerRadius);
  ok(Math.hypot(res.x - start.x, res.z - start.z) < 0.01, 'free space resolution is a no-op');
  // push a point into a wall: it must be pushed out
  let escaped = false;
  for (const w of grid.walls) {
    const mx = (w.x1 + w.x2) / 2, mz = (w.z1 + w.z2) / 2;
    const r = grid.resolve(mx, mz, RULES.playerRadius);
    if (Math.hypot(r.x - mx, r.z - mz) > 0.05 && grid.isWalkable(r.x, r.z)) { escaped = true; break; }
  }
  ok(escaped, 'a point inside a wall is pushed out to walkable space');

  group('Simulation');
  const sim = new Sim({ seed: 1234 });
  for (let i = 0; i < 10; i++) sim.addPlayer({ bot: i >= 4, name: 'P' + i });
  sim.start();
  eq(sim.phase, 'playing', 'simulation starts in the playing phase');
  const impostors = [...sim.players.values()].filter(p => p.role === ROLE.IMPOSTOR);
  eq(impostors.length, 2, 'two impostors are assigned');
  for (const p of sim.players.values()) {
    ok(p.tasks.length >= 1, `player ${p.name} received tasks (${p.tasks.length})`);
  }

  // run 60 seconds of simulation with bots and make sure nobody gets stuck
  const bots = new BotController(sim);
  let steps = 0;
  const dt = 1 / 30;
  for (let i = 0; i < 60 * 30; i++) {
    bots.update(dt);
    sim.update(dt);
    steps++;
  }
  ok(steps === 1800, 'simulation ran 1800 fixed steps');
  const moved = [...sim.players.values()].filter(p => p.isBot && (Math.abs(p.vx) > 0.01 || Math.abs(p.vz) > 0.01));
  ok(moved.length >= 2, `bots are moving (${moved.length} in motion)`);
  const doneTasks = [...sim.players.values()].reduce((a, p) => a + p.tasks.filter(t => t.done).length, 0);
  ok(doneTasks > 0, `bots completed tasks (${doneTasks})`);

  group('Game rules');
  const sim2 = new Sim({ seed: 99 });
  const crew = sim2.addPlayer({ name: 'Crew' });
  const imp = sim2.addPlayer({ name: 'Imp' });
  sim2.start();
  imp.role = ROLE.IMPOSTOR;
  crew.role = ROLE.CREW;
  imp.x = crew.x + 0.4; imp.z = crew.z;
  sim2.cmdKill(imp.id, { type: 'kill', target: crew.id });
  eq(crew.alive, false, 'impostor can kill an adjacent crewmate');
  ok(sim2.bodies.length === 1, 'a body is created');
  imp.killCooldown = 0;
  imp.x = crew.x + 5;
  sim2.cmdKill(imp.id, { type: 'kill', target: crew.id });
  eq(sim2.bodies.length, 1, 'a dead player cannot be killed twice');

  group('Meeting & voting');
  const sim3 = new Sim({ seed: 7 });
  const a = sim3.addPlayer({ name: 'A' });
  const b = sim3.addPlayer({ name: 'B' });
  sim3.start();
  b.role = ROLE.IMPOSTOR;
  a.role = ROLE.CREW;
  sim3.startMeeting('emergency', a.id, null);
  eq(sim3.phase, 'meeting', 'meeting phase starts');
  sim3.cmdVote(a.id, { type: 'vote', target: b.id });
  sim3.cmdVote(b.id, { type: 'vote', target: b.id });
  sim3.resolveMeeting();
  eq(b.alive, false, 'the voted player is ejected');
  eq(sim3.phase, 'gameover', 'the round ends after the final impostor is ejected');
  ok(sim3.winner === ROLE.CREW, 'the crew wins when the impostor is ejected');

  group('Win conditions');
  const sim4 = new Sim({ seed: 5 });
  const c1 = sim4.addPlayer({ name: 'C1' });
  const i1 = sim4.addPlayer({ name: 'I1' });
  sim4.start();
  c1.role = ROLE.CREW; i1.role = ROLE.IMPOSTOR;
  c1.alive = false; c1.ghost = true;
  sim4.checkWin();
  eq(sim4.winner, ROLE.IMPOSTOR, 'the impostor wins when the last crewmate dies');
}
