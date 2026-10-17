/**
 * Chromium helper for the headless tests.
 * Uses the locally installed @sparticuz/chromium build and the shared
 * shared-library folder extracted from it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { brotliDecompressSync } from 'node:zlib';
import os from 'node:os';

const require = createRequire(import.meta.url);

export async function chromiumPath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.platform !== 'linux') throw new Error('Set CHROME_PATH to your Chrome/Chromium executable for browser tests.');
  const sparticuz = require('@sparticuz/chromium');
  const libRoot = path.join(os.tmpdir(),'nightshift-browser-libs');
  if (!fs.existsSync(path.join(libRoot,'lib','libnss3.so'))) {
    fs.mkdirSync(libRoot,{recursive:true});
    const archive = path.join(libRoot,'libraries.tar');
    const bin = path.join(path.dirname(require.resolve('@sparticuz/chromium')), '..', 'bin', 'al2023.tar.br');
    fs.writeFileSync(archive,brotliDecompressSync(fs.readFileSync(bin)));
    execFileSync('tar',['-xf',archive,'-C',libRoot]);
  }
  const exe = await sparticuz.executablePath();
  return exe;
}

export function chromiumEnv() {
  const env = { ...process.env };
  const libDir = path.join(os.tmpdir(),'nightshift-browser-libs','lib');
  const parts = [libDir, env.LD_LIBRARY_PATH].filter(Boolean);
  env.LD_LIBRARY_PATH = parts.join(':');
  return env;
}

export async function chromium() {
  const puppeteer = (await import('puppeteer-core')).default;
  const exe = await chromiumPath();
  return puppeteer.launch({
    executablePath: exe,
    headless: true,
    env: chromiumEnv(),
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox', '--single-process', '--allow-file-access-from-files',
      '--autoplay-policy=no-user-gesture-required', '--mute-audio',
    ],
  });
}
