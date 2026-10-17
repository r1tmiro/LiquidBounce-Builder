/**
 * Wire protocol shared by the game client and the authoritative server.
 * All messages are plain JSON objects with a `t` (type) field.
 */
export const MSG = {
  HELLO: 'hello',
  WELCOME: 'welcome',
  SNAPSHOT: 'snap',
  EVENT: 'ev',
  INPUT: 'input',
  COMMAND: 'cmd',
  ROSTER: 'roster',
  ERROR: 'err',
  LEAVE: 'leave',
  PING: 'ping',
  PONG: 'pong',
};

export const PROTOCOL_VERSION = 1;

export function makeRoomCode(rng = Math.random) {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += letters[Math.floor(rng() * letters.length)];
  return code;
}

/** PeerJS id used for the cloud (WebRTC) transport. */
export function peerIdForRoom(room) {
  return `amongus-nightshift-${room.toLowerCase()}`;
}

export function encode(msg) { return JSON.stringify(msg); }
export function decode(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}
