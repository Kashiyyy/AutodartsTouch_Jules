const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
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
  }
});