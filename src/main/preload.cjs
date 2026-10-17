/** Preload bridge - exposes a tiny, safe API to the renderer. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gameAPI', {
  info: () => ipcRenderer.invoke('game:info'),
  platform: process.platform,
  isElectron: true,
});
