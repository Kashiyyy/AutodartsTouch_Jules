const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  on: (channel, callback) => {
    const validChannels = ['update-keyboard-style', 'active-view-changed', 'update-toolbar-style', 'update-available'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
  },
  send: (channel, data) => {
    const validSendChannels = ['toolbar-ready'];
    if (validSendChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
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
  updateKeyboardStyleLive: (style) => ipcRenderer.send('update-keyboard-style-live', style),
  updateToolbarStyleLive: (style) => ipcRenderer.send('update-toolbar-style-live', style),

  // Extension Management API
  getExtensionVersions: () => ipcRenderer.invoke('getExtensionVersions'),
  downloadExtension: () => ipcRenderer.invoke('downloadExtension'),
  openLogFile: () => ipcRenderer.send('open-log-file'),
});

// --- Global Cursor Visibility ---
// This logic is placed in the preload script to ensure it runs in the context
// of every BrowserView, making the cursor behavior consistent across the app.

let cursorVisible = true; // Assume cursor is visible by default

function setCursorVisibility(visible) {
  if (visible !== cursorVisible) {
    // We can't use the exposed `api.setCursorVisibility` here because this script
    // defines that API. We must use ipcRenderer directly.
    ipcRenderer.send('set-cursor-visibility', visible);
    cursorVisible = visible;
  }
}

// Show cursor on mouse move or click, hide on touch
window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') {
      setCursorVisibility(true);
    } else {
      setCursorVisibility(false);
    }
  }, { capture: true });

  document.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') {
      setCursorVisibility(true);
    }
  }, { capture: true, passive: true });
});