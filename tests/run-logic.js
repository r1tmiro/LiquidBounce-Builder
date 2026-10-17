import {run as map} from './01_map.test.js';
import {run as network} from './02_net.test.js';
import {run as tasks} from './04_tasks.test.js';
import {summary} from './harness.js';
try { await map(); await network(); await tasks(); if(!summary())process.exitCode=1; }
catch(e) { console.error(e); process.exitCode=1; }
