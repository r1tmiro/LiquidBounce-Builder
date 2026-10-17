/**
 * Chromium helper for the headless tests.
 * Uses the locally installed @sparticuz/chromium build and the shared
 * shared-library folder extracted from it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export async function chromiumPath() {
  const sparticuz = require('@sparticuz/chromium');
  const exe = await sparticuz.executablePath();
  return exe;
}

export function chromiumEnv() {
  const env = { ...process.env };
  const libDir = '/tmp/al2023/lib';
  const stubDir = '/home/user/xstubs';
  const parts = [libDir, stubDir, env.LD_LIBRARY_PATH].filter(Boolean);
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
