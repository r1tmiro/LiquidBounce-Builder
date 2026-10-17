// Smoke test: launch the headless Chromium (bundled via @sparticuz/chromium) and take a screenshot.
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

(async () => {
  const exe = await chromium.executablePath();
  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox', '--single-process',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 400 });
  await page.setContent('<body style="margin:0;background:#0b0f14"><canvas id="c" width="640" height="400"></canvas></body>');
  const gl = await page.evaluate(() => {
    const c = document.getElementById('c');
    const g = c.getContext('webgl2');
    if (!g) return 'NO WEBGL2';
    g.clearColor(0.1, 0.7, 0.4, 1); g.clear(g.COLOR_BUFFER_BIT);
    const px = new Uint8Array(4); g.readPixels(1, 1, 1, 1, g.RGBA, g.UNSIGNED_BYTE, px);
    return 'WEBGL2 OK renderer=' + g.getParameter(g.RENDERER) + ' px=' + px.join(',');
  });
  console.log('GL:', gl);
  await page.screenshot({ path: '/tmp/smoke.png' });
  await browser.close();
  console.log('SMOKE OK');
})().catch(e => { console.error('SMOKE FAIL:', e.message); process.exit(1); });
