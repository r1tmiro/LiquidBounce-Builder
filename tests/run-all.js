/** Test runner: node tests/run-all.js */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { summary } from './harness.js';

const files = [
  './01_map.test.js',
  './02_net.test.js',
  './03_render.test.js',
  './04_tasks.test.js',
];

for (const f of files) {
  const abs = path.join(process.cwd(), 'tests', f);
  if (!existsSync(abs)) { console.log(`(skipping ${f} - not present)`); continue; }
  const url = pathToFileURL(abs).href;
  try {
    const mod = await import(url);
    if (typeof mod.run === 'function') await mod.run();
    else console.log(`(no run() in ${f})`);
  } catch (err) {
    console.error(`\x1b[31mCould not load ${f}:\x1b[0m`, err.message);
    if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    process.exitCode = 1;
  }
}

const passed = summary();
if (!passed) process.exitCode = 1;
