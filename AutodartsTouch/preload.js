const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  on: (channel, callback) => {
    const validChannels = ['update-keyboard-style', 'active-view-changed'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
  },
  openSettings: () => ipcRenderer.send('open-settings'),
  switchTab: (t) => ipcRenderer.send('switch-tab', t),
  refresh: () => ipcRenderer.send('refresh'),
  forceReload: () => ipcRenderer.send('force-reload'),
  toggleWebKeyboard: () => ipcRenderer.send('toggle-webkeyboard'),
  setCursorVisibility: (visible) => ipcRenderer.send('set-cursor-visibility', visible),
  openPowerMenu: () => ipcRenderer.send('open-power-menu'),
  closePowerMenu: () => ipcRenderer.send('close-power-menu'),
  powerControl: (action) => ipcRenderer.send('power-control', action),
  getTabs: () => ipcRenderer.invoke('get-tabs'),
  getCurrentView: () => ipcRenderer.invoke('get-current-view'),
  sendKey: (key) => ipcRenderer.send('webkeyboard-key', key),
  setShiftStatus: (isActive) => ipcRenderer.send('keyboard-shift-status', isActive),
  reportKeyboardHeight: (height) => ipcRenderer.send('keyboard-height-changed', height),
  testAutoFocus: () => {
    console.log('?? Manual test trigger');
    ipcRenderer.send('input-focused');
  }
});

// API for settings and other webviews
contextBridge.exposeInMainWorld('electronAPI', {
  inputFocused: (viewName) => ipcRenderer.send('input-focused', viewName),
  inputBlurred: (viewName) => ipcRenderer.send('input-blurred', viewName),
  getKeyboardLayouts: () => ipcRenderer.invoke('get-keyboard-layouts'),
  getKeyboardLayoutData: (layoutName) => ipcRenderer.invoke('get-keyboard-layout-data', layoutName),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.send('save-settings', settings),
  closeSettings: () => ipcRenderer.send('close-settings'),
  updateKeyboardStyleLive: (style) => ipcRenderer.send('update-keyboard-style-live', style)
});