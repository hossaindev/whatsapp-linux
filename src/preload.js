'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls — independent, pass straight through
  minimize:         ()    => ipcRenderer.send('win-minimize'),
  maximize:         ()    => ipcRenderer.send('win-maximize'),
  close:            ()    => ipcRenderer.send('win-close'),
  isMaximized:      ()    => ipcRenderer.invoke('win-is-maximized'),
  onWinState:       (cb)  => ipcRenderer.on('win-state', (_, v) => cb(v)),

  // Relay from webview → main
  sendNotification: (d)   => ipcRenderer.send('wa-notification', d),
  sendUnreadCount:  (n)   => ipcRenderer.send('unread-count', n),

  // Open external URL in system browser
  openExternal:     (url) => ipcRenderer.send('open-external', url),

  clearCache: () => ipcRenderer.invoke('clear-cache'),
  sendCallState: state => ipcRenderer.send('call-state', state),
  sendCallResult: result => ipcRenderer.send('call-result', result),
  onCallAction: cb => ipcRenderer.on('call-action', (_, action) => cb(action)),
  // Settings
  getSettings:      ()    => ipcRenderer.invoke('get-settings'),
  saveSettings:     (s)   => ipcRenderer.invoke('save-settings', s),

  // Tray → open settings panel in shell
  onOpenSettings:   (cb)  => ipcRenderer.on('open-settings', () => cb()),
});
