/** DOM / interface layer. */
import { createMinigame } from './tasks.js';

const $ = id => document.getElementById(id);

export class UI {
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.el = {
      hud: $('hud'), menu: $('menu'), loading: $('loading'), loadFill: $('load-fill'),
      loadText: $('load-text'), lobby: $('lobby'), taskOverlay: $('task-overlay'),
      taskCanvas: $('task-canvas'), taskTitle: $('task-title'), taskProgress: $('task-progress-fill'),
      taskList: $('task-list'), clock: $('clock'), clockText: $('clock-text'),
      taskbarFill: $('taskbar-fill'), roleChip: $('role-chip'), prompt: $('prompt'),
      promptKey: $('prompt-key'), promptText: $('prompt-text'), statusStack: $('status-stack'),
      meeting: $('meeting'), meetingTitle: $('meeting-title'), meetingTimer: $('meeting-timer'),
      meetingPlayers: $('meeting-players'), meetingSub: $('meeting-sub'),
      meetingChat: $('meeting-chat'), meetingSkip: $('meeting-skip'),
      reportCard: $('report-card'), death: $('death-screen'), deathSub: $('death-sub'),
      reportBtn: $('report-btn'), gameover: $('gameover'), goTitle: $('go-title'),
      goSub: $('go-sub'), goStats: $('go-stats'), goAgain: $('go-again'),
      subtitle: $('subtitle'), flash: $('flash'), dread: $('dread-vignette'),
      pointerHint: $('pointer-hint'), menuStatus: $('menu-status'),
      lobbyPlayers: $('lobby-players'), lobbyCode: $('lobby-code'),
      lobbyCodeBox: $('lobby-code-box'), lobbyReady: $('lobby-ready'),
      lobbyTitle: $('lobby-title'), joinDialog: $('join-dialog'), joinError: $('join-error'),
      joinHost: $('join-host'), joinCode: $('join-code'), joinName: $('join-name'),
      joinTitle: $('join-title'), joinDesc: $('join-desc'),
      settingsDialog: $('settings-dialog'), helpDialog: $('help-dialog'),
      killCooldown: $('kill-cooldown'), kcFill: $('kc-fill'),
    };
    this.minigame = null;
    this._bindStatic();
  }

  _bindStatic() {
    this.el.taskCanvas.addEventListener('pointerdown', e => e.stopPropagation());
    this.el.taskClose?.addEventListener('click', () => this.closeTask());
  }

  // ---------------------------------------------------------------- loading

  setLoading(pct, text) {
    if (this.el.loadFill) this.el.loadFill.style.width = Math.round(pct * 100) + '%';
    if (text && this.el.loadText) this.el.loadText.textContent = text;
  }

  hideLoading() {
    if (!this.el.loading) return;
    this.el.loading.style.opacity = '0';
    setTimeout(() => this.el.loading.classList.add('hidden'), 500);
  }

  // ------------------------------------------------------------------- menu

  showMenu(status) {
    this.el.menu.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
    if (status) this.el.menuStatus.textContent = status;
  }

  hideMenu() {
    this.el.menu.classList.add('hidden');
  }

  setMenuStatus(text) { this.el.menuStatus.textContent = text; }

  // ------------------------------------------------------------------- hud

  showHud(on = true) {
    this.el.hud.classList.toggle('hidden', !on);
  }

  setClock(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    const m = Math.floor(s / 60);
    this.el.clockText.textContent = `${m}:${String(s % 60).padStart(2, '0')}`;
    this.el.clock.classList.toggle('urgent', s < 30);
  }

  setTaskProgress(p) {
    this.el.taskbarFill.style.width = (p * 100).toFixed(1) + '%';
  }

  setRole(role) {
    const chip = this.el.roleChip;
    if (!role) { chip.classList.add('hidden'); return; }
    chip.classList.remove('hidden');
    chip.textContent = role === 'impostor' ? 'IMPOSTOR' : 'CREWMATE';
    chip.classList.toggle('impostor', role === 'impostor');
  }

  setTasks(tasks) {
    const list = this.el.taskList;
    list.innerHTML = '';
    if (!tasks || !tasks.length) { list.classList.add('hidden'); return; }
    list.classList.remove('hidden');
    for (const t of tasks) {
      const li = document.createElement('li');
      if (t.done) li.classList.add('done');
      li.innerHTML = `<span class="tdot"></span><span>${escapeHtml(t.label)}</span>`;
      list.appendChild(li);
    }
  }

  setPrompt(text, key = 'E') {
    if (!text) { this.el.prompt.classList.add('hidden'); return; }
    this.el.prompt.classList.remove('hidden');
    this.el.promptKey.textContent = key;
    this.el.promptText.textContent = text;
  }

  setKillCooldown(remaining, total) {
    if (remaining <= 0) { this.el.killCooldown.classList.add('hidden'); return; }
    this.el.killCooldown.classList.remove('hidden');
    this.el.kcFill.style.width = (100 - (remaining / total) * 100).toFixed(0) + '%';
  }

  status(text, kind = '') {
    const div = document.createElement('div');
    div.className = 'status-msg' + (kind ? ' ' + kind : '');
    div.textContent = text;
    this.el.statusStack.appendChild(div);
    setTimeout(() => div.remove(), 3200);
  }

  subtitle(text, ms = 3000) {
    this.el.subtitle.textContent = text;
    this.el.subtitle.style.opacity = '1';
    clearTimeout(this._subT);
    this._subT = setTimeout(() => { this.el.subtitle.style.opacity = '0'; }, ms);
  }

  flash(alpha = 0.6, ms = 120) {
    this.el.flash.style.transition = 'none';
    this.el.flash.style.opacity = String(alpha);
    requestAnimationFrame(() => {
      this.el.flash.style.transition = `opacity ${ms}ms ease`;
      this.el.flash.style.opacity = '0';
    });
  }

  setDread(v) { this.el.dread.style.opacity = String(Math.min(1, v)); }

  setPointerHint(on) { this.el.pointerHint.classList.toggle('hidden', !on); }

  // ------------------------------------------------------------ task panel

  openTask(task, hooks) {
    this.el.taskOverlay.classList.remove('hidden');
    this.el.taskTitle.textContent = task.label || 'TASK';
    this.el.taskProgress.style.width = '0%';
    if (this.minigame) this.minigame.dispose();
    this.minigame = createMinigame(this.el.taskCanvas, task, {
      onProgress: p => {
        this.el.taskProgress.style.width = (p * 100).toFixed(0) + '%';
        hooks.onProgress?.(p);
      },
      onComplete: () => { hooks.onComplete?.(); this.closeTask(); },
      onFail: (msg) => { hooks.onFail?.(msg); },
      onTick: () => hooks.onTick?.(),
    });
  }

  closeTask() {
    this.el.taskOverlay.classList.add('hidden');
    if (this.minigame) { this.minigame.dispose(); this.minigame = null; }
    // Pointer lock must be requested in a user gesture (canvas click).
  }

  get taskOpen() { return !this.el.taskOverlay.classList.contains('hidden'); }

  // --------------------------------------------------------------- meeting

  showMeeting(data, { onVote, onSkip }) {
    this.el.meeting.classList.remove('hidden');
    this.el.meetingTitle.textContent = data.reason === 'report' ? 'DEAD BODY REPORTED' : 'EMERGENCY MEETING';
    this.el.meetingSub.textContent = data.reason === 'report'
      ? 'The body of ' + (data.bodyName || 'a crewmate') + ' was found.'
      : 'Someone called an emergency meeting.';
    this.el.meetingPlayers.innerHTML = '';
    for (const p of data.players) {
      const li = document.createElement('li');
      li.dataset.player = p.id;
      li.className = 'meet-player' + (p.alive ? '' : ' dead') + (p.voted ? ' voted' : '') + (p.id === data.myId ? ' me' : '');
      li.innerHTML = `
        <span class="mp-avatar" style="background:${p.color}"></span>
        <span class="mp-name">${escapeHtml(p.name)}</span>
        <span class="mp-tag ${p.alive ? (p.voted ? 'voted' : '') : 'dead'}">${p.alive ? (p.voted ? 'voted' : 'alive') : 'dead'}</span>`;
      if (p.alive && p.id !== data.myId) {
        li.addEventListener('click', () => { onVote?.(p.id); li.style.borderColor = '#52d17a'; });
      }
      this.el.meetingPlayers.appendChild(li);
    }
    this.el.meetingChat.innerHTML = '';
    for (const line of (data.chat || [])) {
      const d = document.createElement('div');
      d.className = 'chat-msg' + (line.sys ? ' sys' : '');
      d.innerHTML = line.sys ? escapeHtml(line.text) : `<b>${escapeHtml(line.name)}</b>: ${escapeHtml(line.text)}`;
      this.el.meetingChat.appendChild(d);
    }
    this.el.meetingSkip.textContent = onSkip ? 'Click a crewmate to vote · ESC to skip' : 'Waiting for votes…';
  }

  updateMeetingTimer(t) { this.el.meetingTimer.textContent = Math.max(0, Math.ceil(t)); }

  hideMeeting() { this.el.meeting.classList.add('hidden'); }

  // ----------------------------------------------------------------- death

  showDeath(canReport) {
    this.el.death.classList.remove('hidden');
    this.el.reportBtn.classList.remove('hidden');
    this.el.reportBtn.textContent = 'CONTINUE AS GHOST';
    this.el.deathSub.textContent = canReport
      ? 'Your body lies in the dark. Someone should find it.'
      : 'As a ghost you can still finish your tasks.';
  }

  hideDeath() { this.el.death.classList.add('hidden'); }

  // -------------------------------------------------------------- game over

  showGameOver(winner, reason, stats = {}) {
    this.el.gameover.classList.remove('hidden');
    const won = winner === 'crew';
    this.el.goTitle.textContent = won ? 'CREW VICTORY' : 'IMPOSTOR VICTORY';
    this.el.goTitle.className = won ? 'win' : 'lose';
    this.el.goSub.textContent = reason || '';
    this.el.goStats.innerHTML = Object.entries(stats)
      .map(([k, v]) => `<div>${escapeHtml(k.toUpperCase())}<b>${escapeHtml(String(v))}</b></div>`)
      .join('');
  }

  hideGameOver() { this.el.gameover.classList.add('hidden'); }

  // ----------------------------------------------------------------- lobby

  showLobby({ code, players, started }) {
    this.el.lobby.classList.remove('hidden');
    this.el.lobbyCodeBox.classList.toggle('hidden', !code);
    if (code) this.el.lobbyCode.textContent = code;
    this.el.lobbyTitle.textContent = started ? 'ROUND IN PROGRESS' : 'WAITING FOR CREW';
    this.el.lobbyPlayers.innerHTML = '';
    for (const p of players) {
      const li = document.createElement('li');
      li.className = 'lobby-player' + (p.ready ? ' ready' : '');
      li.innerHTML = `<span class="lp-dot" style="background:${p.color}"></span>
        <span>${escapeHtml(p.name)}${p.isBot ? ' <em style="opacity:.5">(bot)</em>' : ''}</span>
        <span class="lp-state">${p.ready ? 'READY' : 'waiting'}</span>`;
      this.el.lobbyPlayers.appendChild(li);
    }
  }

  hideLobby() { this.el.lobby.classList.add('hidden'); }
}

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
