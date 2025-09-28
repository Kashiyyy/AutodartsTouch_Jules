const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  on: (channel, callback) => {
    const validChannels = ['update-keyboard-style'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
  },
  openSettings: () => ipcRenderer.send('open-settings'),
  switchTab: (t) => ipcRenderer.send('switch-tab', t),
  refresh: () => ipcRenderer.send('refresh'),
  toggleWebKeyboard: () => ipcRenderer.send('toggle-webkeyboard'),
  sendKey: (key) => ipcRenderer.send('webkeyboard-key', key),
  setShiftStatus: (isActive) => ipcRenderer.send('keyboard-shift-status', isActive),
  reportKeyboardHeight: (height) => ipcRenderer.send('keyboard-height-changed', height),
  testAutoFocus: () => {
    console.log('?? Manual test trigger');
    ipcRenderer.send('input-focused');
  }
});

// API for webview content to communicate focus events
contextBridge.exposeInMainWorld('electronAPI', {
  inputFocused: () => {
    console.log('electronAPI.inputFocused called');
    ipcRenderer.send('input-focused');
  },
  inputBlurred: () => {
    console.log('electronAPI.inputBlurred called'); 
    ipcRenderer.send('input-blurred');
  },
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.send('save-settings', settings),
  closeSettings: () => ipcRenderer.send('close-settings')
});