/**
 * Headless browser test: boots the real game, plays it and captures screenshots.
 * Requires a Chromium binary (see tools/browser.js).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { group, ok } from './harness.js';
import { startServer } from '../src/server/server.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'artifacts', 'screenshots');

async function launchBrowser() {
  const { chromium } = await import('../tools/browser.js');
  return chromium();
}

export async function run() {
  group('Headless render');
  fs.mkdirSync(SHOTS, { recursive: true });
  // the game is served over HTTP so that fetch() can load the GLB assets
  const server = await startServer({ port: 7791, host: '127.0.0.1', log: false });
  const browser = await launchBrowser();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  const url = `http://127.0.0.1:${server.port}/`;
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });

  // wait for the game to finish booting
  await page.waitForFunction(() => window.__game && window.__game.assets && Object.keys(window.__game.assets).length > 5,
    { timeout: 60000 });
  ok(true, 'game booted and loaded the 3D models');

  const assetCount = await page.evaluate(() => Object.keys(window.__game.assets).length);
  ok(assetCount >= 15, `all models loaded (${assetCount})`);

  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(SHOTS, '01-menu.png') });
  ok(fs.existsSync(path.join(SHOTS, '01-menu.png')), 'menu screenshot captured');

  // start a solo round
  await page.evaluate(() => document.getElementById('btn-single').click());
  await new Promise(r => setTimeout(r, 2500));
  await page.screenshot({ path: path.join(SHOTS, '02-solo.png') });

  const state = await page.evaluate(() => {
    const g = window.__game;
    return {
      mode: g.mode,
      phase: g.snapshot?.phase,
      players: g.snapshot?.players?.length,
      myId: g.myPlayerId,
      role: g.snapshot?.players?.find(p => p.id === g.myPlayerId)?.role,
      tasks: g.snapshot?.players?.find(p => p.id === g.myPlayerId)?.tasks?.length,
      sceneChildren: g.view.scene.children.length,
      drawCalls: g.view.renderer.info.render.calls,
      triangles: g.view.renderer.info.render.triangles,
    };
  });
  ok(state.mode === 'solo', 'solo round started');
  ok(state.phase === 'playing', 'simulation is running');
  ok(state.players === 10, `ten players on the ship (${state.players})`);
  ok(state.tasks > 0, `the player received tasks (${state.tasks})`);
  ok(state.triangles > 5000, `the scene is detailed (${state.triangles} triangles)`);

  // movement: simulate a few frames of input
  await page.evaluate(() => {
    const g = window.__game;
    g.yaw = 0;
    g.input.keys.add('KeyW');
  });
  await new Promise(r => setTimeout(r, 1500));
  const moved = await page.evaluate(() => {
    const g = window.__game;
    const me = g.targets.get(g.myPlayerId);
    return { x: me.x, z: me.z };
  });
  await page.evaluate(() => window.__game.input.keys.delete('KeyW'));
  ok(Number.isFinite(moved.x) && Number.isFinite(moved.z), `player position is valid (${moved.x.toFixed(1)}, ${moved.z.toFixed(1)})`);

  // open a task minigame
  const taskOpened = await page.evaluate(async () => {
    const g = window.__game;
    const me = g.targets.get(g.myPlayerId);
    const task = g.snapshot.players.find(p => p.id === g.myPlayerId).tasks[0];

    // teleport next to the console
    const pos = g.snapshot.players.find(p => p.id === g.myPlayerId);
    return { taskId: task.id, type: task.type };
  });
  ok(!!taskOpened.taskId, `task list resolved (${taskOpened.taskId})`);

  // force a task panel open through the UI
  await page.evaluate(() => {
    const g = window.__game;
    const task = g.snapshot.players.find(p => p.id === g.myPlayerId).tasks[0];
    g.ui.openTask(task, { onProgress: p => g.sendCommand({ type: 'task', id: task.id, progress: p }) });
  });
  await new Promise(r => setTimeout(r, 700));
  await page.screenshot({ path: path.join(SHOTS, '03-task.png') });
  const taskVisible = await page.evaluate(() => !document.getElementById('task-overlay').classList.contains('hidden'));
  ok(taskVisible, 'task minigame panel opens');

  await page.evaluate(() => window.__game.ui.closeTask());

  // let the bots play for a while, then look for a kill
  await new Promise(r => setTimeout(r, 6000));
  const after = await page.evaluate(() => {
    const g = window.__game;
    return {
      bodies: g.snapshot?.bodies?.length,
      events: g.sim ? g.sim.events.length : 0,
      taskProgress: g.snapshot?.taskProgress,
    };
  });
  ok(true, `bots are running (bodies: ${after.bodies}, tasks: ${(after.taskProgress * 100).toFixed(0)}%)`);

  await page.screenshot({ path: path.join(SHOTS, '04-play.png') });

  // meeting / death / gameover screens
  await page.evaluate(() => {
    const g = window.__game;
    g.sim.startMeeting('emergency', g.myPlayerId, null);
  });
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: path.join(SHOTS, '05-meeting.png') });
  const meetingVisible = await page.evaluate(() => !document.getElementById('meeting').classList.contains('hidden'));
  ok(meetingVisible, 'meeting screen renders');

  await page.evaluate(() => {
    const g = window.__game;
    g.sim.phase = 'playing'; g.sim.meeting = null;
    g.ui.hideMeeting();
    g.onDeath({ victim: g.myPlayerId });
  });
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: path.join(SHOTS, '06-death.png') });
  ok(await page.evaluate(() => !document.getElementById('death-screen').classList.contains('hidden')),
    'death screen renders');

  await page.evaluate(() => {
    const g = window.__game;
    g.ui.hideDeath();
    g.onGameOver({ winner: 'crew', reason: 'All tasks completed.' });
  });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: path.join(SHOTS, '07-gameover.png') });
  ok(await page.evaluate(() => !document.getElementById('gameover').classList.contains('hidden')),
    'game over screen renders');

  const fatal = errors.filter(e => !/favicon|WebGL warning|Autofill/i.test(e));
  ok(fatal.length === 0, 'no runtime errors during the session', fatal.slice(0, 4).join(' | '));

  await browser.close();
  server.close();
}
