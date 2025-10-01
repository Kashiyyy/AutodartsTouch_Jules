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

// Show cursor on mouse move, hide on touch
window.addEventListener('DOMContentLoaded', () => {
  // --- Touch Scrolling ---
  let isDragging = false;
  let startY = 0;
  let scrollStartTop = 0;

  // Combined touchstart listener for both scrolling and cursor visibility
  document.addEventListener('touchstart', (e) => {
    // Hide cursor on any touch
    setCursorVisibility(false);

    // Scrolling logic
    if (e.touches.length === 1) {
      const target = e.target;
      // Don't interfere with interactive elements
      if (target.tagName === 'INPUT' || target.tagName === 'BUTTON' || target.tagName === 'SELECT' || target.closest('button, a')) {
        isDragging = false; // Ensure dragging is off if we're on a button
        return;
      }
      isDragging = true;
      startY = e.touches[0].clientY;
      scrollStartTop = window.scrollY;
    }
  }, { capture: true, passive: true });

  document.addEventListener('touchmove', (e) => {
    if (isDragging && e.touches.length === 1) {
      const y = e.touches[0].clientY;
      const walk = (y - startY);
      // Only preventDefault when actually scrolling to allow for vertical drags
      if (Math.abs(walk) > 5) { // Threshold to prevent accidental scrolls
        e.preventDefault();
        window.scrollTo(0, scrollStartTop - walk);
      }
    }
  }, { capture: true, passive: false }); // passive: false is required for preventDefault

  document.addEventListener('touchend', () => {
    isDragging = false;
  }, { capture: true, passive: true });

  document.addEventListener('mousemove', () => {
    setCursorVisibility(true);
  }, { capture: true, passive: true });
});