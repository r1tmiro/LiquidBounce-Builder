import WebSocket from 'ws';
import { startServer } from '../src/server/server.js';
import { group, ok, eq } from './harness.js';

function client(url) {
  const ws = new WebSocket(url);
  const messages = [];
  ws.on('message', data => messages.push(JSON.parse(data)));
  const send = m => ws.send(JSON.stringify(m));
  const wait = (pred, timeout = 7000) => new Promise((resolve, reject) => {
    const end = Date.now() + timeout;
    const timer = setInterval(() => {
      const found = messages.find(pred);
      if (found) { clearInterval(timer); resolve(found); }
      else if (Date.now() > end) { clearInterval(timer); reject(new Error('Network message timed out')); }
    }, 15);
  });
  const open = new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return { ws, messages, send, wait, open };
}

export async function run() {
  group('Two-player online session');
  const server = await startServer({ port: 0, host: '127.0.0.1', log: false });
  const a = client(`ws://127.0.0.1:${server.port}/ws`);
  const b = client(`ws://127.0.0.1:${server.port}/ws`);
  try {
    await Promise.all([a.open, b.open]);
    a.send({ t:'hello', room:'TEST42', name:'Host', create:true });
    const wa = await a.wait(m => m.t === 'welcome');
    b.send({ t:'hello', room:'TEST42', name:'Guest' });
    const wb = await b.wait(m => m.t === 'welcome');
    eq(wa.room, wb.room, 'two sockets join the same room');
    ok(wa.playerId !== wb.playerId, 'players receive distinct identities');
    const roster = await a.wait(m => m.t === 'roster' && m.players.length === 2);
    eq(roster.players.length, 2, 'host sees guest join');
    a.send({ t:'cmd', cmd:{type:'ready', value:true} });
    b.send({ t:'cmd', cmd:{type:'ready', value:true} });
    const sa = await a.wait(m => m.t === 'snap' && m.snapshot.phase === 'playing');
    const sb = await b.wait(m => m.t === 'snap' && m.snapshot.phase === 'playing');
    eq(sa.snapshot.players.length, 10, 'server fills the round with bots');
    eq(sb.snapshot.players.length, 10, 'guest receives the full round');
    ok(!sa.snapshot.players.find(p=>p.id===wa.playerId).isBot, 'bot fill preserves the host identity');
    eq(sa.snapshot.players.find(p=>p.id===wb.playerId).name,'Guest','bot fill preserves the guest identity');
    ok(!!sa.snapshot.players.find(p => p.id === wa.playerId).role, 'host receives its own private role');
    ok(!sa.snapshot.players.find(p => p.id === wb.playerId).role, 'other players’ roles remain private');
    ok(!!sb.snapshot.players.find(p => p.id === wb.playerId).tasks?.length, 'guest receives private task assignments');
    a.send({t:'input', input:{mx:1,mz:0,run:false}});
    const later = await a.wait(m => m.t === 'snap' && m.snapshot.time > 1.0);
    const old = sa.snapshot.players.find(p => p.id === wa.playerId);
    const moved = later.snapshot.players.find(p => p.id === wa.playerId);
    ok(Math.abs(moved.x-old.x)>0.5, 'authoritative server applies movement input');
    a.send({t:'input', input:{mx:0,mz:0}});
    // Duplicate hello may not allocate additional players.
    a.send({t:'hello', room:'TEST42', name:'Duplicate', create:true});
    const stable = await b.wait(m => m.t === 'snap' && m.snapshot.time > 1.3);
    eq(stable.snapshot.players.length, 10, 'duplicate hello cannot allocate extra players');
    const missing = client(`ws://127.0.0.1:${server.port}/ws`);
    await missing.open;
    missing.send({t:'hello',room:'NOEXIST'});
    const err = await missing.wait(m=>m.t==='err');
    ok(/not found/i.test(err.message), 'unknown room is rejected instead of silently creating one');
    missing.ws.close();
  } finally {
    a.ws.terminate(); b.ws.terminate(); server.close();
  }
}
