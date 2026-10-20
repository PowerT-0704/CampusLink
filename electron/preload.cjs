'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const invoke = method => (...args) => ipcRenderer.invoke(`campus:${method}`, ...args);
contextBridge.exposeInMainWorld('campus', Object.freeze({
  getSnapshot: invoke('getSnapshot'),
  getUpdateState: invoke('getUpdateState'),
  checkForUpdates: invoke('checkForUpdates'),
  openRelease: invoke('openRelease'),
  copyText: invoke('copyText'),
  saveSettings: invoke('saveSettings'),
  setAppearance: invoke('setAppearance'),
  saveCredentials: invoke('saveCredentials'),
  completeOnboarding: invoke('completeOnboarding'),
  retryCredentials: invoke('retryCredentials'),
  connect: invoke('connect'),
  disconnect: invoke('disconnect'),
  checkStatus: invoke('checkStatus'),
  importProfile: invoke('importProfile'),
  removeProfile: invoke('removeProfile'),
  exportExample: invoke('exportExample'),
  exportDiagnostics: invoke('exportDiagnostics'),
  exportProfile: invoke('exportProfile'),
  openPortal: invoke('openPortal'),
  openUrl: invoke('openUrl'),
  clearCredentials: invoke('clearCredentials'),
  windowAction: invoke('windowAction'),
  onSnapshot(callback) {
    if (typeof callback !== 'function') throw new TypeError('callback 必须为函数');
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('campus:snapshot', listener);
    return () => ipcRenderer.removeListener('campus:snapshot', listener);
  },
  onUpdate(callback) {
    if (typeof callback !== 'function') throw new TypeError('callback 必须为函数');
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('campus:update', listener);
    return () => ipcRenderer.removeListener('campus:update', listener);
  },
}));
