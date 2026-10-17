/** Renderer entry point. */
import { Game } from './game.js';

async function boot() {
  const game = new Game();
  window.__game = game;   // handy for debugging / automated tests
  try {
    await game.boot();
  } catch (err) {
    console.error('boot failed', err);
    const el = document.getElementById('load-text');
    if (el) el.textContent = 'Boot failed: ' + err.message;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
