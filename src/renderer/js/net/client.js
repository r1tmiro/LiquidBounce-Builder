/**
 * Network transports.
 *
 *  WsTransport  - direct WebSocket to an authoritative server (LAN / internet)
 *  PeerTransport- WebRTC data channel via the PeerJS cloud (no server needed)
 */
import { MSG, PROTOCOL_VERSION, peerIdForRoom, encode, decode } from '../../../shared/net/protocol.js';

export class Transport {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.connected = false;
    this.kind = 'none';
  }
  emit(ev, ...args) { this.handlers[ev]?.(...args); }
  send() {}
  close() {}
}

/* ─────────────────────────── WebSocket ─────────────────────────── */
export class WsTransport extends Transport {
  constructor(handlers) {
    super(handlers);
    this.kind = 'ws';
    this.ws = null;
    this.queue = [];
  }

  connect(url, { room, name, color, create = false }) {
    return new Promise((resolve, reject) => {
      let settled = false;
      try {
        this.ws = new WebSocket(url);
      } catch (err) {
        reject(new Error('Invalid address: ' + err.message));
        return;
      }
      const timer = setTimeout(() => {
        if (!settled) { settled = true; try { this.ws.close(); } catch {} reject(new Error('Connection timed out')); }
      }, 8000);

      this.ws.onopen = () => {
        this.ws.send(encode({ t: MSG.HELLO, name, color, room, create, protocol: PROTOCOL_VERSION }));
        for (const m of this.queue) this.ws.send(m);
        this.queue.length = 0;

        this.emit('status', 'connected');
      };
      this.ws.onerror = () => {
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Could not reach the server')); }
      };
      this.ws.onclose = () => {
        this.connected = false;
        this.emit('close');
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Connection closed')); }
      };
      this.ws.onmessage = (ev) => {
        const msg = decode(ev.data);
        if (!msg) return;
        if (msg.t === MSG.WELCOME) { this.connected = true; if (!settled) { settled = true; clearTimeout(timer); resolve(this); } this.emit('welcome', msg); return; }
        if (msg.t === MSG.SNAPSHOT) { this.emit('snapshot', msg.snapshot); return; }
        if (msg.t === MSG.EVENT) { this.emit('event', msg.event); return; }
        if (msg.t === MSG.ROSTER) { this.emit('roster', msg); return; }
        if (msg.t === MSG.ERROR) { if (!settled) { settled = true; clearTimeout(timer); reject(new Error(msg.message)); this.ws.close(); } this.emit('error', msg.message); return; }
      };
    });
  }

  send(msg) {
    const raw = encode(msg);
    if (this.connected && this.ws.readyState === 1) this.ws.send(raw);
    else this.queue.push(raw);
  }

  close() {
    this.connected = false;
    try { this.ws?.close(); } catch { /* ignore */ }
  }
}

