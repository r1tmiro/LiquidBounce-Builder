/**
 * Authoritative game server.
 *
 *  - hosts rooms (each room owns a simulation + bots)
 *  - broadcasts snapshots to the players
 *  - serves the built game over HTTP so a browser on the same network can play
 *
 * Usage:  node src/server/server.js --port 7777
 */
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { Sim, PHASE, ROLE, RULES } from '../shared/sim/sim.js';
import { BotController } from '../shared/sim/bots.js';
import { MSG, PROTOCOL_VERSION, makeRoomCode, decode, encode } from '../shared/net/protocol.js';
import { PLAYER_COLORS } from '../shared/map/definition.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const WEB_ROOT = path.join(ROOT, 'dist', 'renderer');

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const PORT = parseInt(getArg('port', process.env.PORT || '7777'), 10);
const HOST = getArg('host', '0.0.0.0');
const MAX_PLAYERS = parseInt(getArg('max', '10'), 10);
const BOT_FILL = parseInt(getArg('bots', '10'), 10);

// ─────────────────────────────────────────────────────────────── rooms ──
class Room {
  constructor(code, options = {}) {
    this.code = code;
    this.options = options;
    this.clients = new Map();      // clientId -> {ws, playerId, name, color}
    this.sim = new Sim({ seed: (Math.random() * 1e9) | 0, impostors: options.impostors ?? 2 });
    this.bots = new BotController(this.sim);
    this.started = false;
    this.timer = null;
    this.snapAccum = 0;
    this.nextPlayerId = 1;
  }

  get playerCount() { return this.sim.players.size; }

  addClient(ws, name, color) {
    const id = `c${this.nextPlayerId++}`;
    const player = this.sim.addPlayer({ name, color, id: `p${this.nextPlayerId++}` });
    this.clients.set(id, { ws, playerId: player.id, name: player.name, color: player.color });
    this.send(id, { t: MSG.WELCOME, id, room: this.code, protocol: PROTOCOL_VERSION, playerId: player.id });
    this.broadcastRoster();
    return id;
  }

  removeClient(id) {
    const c = this.clients.get(id);
    if (!c) return;
    this.clients.delete(id);
    this.sim.players.delete(c.playerId);
    this.sim.checkWin();
    this.broadcastRoster();
    if (this.clients.size === 0) { this.close(); rooms.rooms.delete(this.code); }
  }

  send(id, msg) {
    const c = this.clients.get(id);
    if (c && c.ws.readyState === 1) {
      try { c.ws.send(encode(msg)); } catch { /* socket died */ }
    }
  }

  broadcast(msg) {
    const raw = encode(msg);
    for (const c of this.clients.values()) {
      if (c.ws.readyState === 1) {
        try { c.ws.send(raw); } catch { /* ignore */ }
      }
    }
  }

  broadcastRoster() {
    this.broadcast({
      t: MSG.ROSTER,
      players: [...this.sim.players.values()].map(p => ({
        id: p.id, name: p.name, color: p.color, isBot: p.isBot, ready: p.ready, alive: p.alive,
      })),
      started: this.started,
    });
  }

  fillWithBots() {
    const target = Math.min(this.options.playerLimit ?? 10, BOT_FILL);
    while (this.sim.players.size < target) {
      this.sim.addPlayer({ bot: true });
    }
  }

  start() {
    if (this.started) return;
    this.fillWithBots();
    this.sim.start();
    this.started = true;
    this.broadcast({ t: MSG.EVENT, event: { type: 'gameStart' } });
    this.broadcastRoster();
    const step = 1 / 30;
    this.timer = setInterval(() => {
      this.bots.update(step);
      this.sim.update(step);
      const events = this.sim.drainEvents();
      for (const event of events) {
        if (event.type !== 'gameStart') this.broadcast({ t: MSG.EVENT, event });
      }
      this.snapAccum += step;
      if (this.snapAccum >= 1 / 15) {
        this.snapAccum = 0;
        for (const [id, client] of this.clients) this.send(id, { t: MSG.SNAPSHOT, snapshot: this.sim.snapshotFor(client.playerId) });
      }
    }, 1000 / 30);
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.started = false;
  }
}

class RoomManager {
  constructor() { this.rooms = new Map(); }

  get(code) { return this.rooms.get(code.toUpperCase()); }

  create(options = {}) {
    let code = (options.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || makeRoomCode();
    while (this.rooms.has(code)) code = makeRoomCode();
    const room = new Room(code, options);
    this.rooms.set(code, room);
    return room;
  }

  remove(code) {
    const r = this.rooms.get(code);
    if (r) { r.close(); this.rooms.delete(code); }
  }
}

const rooms = new RoomManager();

// ─────────────────────────────────────────────────────── static server ──
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end('bad path'); return; }
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.resolve(WEB_ROOT, pathname.replace(/^\/+/, ''));
  if (!filePath.startsWith(WEB_ROOT + path.sep)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404); res.end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true, rooms: [...rooms.rooms.values()].map(r => ({ code: r.code, players: r.playerCount })),
    }));
    return;
  }
  serveStatic(req, res);
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8192 });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const roomCode = (url.searchParams.get('room') || '').toUpperCase();
  let clientId = null;
  let room = rooms.get(roomCode);

  ws.on('message', (raw) => {
    const msg = decode(raw.toString());
    if (!msg || typeof msg.t !== 'string') return;

    if (msg.t === MSG.HELLO) {
      if (clientId) return;
      if (room?.started || room?.playerCount >= MAX_PLAYERS) { ws.send(encode({t: MSG.ERROR, message:'Room is full or already playing'})); return; }
      if (msg.room && typeof msg.room !== 'string') return;
      const wanted = (msg.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      if (!room && wanted) {
        room = rooms.get(wanted);
        if (!room && !msg.create) { ws.send(encode({t: MSG.ERROR, message:'Room not found. Ask the host to create it first.'})); return; }
        if (!room) room = rooms.create({ playerLimit: MAX_PLAYERS, code: wanted });
      }
      if (!room) {
        room = rooms.create({ playerLimit: MAX_PLAYERS });
      }
      if (room.started || room.playerCount >= MAX_PLAYERS) { ws.send(encode({t: MSG.ERROR, message:'Room is full or already playing'})); return; }
      const name = typeof msg.name === 'string' ? msg.name.trim().slice(0,14) : 'Crewmate';
      const color = PLAYER_COLORS.includes(msg.color) ? msg.color : undefined;
      clientId = room.addClient(ws, name, color);
      // send the initial snapshot
      room.send(clientId, { t: MSG.SNAPSHOT, snapshot: room.sim.snapshotFor(room.clients.get(clientId).playerId) });
      ws.send(encode({ t: MSG.EVENT, event: { type: 'joined', room: room.code } }));
      return;
    }
    if (!room || !clientId) return;

    switch (msg.t) {
      case MSG.INPUT: {
        const c = room.clients.get(clientId);
        if (c) room.sim.setInput(c.playerId, msg.input || {});
        break;
      }
      case MSG.COMMAND: {
        const c = room.clients.get(clientId);
        if (c) {
          room.sim.command(c.playerId, msg.cmd || {});
          if (msg.cmd?.type === 'ready') {
            room.broadcastRoster();
            const humans = [...room.sim.players.values()].filter(p => !p.isBot);
            if (!room.started && humans.every(p => p.ready)) room.start();
          }
        }
        break;
      }
      case MSG.PING:
        ws.send(encode({ t: MSG.PONG }));
        break;
      case MSG.LEAVE:
        room.removeClient(clientId);
        clientId = null;
        break;
      default: break;
    }
  });

  ws.on('close', () => {
    if (room && clientId) room.removeClient(clientId);
  });
  ws.on('error', () => { /* ignore */ });
});

// ───────────────────────────────────────────────────────────── startup ──
export function startServer({ port = PORT, host = HOST, log = true } = {}) {
  return new Promise((resolve, reject) => {
    const onError = (err) => reject(err);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      const nets = Object.values(os.networkInterfaces() || {})
        .flat()
        .filter(i => i && i.family === 'IPv4' && !i.internal)
        .map(i => i.address)
        .join(', ');
      if (log) {
        console.log(`\x1b[33m[AMONG US: NIGHT SHIFT]\x1b[0m game server on http://${host}:${port}`);
        console.log(`  interfaces: ${nets || 'none'}`);
        console.log(`  websocket:  ws://${host}:${port}/ws`);
      }
      resolve({ port: server.address().port, host, address: nets, close: closeServer });
    });
  });
}

export function closeServer() {
  for (const r of rooms.rooms.values()) r.close();
  rooms.rooms.clear();
  for (const ws of wss.clients) ws.terminate();
  if (server.listening) server.close();
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  startServer().catch(err => {
    console.error('server failed to start:', err.message);
    process.exit(1);
  });
}
