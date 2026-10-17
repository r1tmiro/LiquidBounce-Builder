/**
 * Builds the renderer bundle and copies the static assets into dist/renderer.
 *   node tools/build-renderer.js
 */
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist', 'renderer');

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function copyDir(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

async function build() {
  const watch = process.argv.includes('--watch');
  ensureDir(OUT);

  const options = {
    entryPoints: [path.join(ROOT, 'src', 'renderer', 'js', 'main.js')],
    bundle: true,
    format: 'iife',
    target: ['chrome110'],
    outfile: path.join(OUT, 'game.js'),
    sourcemap: false,
    minify: !watch,
    legalComments: 'none',
    logLevel: 'info',
    define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
  };

  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log('watching renderer…');
  } else {
    await esbuild.build(options);
  }

  // static files
  fs.copyFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), path.join(OUT, 'index.html'));
  fs.copyFileSync(path.join(ROOT, 'src', 'renderer', 'styles.css'), path.join(OUT, 'styles.css'));

  // 3D assets
  const modelSrc = path.join(ROOT, 'assets', 'models');
  if (fs.existsSync(modelSrc)) {
    copyDir(modelSrc, path.join(OUT, 'assets', 'models'));
  }

  console.log('renderer built →', OUT);
}

build().catch(err => { console.error(err); process.exit(1); });
