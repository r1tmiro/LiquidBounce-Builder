/** Quick manual page check: prints console output and errors from the game. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../tools/browser.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] || ('file://' + path.join(ROOT, 'dist', 'renderer', 'index.html'));

const browser = await chromium();
const page = await browser.newPage();
page.on('console', m => console.log(`[${m.type()}]`, m.text()));
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('requestfailed', r => console.log('[reqfail]', r.url().slice(-60), r.failure()?.errorText));
page.on('response', r => { if (r.status() >= 400) console.log('[http]', r.status(), r.url()); });

await page.goto(url, { waitUntil: 'load', timeout: 60000 });
await new Promise(r => setTimeout(r, 6000));

const info = await page.evaluate(() => ({
  hasGame: !!window.__game,
  models: window.__game ? Object.keys(window.__game.assets).length : 0,
  loadText: document.getElementById('load-text')?.textContent,
  canvasSize: [document.getElementById('scene').width, document.getElementById('scene').height],
}));
console.log('INFO', JSON.stringify(info));
await page.screenshot({ path: path.join(ROOT, 'artifacts', 'debug.png') });
await browser.close();
