/**
 * Game controller - binds the simulation, the renderer, the UI and the network
 * layer together.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Sim, PHASE, ROLE, RULES } from '../../shared/sim/sim.js';
import { BotController } from '../../shared/sim/bots.js';
import { MSG, makeRoomCode } from '../../shared/net/protocol.js';
import { TASKS, VENTS, ROOMS, EMERGENCY_BUTTON, PLAYER_COLORS, PLAYER_NAMES } from '../../shared/map/definition.js';
import { View } from './view/renderer.js';
import { buildWorld, buildProps } from './view/world.js';
import { ActorManager } from './view/actors.js';
import { Input } from './systems/input.js';
import { AudioEngine } from './systems/audio.js';
import { UI, escapeHtml } from './systems/ui.js';
import { Minimap } from './systems/minimap.js';
import { WsTransport } from './net/client.js';

const MODEL_FILES = [
  'crew', 'impostor', 'husk', 'console', 'vent', 'reactor', 'crate', 'barrel',
  'table', 'chair', 'light_fixture', 'pipe_set', 'plant', 'medkit', 'server_rack', 'sign',
];

export class Game {
  constructor() {
    this.canvas = document.getElementById('scene');
    this.view = new View(this.canvas);
    this.input = new Input(this.canvas);
    this.audio = new AudioEngine();
    this.ui = new UI({ onTaskClosed: () => this.input.requestLock() });
    this.minimap = new Minimap(document.getElementById('minimap'));
    this.assets = {};
    this.sim = null;
    this.bots = null;
    this.transport = null;
    this.mode = 'menu';            // menu | solo | host | guest
    this.myId = null;
    this.myPlayerId = null;
    this.snapshot = null;
    this.targets = new Map();
    this.time = 0;
    this.bobPhase = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.dread = 0;
    this.dreadTarget = 0;
    this.lastHeartbeat = 0;
    this.lastBreath = 0;
    this.flashlightOn = false;
    this.flashlightBattery = 1;
    this.mapOpen = false;
    this.mapCanvas = null;
    this.pendingKill = null;
    this.meetingData = null;
    this.chat = [];
    this.lastSnapshotAt = 0;
    this.fps = 60;
    this._frameTimes = [];
    this.uiTick = 0;
    this.nextInputAt = 0;
    this.ready = false;
  }

  // ═══════════════════════════════════════════════════════════════ boot ══
  async boot() {
    this.ui.setLoading(0.05, 'Booting the Mako…');
    this.input.onLockChange = locked => {
      this.ui.setPointerHint(!locked && this.mode !== 'menu');
      if (!locked && this.mode !== 'menu' && !this.ui.taskOpen && this.mode !== 'menu') {
        // keep playing, the player can click to re-lock
      }
    };
    await this.loadAssets();
    this.ui.setLoading(0.7, 'Cutting power…');
    this.grid = this.sim ? this.sim.grid : null;
    this.buildScene();
    this.ready = true;
    this.ui.setLoading(1, 'Ready.');
    this.ui.hideLoading();
    this.ui.showMenu('Ready. The ship is waiting.');
    this.bindUI();
    const info = await window.gameAPI?.info?.();
    this.runtimeInfo = info;
    const addr = info?.serverUrl || (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    document.getElementById('join-host').value = addr;
    this.loop();
  }

  async loadAssets() {
    const loader = new GLTFLoader();
    let done = 0;
    await Promise.all(MODEL_FILES.map(name => new Promise(resolve => {
      loader.load(`assets/models/${name}.glb`, gltf => {
        this.assets[name] = gltf.scene;
        done++;
        this.ui.setLoading(0.05 + 0.6 * (done / MODEL_FILES.length), `Loading models… ${done}/${MODEL_FILES.length}`);
        resolve();
      }, undefined, () => {
        console.warn('failed to load model', name);
        done++;
        resolve();
      });
    })));
  }

  buildScene() {
    // a fresh sim is created per round; the grid is shared
    const probe = new Sim({ seed: 1 });
    this.world = buildWorld(this.view.scene, probe.grid);
    this.props = buildProps(this.view.scene, this.assets, probe.grid);
    this.actors = new ActorManager(this.view.scene, this.assets);
    this.grid = probe.grid;
    this.taskMarkers = new Map();
    for (const t of TASKS) {
      const marker = new THREE.Mesh(new THREE.RingGeometry(0.45,0.52,32), new THREE.MeshBasicMaterial({color:0xffb040,side:THREE.DoubleSide,transparent:true,opacity:0.8,depthWrite:false}));
      marker.rotation.x=-Math.PI/2; marker.position.set(t.pos[0],0.03,t.pos[2]);
      marker.visible=false; this.view.scene.add(marker); this.taskMarkers.set(t.id,marker);
    }
    // props also block navigation
    for (const p of Object.values(this.props.children)) {
      const r = propRadius(p.name || '');
      if (r > 0) this.grid.addObstacle(p.position.x, p.position.z, r);
    }
    // vents
    for (const v of VENTS) this.grid.addObstacle(v.pos[0], v.pos[2], 0.45);
  }

  // ═══════════════════════════════════════════════════════════════ menu ══
  bindUI() {
    const $ = id => document.getElementById(id);
    $('chat-form').addEventListener('submit', e => { e.preventDefault(); const input=$('chat-input'); if(input.value.trim()) this.sendCommand({type:'chat',text:input.value}); input.value=''; });
    $('btn-single').addEventListener('click', () => this.startSolo());
    $('btn-host').addEventListener('click', () => this.openJoinDialog('host'));
    $('btn-join').addEventListener('click', () => this.openJoinDialog('join'));
    $('btn-settings').addEventListener('click', () => { $('settings-dialog').classList.remove('hidden'); this.audio.click(); });
    $('btn-help').addEventListener('click', () => { $('help-dialog').classList.remove('hidden'); this.audio.click(); });
    $('settings-close').addEventListener('click', () => $('settings-dialog').classList.add('hidden'));
    $('help-close').addEventListener('click', () => $('help-dialog').classList.add('hidden'));
    $('join-cancel').addEventListener('click', () => $('join-dialog').classList.add('hidden'));
    $('join-go').addEventListener('click', () => this.joinFromDialog());
    $('copy-code').addEventListener('click', () => this.copyRoomCode());
    $('lobby-ready').addEventListener('click', () => this.toggleReady());
    $('lobby-leave').addEventListener('click', () => this.leaveToMenu());
    $('go-again').addEventListener('click', () => { this.ui.hideGameOver(); this.startSolo(); });
    $('report-btn').addEventListener('click', () => { this.ui.hideDeath(); this.input.requestLock(); });
    $('task-close').addEventListener('click', () => this.ui.closeTask());
    $('meeting-skip').addEventListener('click', () => this.vote(null));
    $('pause-resume').addEventListener('click', () => this.resume());
    $('pause-exit').addEventListener('click', () => this.leaveToMenu());
    this.canvas.addEventListener('click', () => {
      if (this.mode !== 'menu' && !this.ui.taskOpen) this.input.requestLock();
    });

    // settings
    const sens = $('set-sens'), fov = $('set-fov'), vol = $('set-vol');
    sens.addEventListener('input', () => {
      this.input.sensitivity = parseFloat(sens.value);
      $('set-sens-val').textContent = parseFloat(sens.value).toFixed(2);
    });
    fov.addEventListener('input', () => {
      this.view.fov = parseFloat(fov.value);
      $('set-fov-val').textContent = fov.value;
    });
    vol.addEventListener('input', () => {
      this.audio.setVolume(parseFloat(vol.value));
      $('set-vol-val').textContent = Math.round(parseFloat(vol.value) * 100) + '%';
    });
    $('set-shake').addEventListener('change', e => { this.shakeEnabled = e.target.checked; });
    $('set-grain').addEventListener('change', e => this.view.setGrain(e.target.checked));
    $('set-bloom').addEventListener('change', e => { this.view.bloom.enabled = e.target.checked; });
    $('set-quality').addEventListener('change', e => this.view.setQuality(e.target.value));
    this.shakeEnabled = true;
  }

  openJoinDialog(mode) {
    this.joinMode = mode;
    const d = document.getElementById('join-dialog');
    d.classList.remove('hidden');
    document.getElementById('join-title').textContent = mode === 'host' ? 'HOST ONLINE' : 'JOIN ONLINE';
    document.getElementById('join-desc').textContent = mode === 'host'
      ? 'Pick a room code. Other players join with the server address and that code.'
      : 'Enter the server address and the room code of the host.';
    document.getElementById('join-code').value = mode === 'host' ? makeRoomCode() : '';
    document.getElementById('join-error').textContent = '';
    this.audio.click();
  }

  async joinFromDialog() {
    const addr = document.getElementById('join-host').value.trim();
    const code = document.getElementById('join-code').value.trim().toUpperCase();
    const name = document.getElementById('join-name').value.trim() || randomName();
    const err = document.getElementById('join-error');
    err.textContent = '';
    if (!code) { err.textContent = 'Enter a room code.'; return; }
    let wsUrl;
    try { const u = new URL(addr.replace(/^http/, 'ws')); if (!['ws:', 'wss:'].includes(u.protocol)) throw new Error(); if (u.pathname === '/') u.pathname = '/ws'; wsUrl = u.href; } catch { err.textContent = 'Use ws://address:port/ws or wss://address/ws'; return; }
    try {
      this.ui.setMenuStatus('Connecting…');
      await this.connectRemote(wsUrl, code, name, this.joinMode === 'host');
      document.getElementById('join-dialog').classList.add('hidden');
    } catch (e) {
      err.textContent = e.message || 'Connection failed';
      this.ui.setMenuStatus('Connection failed');
    }
  }

  copyRoomCode() {
    const code = document.getElementById('lobby-code').textContent;
    navigator.clipboard?.writeText(code).then(
      () => this.ui.status('Room code copied'),
      () => this.ui.status('Copy failed - select it manually')
    );
  }

  toggleReady() {
    if (!this.transport) return;
    this.transport.send({ t: MSG.COMMAND, cmd: { type: 'ready', value: true } });
    this.ui.el.lobbyReady.disabled = true;
  }

  leaveToMenu() {
    const old = this.transport;
    this.transport = null;
    if (old) { old.handlers = {}; old.close(); }
    cancelAnimationFrame(this.localTimer);
    this.input.exitLock();
    this.ui.closeTask();
    document.getElementById('pause-panel').classList.add('hidden');
    this.paused = false;
    this.actors.clear();
    this.targets.clear();
    this.snapshot = null;
    this.myPlayerId = null;
    this.mapCanvas?.remove(); this.mapOpen = false;
    this.meetingData = null;
    this.sim = null;
    this.mode = 'menu';
    this.ui.hideLobby();
    this.ui.showHud(false);
    this.ui.hideMeeting();
    this.ui.hideDeath();
    this.ui.showMenu('Back at the surface.');
  }

  // ═════════════════════════════════════════════════════════════ rounds ══
  startSolo() {
    this.audio.resume();
    this.audio.startAmbient();
    this.ui.hideMenu();
    this.resetRound();
    this.ui.hideGameOver();
    this.mode = 'solo';
    this.transport = null;
    this.sim = new Sim({ seed: (Math.random() * 1e9) | 0, impostors: 2 });
    this.bots = new BotController(this.sim);
    for (let i = 0; i < 9; i++) this.sim.addPlayer({ bot: true });
    const me = this.sim.addPlayer({ name: randomName(), color: randomColor() });
    this.myPlayerId = me.id;
    this.myId = me.id;
    me.x = 22; me.z = 38;
    this.yaw = Math.PI / 2; this.pitch = 0;
    this.sim.start();
    this.applySnapshot(this.sim.snapshotFor(me.id), true);
    this.ui.showHud(true);
    this.ui.setRole(me.role);
    this.ui.status(me.role === 'impostor' ? 'You are the impostor.' : 'You are a crewmate.');
    this.input.requestLock();
    this.startLocalLoop();
  }

  async connectRemote(wsUrl, code, name, create) {
    this.audio.resume();
    this.audio.startAmbient();
    this.resetRound();
    this.mode = 'guest';
    const transport = new WsTransport({
      welcome: msg => {
        this.ui.hideMenu();
        this.transport = transport;
        this.roomCode = msg.room;
        this.myId = msg.id;
        this.myPlayerId = msg.playerId;
        this.ui.showLobby({ code: msg.room, players: [] });
        this.ui.setMenuStatus('Connected');
      },
      snapshot: snap => this.applySnapshot(snap, true),
      event: ev => this.handleEvent(ev),
      roster: r => { if (!r.started) this.ui.showLobby({ code: this.roomCode, players: r.players, started: false }); else this.ui.hideLobby(); },
      error: m => this.ui.status(m, 'danger'),
      close: () => { this.ui.status('Disconnected', 'danger'); if (this.mode !== 'menu') this.leaveToMenu(); },
    });
    this.transport = transport;
    try { await transport.connect(wsUrl, { room: code, name, color: randomColor(), create }); } catch (e) { transport.handlers = {}; transport.close(); this.transport = null; this.mode = 'menu'; throw e; }
  }

  startLocalLoop() {
    if (this.localTimer) cancelAnimationFrame(this.localTimer);
    const step = 1 / 30;
    let last = performance.now();
    let acc = 0;
    const tick = () => {
      const now = performance.now();
      acc += Math.min(0.25, (now - last) / 1000);
      last = now;
      while (acc >= step) {
        acc -= step;
        if (!this.sim || this.mode !== 'solo') return;
        if (!this.paused) { this.bots.update(step); this.sim.update(step); }
        const events = this.sim.drainEvents();
        for (const ev of events) this.handleEvent(ev);
      }
      this.applySnapshot(this.sim.snapshotFor(this.myPlayerId));
      this.localTimer = requestAnimationFrame(tick);
    };
    this.localTimer = requestAnimationFrame(tick);
  }

  resetRound() {
    cancelAnimationFrame(this.localTimer);
    this.actors.clear(); this.targets.clear(); this.snapshot = null;
    this.myPlayerId = null; this.meetingData = null; this.dead = false; this.ended = false;
    this.flashlightBattery = 1; this.flashlightOn = true; this.paused = false;
    this.ui.hideDeath(); this.ui.hideMeeting(); this.ui.hideGameOver();
    this.ui.el.lobbyReady.disabled = false;
  }

  pause() {
    this.paused = true;
    this.input.exitLock();
    document.getElementById('pause-panel').classList.remove('hidden');
  }

  resume() {
    this.paused = false;
    document.getElementById('pause-panel').classList.add('hidden');
    this.input.requestLock();
  }

  // ═══════════════════════════════════════════════════════════ snapshot ══
  applySnapshot(snap, force = false) {
    if (!snap) return;
    this.snapshot = snap;
    const now = performance.now();
    if (!force && now - this.lastSnapshotAt < 40) return;
    this.lastSnapshotAt = now;

    const ids = new Set(snap.players.map(p => p.id));
    for (const [id, a] of this.actors.actors) if (!ids.has(id)) { this.actors.group.remove(a.root); this.actors.actors.delete(id); this.targets.delete(id); }
    for (const p of snap.players) {
      const a = this.actors.ensure(p, { impostor: p.threat === true });
      if (!this.targets.has(p.id)) a.root.position.set(p.x, 0, p.z);
      a.root.visible = p.id !== this.myPlayerId && p.alive && !p.venting;
      this.targets.set(p.id, p);
      if (p.id === this.myPlayerId) {
        this.ui.setTasks(p.tasks);
        this.ui.setTaskProgress(snap.taskProgress || 0);
        if (p.role && this.ui.el.roleChip.textContent !== p.role.toUpperCase()) this.ui.setRole(p.role);
        if (p.impostorMark) this.impostorKnown = p.impostorMark;
      }
    }
    if (snap.phase === PHASE.PLAYING) { this.ui.hideLobby(); this.ui.hideMenu(); this.ui.showHud(true); }
    // bodies
    for (const b of snap.bodies) this.actors.ensureBody(b);

    if (snap.phase === PHASE.MEETING && snap.meeting) {
      if (!this.meetingData) {
        this.input.exitLock();
        this.ui.closeTask();
        this.meetingData = { ...snap.meeting, myId: this.myPlayerId };
        this.chat = [];
        this.ui.showMeeting(this.meetingData, {
          onVote: id => this.vote(id),
          onSkip: () => this.vote(null),
        });
        this.audio.meeting();
      }
      for (const p of snap.meeting.players) { const li = this.ui.el.meetingPlayers.querySelector(`[data-player="${p.id}"]`); if (li && p.hasVoted) { li.classList.add('voted'); li.querySelector('.mp-tag').textContent = 'VOTED'; } }
      this.ui.updateMeetingTimer(snap.meeting.timer);
    } else if (this.meetingData) {
      this.meetingData = null;
      this.ui.hideMeeting();
    }
    if (snap.phase === PHASE.GAMEOVER && !this.ended) this.onGameOver({ winner: snap.winner, reason: snap.winReason });
  }

  vote(target) {
    this.transport?.send({ t: MSG.COMMAND, cmd: { type: 'vote', target } });
    if (this.sim) this.sim.command(this.myPlayerId, { type: 'vote', target });
  }

  // ═════════════════════════════════════════════════════════════ events ══
  handleEvent(ev) {
    if (!ev) return;
    switch (ev.type) {
      case 'chat': { const d = document.createElement('div'); d.className='chat-msg'; d.innerHTML = '<b>'+escapeHtml(ev.name)+'</b>: '+escapeHtml(ev.text); this.ui.el.meetingChat.appendChild(d); this.ui.el.meetingChat.scrollTop=this.ui.el.meetingChat.scrollHeight; break; }
      case 'kill': {
        const victim = this.targets.get(ev.victim);
        const relX = victim ? victim.x - (this.targets.get(this.myPlayerId)?.x || 0) : 0;
        this.audio.kill(relX, 0);
        if (ev.victim === this.myPlayerId) this.onDeath(ev);
        else this.ui.status(`${victim ? victim.name : 'A crewmate'} was killed`);
        break;
      }
      case 'taskDone':
        if (ev.player === this.myPlayerId) {
          this.audio.taskDone();
          this.ui.status('Task complete', 'good');
        }
        break;
      case 'meeting':
        this.chat = [];
        this.ui.status(ev.reason === 'report' ? 'A body was reported' : 'Emergency meeting called', 'danger');
        break;
      case 'ejected':
        this.ui.status(ev.player ? `${ev.name} was ejected` : 'Nobody was ejected');
        if (ev.player === this.myPlayerId) this.onEjected();
        break;
      case 'sabotage':
        this.audio.alarm();
        this.ui.status(ev.kind === 'lights' ? 'Sabotage: lights out' : 'Sabotage: reactor down', 'danger');
        this.view.addShake(0.4);
        break;
      case 'sabotageEnd':
        this.ui.status('Sabotage repaired', 'good');
        break;
      case 'gameOver':
        this.onGameOver(ev);
        break;
      case 'vent':
        this.audio.vent();
        break;
      default: break;
    }
  }

  onDeath(ev) {
    this.ui.closeTask();
    this.ui.showDeath(false);
    this.ui.flash(0.85, 400);
    this.view.addShake(1.0);
    this.view.setFlash(0.6);
    setTimeout(() => this.view.setFlash(0), 220);
    this.input.exitLock();
    this.dead = true;
  }

  onEjected() {
    this.ui.status('You were ejected from the ship', 'danger');
    this.input.exitLock();
  }

  onGameOver(ev) {
    if (this.ended) return;
    this.ended = true;
    this.ui.closeTask(); this.ui.hideMeeting(); this.ui.hideDeath();
    const winner = ev.winner;
    const stats = {
      'Tasks done': `${Math.round((this.snapshot?.taskProgress || 0) * 100)}%`,
      'Players alive': String((this.snapshot?.players || []).filter(p => p.alive).length),
    };
    this.ui.showGameOver(winner, ev.reason, stats);
    this.input.exitLock();
  }

  // ═════════════════════════════════════════════════════════ interaction ══
  nearestInteraction() {
    const me = this.targets.get(this.myPlayerId);
    if (!me || this.snapshot?.phase !== PHASE.PLAYING) return null;
    // task consoles
    let best = null, bestD = 2.2;
    for (const t of TASKS) {
      if (!me.tasks?.some(x => x.id === t.id && !x.done)) continue;
      const d = Math.hypot(t.pos[0] - me.x, t.pos[2] - me.z);
      if (d < bestD) { bestD = d; best = { kind: 'task', task: t, label: t.label }; }
    }
    if (this.snapshot?.sabotage && ['reactor', 'electrical'].includes(this.grid.roomAt(me.x, me.z)?.id)) return {kind:'repair', label:'Repair sabotage (E)'};
    // emergency button
    const eb = EMERGENCY_BUTTON.pos;
    const dEb = Math.hypot(eb[0] - me.x, eb[2] - me.z);
    if (me.alive && dEb < 2.4 && !this.snapshot?.emergencyUsed) {
      best = { kind: 'emergency', label: 'Emergency button' };
    }
    // bodies
    for (const b of (this.snapshot?.bodies || [])) {
      if (b.reported) continue;
      const d = Math.hypot(b.x - me.x, b.z - me.z);
      if (me.alive && d < 2.0) { best = { kind: 'body', body: b, label: `Report ${b.name}'s body` }; }
    }
    // vents (impostor)
    if (this.snapshot?.players?.find(p => p.id === this.myPlayerId)?.role === 'impostor') {
      for (const v of VENTS) {
        const d = Math.hypot(v.pos[0] - me.x, v.pos[2] - me.z);
        if (d < 1.8) { best = { kind: 'vent', vent: v, label: 'Enter vent' }; }
      }
    }
    return best;
  }

  interact() {
    const target = this.nearestInteraction();
    if (!target) return;
    switch (target.kind) {
      case 'task': {
        const me = this.snapshot?.players?.find(p => p.id === this.myPlayerId);
        const myTask = me?.tasks?.find(t => t.id === target.task.id);
        if (!myTask || myTask.done) { this.ui.status('Nothing to do here'); return; }
        this.sendCommand({ type: 'taskBegin', id: target.task.id });
        this.input.exitLock();
        this.ui.openTask(target.task, {
          onProgress: p => this.sendCommand({ type: 'task', id: target.task.id, progress: p }),
          onComplete: () => { this.audio.taskDone(); this.ui.status('Task complete', 'good'); },
          onFail: msg => { this.audio.taskError(); this.ui.status(msg, 'danger'); },
        });
        break;
      }
      case 'repair': this.sendCommand({type:'fixSabotage'}); break;
      case 'emergency':
        this.sendCommand({ type: 'meeting' });
        this.ui.status('Emergency meeting called', 'danger');
        break;
      case 'body':
        this.sendCommand({ type: 'report', body: target.body.id });
        break;
      case 'vent':
        this.sendCommand({ type: 'vent', vent: target.vent.id });
        break;
      default: break;
    }
  }

  reportBody() {
    // find the closest unreported body
    const me = this.targets.get(this.myPlayerId);
    if (!me) return;
    let best = null, bestD = 2.2;
    for (const b of (this.snapshot?.bodies || [])) {
      if (b.reported) continue;
      const d = Math.hypot(b.x - me.x, b.z - me.z);
      if (d < bestD) { bestD = d; best = b; }
    }
    if (best) {
      this.sendCommand({ type: 'report', body: best.id });
      this.ui.hideDeath();
      this.input.requestLock();
    }
  }

  sendCommand(cmd) {
    if (this.transport) this.transport.send({ t: MSG.COMMAND, cmd });
    else if (this.sim) this.sim.command(this.myPlayerId, cmd);
  }

  tryKill() {
    const me = this.targets.get(this.myPlayerId);
    if (!me || me.role !== 'impostor' || !me.alive) return;
    let best = null, bestD = RULES.killRange + 0.4;
    for (const p of (this.snapshot?.players || [])) {
      if (p.id === this.myPlayerId || !p.alive) continue;
      const d = Math.hypot(p.x - me.x, p.z - me.z);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (!best) { this.ui.status('Nobody in reach', 'danger'); return; }
    this.sendCommand({ type: 'kill', target: best.id });
  }

  // ═══════════════════════════════════════════════════════════════ loop ══
  loop() {
    let last = performance.now();
    const frame = now => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.time += dt;
      this.update(dt);
      this.view.render(dt);
      this.input.endFrame();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  update(dt) {
    // look
    const m = this.input.consumeMouse();
    this.yaw -= m.dx;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - m.dy));

    const me = this.targets.get(this.myPlayerId);
    const playing = this.mode !== 'menu' && this.snapshot?.phase === PHASE.PLAYING && me;

    // movement
    if (playing && this.input.locked && !this.ui.taskOpen && !this.meetingData && !this.paused) {
      const axis = this.input.moveAxis();
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      const wx = axis.x * cos - axis.z * sin;
      const wz = -axis.x * sin - axis.z * cos;
      this.sendInput({ mx: wx, mz: wz, run: this.input.running });
      if (Math.hypot(axis.x,axis.z)>0 && this.time-(this.lastStep||0)>(this.input.running?0.32:0.52)) { this.lastStep=this.time; this.audio.footstep(this.input.running); }
      if (axis.z !== 0) this.bobPhase += dt * (this.input.running ? 13 : 8.5) * Math.abs(axis.z);
    } else if (this.mode !== 'menu') {
      this.sendInput({ mx: 0, mz: 0, run: false });
    }

    // interactions
    if (playing && !this.paused && !this.ui.taskOpen && this.input.pressed('KeyE')) this.interact();
    if (playing && !this.ui.taskOpen && this.input.pressed('KeyR')) this.tryKill();
    if (playing && this.input.pressed('KeyQ')) { const v = VENTS.find(v => Math.hypot(v.pos[0]-me.x, v.pos[2]-me.z)<1.8); if(v) this.sendCommand({type:'vent', vent:v.id}); }
    if (playing && this.input.pressed('KeyB')) this.sendCommand({type:'sabotage', kind:'lights'});
    if (playing && this.input.pressed('KeyN')) this.sendCommand({type:'sabotage', kind:'reactor'});
    if (this.input.pressed('KeyF')) this.toggleFlashlight();
    if (playing && this.input.pressed('KeyM')) this.toggleMap();
    if (this.input.pressed('Escape')) { if (this.ui.taskOpen) this.ui.closeTask(); else if (this.meetingData) this.vote(null); else if (this.mode !== 'menu' && !this.ended) this.pause(); }

    // camera
    const camPos = new THREE.Vector3();
    if (me) {
      camPos.set(me.x, 1.58, me.z);
    } else if (this.mode === 'menu') {
      const t = this.time * 0.12;
      camPos.set(42 + Math.cos(t) * 9, 2.3, 38 + Math.sin(t) * 9);
      this.yaw = -t - Math.PI / 2;
      this.pitch = -0.08;
    }
    const running = this.input.running && me;
    this.view.updateCamera(dt, { pos: camPos, yaw: this.yaw, pitch: this.pitch, running, bobPhase: this.bobPhase });
    this.view.flashlight.position.set(camPos.x, camPos.y, camPos.z);
    this.view.flashlightTarget.position.set(
      camPos.x - Math.sin(this.yaw) * 10,
      camPos.y + Math.sin(this.pitch) * 10,
      camPos.z - Math.cos(this.yaw) * 10
    );
    this.view.flashlight.intensity = this.flashlightOn ? 35 : 0;

    // world + actors
    if (this.ui.minigame) { this.ui.minigame.update(dt); if (this.ui.minigame) this.ui.minigame.render(); }
    this.world.update(dt, this.time, camPos, this.view.qualityLights || 10);
    if (this.snapshot?.sabotage?.kind === 'lights') { for (const l of this.world.lights) l.light.intensity *= 0.07; }
    this.actors.update(dt, this.snapshot?.players || [], this.targets);
    this.view.updateDread(dt, this.dreadTarget);
    for(const [id, marker] of this.taskMarkers) { marker.visible = this.mode !== 'menu' && !!me?.tasks?.some(t=>t.id===id && !t.done); marker.material.opacity=0.45+Math.sin(this.time*2)*0.2; }

    // hud
    this.uiTick += dt;
    if (this.snapshot && this.uiTick > 0.1) {
      this.uiTick = 0;
      this.ui.setClock(this.snapshot.duration - this.snapshot.time);
      this.ui.setTaskProgress(this.snapshot.taskProgress || 0);
      const meP = this.snapshot.players.find(p => p.id === this.myPlayerId);
      if (meP?.role === 'impostor') {
        const cd = this.snapshot.players.find(p => p.id === this.myPlayerId);
        this.ui.setKillCooldown(this.getKillCooldown(), RULES.killCooldown);
      }
      // interaction prompt
      const target = this.nearestInteraction();
      this.ui.setPrompt(target ? target.label : null);
      this.minimap.draw({
        players: this.snapshot.players, bodies: this.snapshot.bodies, myId: this.myPlayerId,
        role: meP?.role, showTasks: true, showLabels: false,
      });
    }

    this.updateDreadSystem(dt, me);
    this.updateFlashlight(dt);
  }

  sendInput(input) {
    if (this.transport && this.time < this.nextInputAt) return;
    this.nextInputAt = this.time + 1 / 30;
    if (this.transport) this.transport.send({ t: MSG.INPUT, input });
    else if (this.sim) this.sim.setInput(this.myPlayerId, input);
  }

  getKillCooldown() {
    if (this.sim) {
      const p = this.sim.players.get(this.myPlayerId);
      return p ? p.killCooldown : 0;
    }
    return this.targets.get(this.myPlayerId)?.killCooldown || 0;
  }

  toggleFlashlight() {
    if (this.flashlightBattery <= 0) { this.ui.status('Flashlight is dead', 'danger'); return; }
    this.flashlightOn = !this.flashlightOn;
    this.audio.click();
  }

  updateFlashlight(dt) {
    if (this.flashlightOn) {
      this.flashlightBattery = Math.max(0, this.flashlightBattery - dt * 0.012);
      if (this.flashlightBattery <= 0) this.flashlightOn = false;
    } else {
      this.flashlightBattery = Math.min(1, this.flashlightBattery + dt * 0.004);
    }
  }

  /** Dread: how close the nearest hostile is; drives audio, vignette and shake. */
  updateDreadSystem(dt, me) {
    if (!me || this.mode === 'menu') { this.dreadTarget = 0; this.ui.setDread(0); return; }
    const meP = this.snapshot?.players?.find(p => p.id === this.myPlayerId);
    let value = 0;
    if (meP?.role === 'impostor') {
      // tension from witnesses and proximity to other players
      let near = 0;
      for (const p of (this.snapshot?.players || [])) {
        if (p.id === this.myPlayerId || !p.alive) continue;
        const d = Math.hypot(p.x - me.x, p.z - me.z);
        if (d < 12) near = Math.max(near, 1 - d / 12);
      }
      value = near * 0.75;
    } else {
      let closest = 999;
      for (const p of (this.snapshot?.players || [])) {
        if (p.id === this.myPlayerId || !p.alive) continue;
        const isImpostor = p.threat;
        if (!isImpostor) continue;
        closest = Math.min(closest, Math.hypot(p.x - me.x, p.z - me.z));
      }
      if (closest < 999) value = Math.max(0, 1 - closest / 18);
    }
    this.dreadTarget = value;
    this.ui.setDread(value * 0.85);
    this.audio.setDread(value);

    if (value > 0.35) {
      const now = this.time;
      if (now - this.lastHeartbeat > 1.4 - value * 0.7) {
        this.lastHeartbeat = now;
        this.audio.heartbeat(value);
        if (this.shakeEnabled) this.view.addShake(value * 0.12);
      }
      if (value > 0.6 && now - this.lastBreath > 3.2) {
        this.lastBreath = now;
        this.audio.breath(0, 0);
      }
    }
  }

  toggleMap() {
    if (this.mapOpen) {
      this.mapCanvas?.remove();
      this.mapCanvas = null;
      this.mapOpen = false;
      this.input.requestLock();
      return;
    }
    const c = document.createElement('canvas');
    c.width = 900; c.height = 760;
    c.style.cssText = `position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
      z-index:25;border:1px solid rgba(150,180,210,.35);box-shadow:0 30px 80px rgba(0,0,0,.8);
      background:rgba(6,10,14,.95);cursor:pointer;`;
    document.getElementById('app').appendChild(c);
    c.addEventListener('click', () => this.toggleMap());
    this.mapCanvas = c;
    this.mapOpen = true;
    this.input.exitLock();
    const mini = new Minimap(c);
    const meP = this.snapshot?.players?.find(p => p.id === this.myPlayerId);
    mini.draw({
      players: this.snapshot?.players || [], bodies: this.snapshot?.bodies || [],
      myId: this.myPlayerId, role: meP?.role, showTasks: true, showLabels: true, showVents: true, big: true,
    });
  }
}

function propRadius(name) {
  const map = {
    table: 0.95, crate: 0.5, barrel: 0.32, reactor: 1.35, server_rack: 0.5,
    console: 0.4, chair: 0.35, plant: 0.28, medkit: 0.32,
  };
  return map[name] || 0;
}

function randomName() {
  return PLAYER_NAMES[Math.floor(Math.random() * PLAYER_NAMES.length)];
}
function randomColor() {
  return PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
}
