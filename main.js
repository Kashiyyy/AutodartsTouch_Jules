const { app, BrowserWindow, BrowserView, ipcMain, screen } = require('electron');
const path = require('path');
const { exec } = require('child_process');

// --- Global State ---
let mainWindow;
let views = {};
let toolbarView;
let keyboardView;
let settingsView;
let currentView = 'tab1';

let keyboardVisible = false;
let settingsVisible = false;
let keyboardActualHeight = 300; // Dynamic keyboard height
let currentVolume = 75;
let currentKeyboardLanguage = 'de';

// --- Constants ---
const TOOLBAR_HEIGHT = 72;
const KEYBOARD_HEIGHT = 300;
const SETTINGS_WIDTH = 450;
const SETTINGS_HEIGHT = 300;

// --- Main Window Creation ---
function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width, height,
    kiosk: true,
    frame: false,
    backgroundColor: '#000000',
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // --- View Creation ---
  // Content BrowserViews
  views.tab1 = new BrowserView({ webPreferences: { sandbox: false, preload: path.join(__dirname, 'preload.js') } });
  views.tab2 = new BrowserView({ webPreferences: { sandbox: false, preload: path.join(__dirname, 'preload.js') } });

  views.tab1.webContents.loadURL('https://play.autodarts.io/').catch(e => console.error('tab1 load error:', e));
  views.tab2.webContents.loadURL('http://localhost:3180/').catch(e => console.error('tab2 load error:', e));

  // Toolbar View
  toolbarView = new BrowserView({
    webPreferences: { contextIsolation: true, sandbox: false, preload: path.join(__dirname, 'preload.js') }
  });
  toolbarView.webContents.loadFile(path.join(__dirname, 'index.html')).catch(e => console.error('toolbar load error:', e));

  // Keyboard View
  keyboardView = new BrowserView({
    webPreferences: { contextIsolation: true, sandbox: false, preload: path.join(__dirname, 'preload.js') }
  });
  keyboardView.webContents.loadFile(path.join(__dirname, 'keyboard', 'index.html')).catch(e => console.error('keyboard load error:', e));

  // Settings View
  settingsView = new BrowserView({
    webPreferences: { contextIsolation: true, sandbox: false, preload: path.join(__dirname, 'preload.js') }
  });
  settingsView.webContents.loadFile(path.join(__dirname, 'settings.html')).catch(e => console.error('settings load error:', e));


  // --- Initial Layout ---
  mainWindow.addBrowserView(views.tab1);
  mainWindow.addBrowserView(views.tab2);
  mainWindow.addBrowserView(toolbarView);

  updateLayout();

  // Get initial system volume
  getInitialVolume();

  // Setup auto-keyboard focus detection
  setupAutoFocus(views.tab1);
  setupAutoFocus(views.tab2);

  mainWindow.on('resize', updateLayout);
}

// --- Layout Management ---
function updateLayout() {
  if (!mainWindow) return;
  const [w, h] = mainWindow.getSize();

  // Toolbar is always at the top
  toolbarView.setBounds({ x: 0, y: 0, width: w, height: TOOLBAR_HEIGHT });
  toolbarView.setAutoResize({ width: true });

  const contentHeight = h - TOOLBAR_HEIGHT - (keyboardVisible ? keyboardActualHeight : 0);

  // Set bounds for content views
  Object.keys(views).forEach(k => {
    const v = views[k];
    if (k === currentView) {
      v.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width: w, height: contentHeight });
      v.setAutoResize({ width: true, height: true });
    } else {
      v.setBounds({ x: 0, y: h, width: w, height: contentHeight }); // Off-screen
    }
  });

  // Position keyboard if visible
  if (keyboardVisible) {
    keyboardView.setBounds({ x: 0, y: h - keyboardActualHeight, width: w, height: keyboardActualHeight });
    keyboardView.setAutoResize({ width: true });
  }

  // Position settings panel if visible
  if (settingsVisible) {
    const settingsX = Math.round((w - SETTINGS_WIDTH) / 2);
    const settingsY = Math.round((h - SETTINGS_HEIGHT) / 2);
    settingsView.setBounds({ x: settingsX, y: settingsY, width: SETTINGS_WIDTH, height: SETTINGS_HEIGHT });
  }
}

function showTab(tab) {
  currentView = tab;
  updateLayout();
}

// --- Keyboard Management ---
function showKeyboardView() {
  if (keyboardVisible) return;
  console.log('Showing keyboard view');
  mainWindow.addBrowserView(keyboardView);
  keyboardVisible = true;
  updateLayout();
  // Ensure keyboard has the correct layout when shown
  keyboardView.webContents.send('keyboard-language-changed', currentKeyboardLanguage);
  setTimeout(() => measureKeyboardHeight(), 100);
}

function hideKeyboardView() {
  if (!keyboardVisible) return;
  console.log('Hiding keyboard view');
  try { mainWindow.removeBrowserView(keyboardView); } catch(e) {}
  keyboardVisible = false;
  updateLayout();
}

function toggleKeyboardView() {
  if (keyboardVisible) hideKeyboardView();
  else showKeyboardView();
}

function measureKeyboardHeight() {
  if (keyboardView && keyboardView.webContents) {
    keyboardView.webContents.executeJavaScript('document.getElementById("keyboard").offsetHeight')
      .then(height => {
        if (height && height > 50) {
          keyboardActualHeight = height;
          updateLayout();
        }
      }).catch(e => console.error('Failed to measure keyboard height:', e));
  }
}

// --- Settings Panel Management ---
function showSettingsView() {
    if (settingsVisible) return;
    console.log('Showing settings view');
    mainWindow.addBrowserView(settingsView);
    mainWindow.setTopBrowserView(settingsView);
    settingsVisible = true;
    updateLayout();
}

function hideSettingsView() {
    if (!settingsVisible) return;
    console.log('Hiding settings view');
    try { mainWindow.removeBrowserView(settingsView); } catch(e) {}
    settingsVisible = false;
    updateLayout();
}

function toggleSettingsView() {
    if (settingsVisible) hideSettingsView();
    else showSettingsView();
}


// --- System Commands ---
function getInitialVolume() {
    exec("amixer get Master | grep -oP '\\d+%(?=\\])' | head -1", (error, stdout, stderr) => {
        if (error || stderr) {
            console.error("Could not get initial volume:", error || stderr);
            currentVolume = 75; // Fallback
            return;
        }
        const volume = parseInt(stdout.replace('%', ''), 10);
        if (!isNaN(volume)) {
            currentVolume = volume;
            console.log(`Initial volume set to: ${currentVolume}%`);
        }
    });
}

function setSystemVolume(level) {
    if (level < 0 || level > 100) return;
    currentVolume = level;
    const command = `amixer set Master ${level}%`;
    exec(command, (error, stdout, stderr) => {
        if (error || stderr) {
            console.error(`Failed to set volume to ${level}%:`, error || stderr);
        } else {
            console.log(`Volume set to ${level}%`);
        }
    });
}

// --- Auto-Focus Detection ---
function setupAutoFocus(view) {
    if (!view || !view.webContents) return;
    view.webContents.on('console-message', (event, level, message) => {
      if (message.includes('KEYBOARD_EVENT:focus:')) showKeyboardView();
      else if (message.includes('KEYBOARD_EVENT:blur:')) hideKeyboardView();
    });
}


// --- IPC Handlers ---
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

// Tabs
ipcMain.on('switch-tab', (ev, tab) => showTab(tab));
ipcMain.on('refresh', () => { if (views[currentView]) views[currentView].webContents.reload(); });

// Keyboard
ipcMain.on('toggle-webkeyboard', toggleKeyboardView);
ipcMain.on('keyboard-height-changed', (ev, height) => {
  if (height && height > 50) {
    keyboardActualHeight = height;
    updateLayout();
  }
});
ipcMain.on('webkeyboard-key', (ev, key) => {
  const view = views[currentView];
  if (!view || !view.webContents) return;
  if (key === '{bksp}') {
    view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
  } else if (key === '{enter}') {
    view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  } else {
    view.webContents.sendInputEvent({ type: 'char', keyCode: key });
  }
});

// Settings
ipcMain.on('settings-toggle', toggleSettingsView);
ipcMain.handle('settings-get-initial', () => ({
    volume: currentVolume,
    keyboardLanguage: currentKeyboardLanguage
}));
ipcMain.on('settings-set-volume', (ev, level) => setSystemVolume(level));
ipcMain.on('settings-set-keyboard-language', (ev, lang) => {
    if (['de', 'en'].includes(lang)) {
        currentKeyboardLanguage = lang;
        console.log(`Keyboard language changed to: ${lang}`);
        // Forward the language change to the keyboard view
        if (keyboardView && keyboardView.webContents) {
            keyboardView.webContents.send('keyboard-language-changed', lang);
        }
    }
});

// Auto-focus from renderer
ipcMain.on('input-focused', showKeyboardView);
ipcMain.on('input-blurred', hideKeyboardView);