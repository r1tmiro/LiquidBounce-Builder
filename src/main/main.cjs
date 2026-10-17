/**
 * Electron main process.
 *
 * Starts the bundled game server (so the player can host/join on the local
 * network) and opens the game window.
 */
const { app, BrowserWindow, Menu, shell, ipcMain, protocol, net } = require('electron');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const isDev = !app.isPackaged;
const smoke = process.argv.includes('--smoke-test');
let mainWindow = null;
let serverHandle = null;

// A custom standard scheme so the renderer can use fetch() for the 3D assets
// (the file:// protocol blocks fetch, which would break GLB loading).
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const RENDERER_ROOT = path.join(__dirname, '..', '..', 'dist', 'renderer');

function lanAddress() {
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

async function startServer(port) {
  try {
    const mod = await import(pathToFileURL(path.join(__dirname, '..', 'server', 'server.js')).href);
    return await mod.startServer({ port, host: '0.0.0.0', log: false });
  } catch (err) {
    console.warn('could not start the local server:', err.message);
    if (err.code === 'EADDRINUSE') { const mod = await import(pathToFileURL(path.join(__dirname, '..', 'server', 'server.js')).href); return mod.startServer({port:0, host:'0.0.0.0', log:false}); }
    return null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#05070b',
    title: 'AMONG US: NIGHT SHIFT',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  mainWindow.once('ready-to-show', () => { if (!smoke) mainWindow.show(); });
  mainWindow.loadURL('app://game/index.html');

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);

  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const filePath = path.join(RENDERER_ROOT, decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html');
    if (!filePath.startsWith(RENDERER_ROOT + path.sep)) {
      return new Response('forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });

  const port = Number(process.env.AU_PORT || 7777);
  serverHandle = await startServer(port);

  const info = {
    platform: process.platform,
    version: app.getVersion(),
    serverPort: serverHandle?.port || null,
    serverUrl: serverHandle ? `ws://127.0.0.1:${serverHandle.port}/ws` : null,
    lanUrl: serverHandle ? `ws://${lanAddress()}:${serverHandle.port}/ws` : null,
    lanAddress: lanAddress(),
    packaged: app.isPackaged,
  };
  console.log('[main] runtime info', info);

  createWindow();

  ipcMain.handle('game:info', () => info);
  if (smoke) {
    const fs = require('node:fs');
    const output = process.env.SMOKE_OUTPUT || path.join(process.cwd(), 'artifacts');
    fs.mkdirSync(output, {recursive:true});
    const errors = [];
    mainWindow.webContents.on('console-message', (_event, level, message) => {
      if (level === 3) errors.push(message);
    });
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        const result = await mainWindow.webContents.executeJavaScript(`(async () => {
          const deadline = Date.now() + 60000;
          while (!window.__game?.ready) { if (Date.now() > deadline) throw new Error('Boot timeout'); await new Promise(r=>setTimeout(r,100)); }
          const g = window.__game;
          g.startSolo();
          await new Promise(r=>setTimeout(r,2500));
          const me = g.snapshot.players.find(p=>p.id===g.myPlayerId);
          return {models:Object.keys(g.assets).length, players:g.snapshot.players.length, phase:g.snapshot.phase, tasks:me.tasks.length, triangles:g.view.renderer.info.render.triangles, electron:window.gameAPI.isElectron, serverPort:(await window.gameAPI.info()).serverPort};
        })()`);
        fs.writeFileSync(path.join(output, 'electron-smoke.json'), JSON.stringify({result,errors},null,2));
        const image = await mainWindow.webContents.capturePage();
        fs.writeFileSync(path.join(output,'electron-smoke.png'), image.toPNG());
        if (!result.serverPort || result.models !== 16 || result.players !== 10 || !result.electron || errors.some(e=>/Shader Error|Uncaught|failed to load model/i.test(e))) throw new Error('Electron smoke failed');
        console.log('ELECTRON SMOKE PASSED', result);
        app.exit(0);
      } catch (err) { console.error(err); fs.writeFileSync(path.join(output,'electron-smoke-error.txt'),String(err)); app.exit(1); }
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  try { serverHandle?.close?.(); } catch { /* ignore */ }
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (err) => {
  console.error('[main] uncaught', err);
});
