import {run} from './03_render.test.js';
import {summary} from './harness.js';
try { await run(); if(!summary())process.exitCode=1; }
catch(e) { console.error(e); process.exit(1); }
