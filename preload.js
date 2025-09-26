const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Core API
  switchTab: (t) => ipcRenderer.send('switch-tab', t),
  refresh: () => ipcRenderer.send('refresh'),

  // Keyboard API
  toggleWebKeyboard: () => ipcRenderer.send('toggle-webkeyboard'),
  sendKey: (key) => ipcRenderer.send('webkeyboard-key', key),
  setShiftStatus: (isActive) => ipcRenderer.send('keyboard-shift-status', isActive),
  reportKeyboardHeight: (height) => ipcRenderer.send('keyboard-height-changed', height),

  // Settings API
  toggleSettings: () => ipcRenderer.send('settings-toggle'),
  getInitialSettings: () => ipcRenderer.invoke('settings-get-initial'),
  setVolume: (level) => ipcRenderer.send('settings-set-volume', level),
  setKeyboardLanguage: (lang) => ipcRenderer.send('settings-set-keyboard-language', lang),

  // Listeners
  onKeyboardLanguageChanged: (callback) => ipcRenderer.on('keyboard-language-changed', (_event, lang) => callback(lang)),

  // Auto-focus API for webview content
  inputFocused: () => ipcRenderer.send('input-focused'),
  inputBlurred: () => ipcRenderer.send('input-blurred')
});

// For webview content to communicate focus events
contextBridge.exposeInMainWorld('electronAPI', {
  inputFocused: () => ipcRenderer.send('input-focused'),
  inputBlurred: () => ipcRenderer.send('input-blurred')
});