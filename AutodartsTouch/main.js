const { app, BrowserWindow, BrowserView, ipcMain, screen, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const { exec } = require('child_process');
const axios = require('axios');
const unzipper = require('unzipper');
const semver = require('semver');
const log = require('electron-log');

// Set log file path to userData directory
log.transports.file.resolvePathFn(() => path.join(app.getPath('userData'), 'logs', 'main.log'));

const store = new Store();

let mainWindow;
let views = {};
let toolbarView;
let keyboardView;
let settingsView;
let powerMenuView;
let currentView = 'tab0'; // Default to the first tab
let previousView = null;
let autodartsToolsExtensionId = null;

const GITHUB_REPO = 'creazy231/tools-for-autodarts';
// Use app.getPath('userData') for storing the extension
const EXTENSION_DIR = path.join(app.getPath('userData'), 'Extension');

// Helper function to get latest release info (version and download URL)
async function getLatestExtensionInfo() {
  log.info('Fetching latest extension info...');
  try {
    const response = await axios.get(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
    const latestVersion = semver.clean(response.data.tag_name);
    const chromeAsset = response.data.assets.find(asset => asset.name.endsWith('-chrome.zip'));

    if (!chromeAsset) {
      log.error('Could not find Chrome asset in the latest release.');
      return null;
    }

    log.info(`Latest extension version found: ${latestVersion} with URL: ${chromeAsset.browser_download_url}`);
    return {
      version: latestVersion,
      url: chromeAsset.browser_download_url,
    };
  } catch (error) {
    log.error('Failed to fetch latest extension info:', error);
    return null;
  }
}

// Helper function to get the currently installed version from manifest.json
function getInstalledExtensionVersion() {
  const manifestPath = path.join(EXTENSION_DIR, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const installedVersion = manifest.version;
      log.info(`Found installed extension version: ${installedVersion}`);
      return semver.clean(installedVersion);
    } catch (error) {
      log.error('Failed to read or parse installed extension manifest:', error);
      return null;
    }
  }
  log.info('Extension manifest not found. Extension is not installed.');
  return null;
}

// Helper function to download and extract the extension
async function downloadAndInstallExtension(url, version) {
  log.info(`Downloading extension version ${version} from: ${url}`);

  try {
    if (fs.existsSync(EXTENSION_DIR)) {
      log.info(`Removing existing extension directory at: ${EXTENSION_DIR}`);
      fs.rmSync(EXTENSION_DIR, { recursive: true, force: true });
    }
    log.info(`Creating new extension directory at: ${EXTENSION_DIR}`);
    fs.mkdirSync(EXTENSION_DIR, { recursive: true });

    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream'
    });

    log.info('Download stream opened. Starting extraction...');
    const extraction = response.data.pipe(unzipper.Extract({ path: EXTENSION_DIR }));

    await new Promise((resolve, reject) => {
      extraction.on('finish', () => {
        log.info(`Extension version ${version} downloaded and extracted successfully.`);
        resolve();
      });
      extraction.on('error', (err) => {
        log.error('An error occurred during extraction:', err);
        reject(err);
      });
    });

    return true;
  } catch (error) {
    log.error(`Failed to download or extract extension: ${error}`);
    if (fs.existsSync(EXTENSION_DIR)) {
      log.info('Cleaning up failed installation attempt.');
      fs.rmSync(EXTENSION_DIR, { recursive: true, force: true });
    }
    return false;
  }
}

const TOOLBAR_HEIGHT = 72;
const KEYBOARD_HEIGHT = 300;
let keyboardVisible = false;
let shiftActive = false;
let keyboardActualHeight = 300; // Dynamic keyboard height
let autoCloseEnabled = true; // Option to disable auto-close

async function createWindow() {
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

  // Create static views that are never reloaded
  settingsView = new BrowserView({ webPreferences: { contextIsolation: true, sandbox: false, preload: path.join(__dirname, 'preload.js') } });
  mainWindow.addBrowserView(settingsView);
  settingsView.webContents.loadFile(path.join(__dirname, 'settings.html'));

  powerMenuView = new BrowserView({
    webPreferences: { contextIsolation: true, sandbox: false, preload: path.join(__dirname, 'preload.js') },
    transparent: true
  });
  mainWindow.addBrowserView(powerMenuView);
  powerMenuView.webContents.loadFile(path.join(__dirname, 'power-menu.html'));

  // Load dynamic views for the first time
  await reloadDynamicViews();

  mainWindow.on('resize', () => {
    if (mainWindow && !mainWindow.isDestroyed() && toolbarView) {
      showTab(currentView);
      if (keyboardVisible) updateKeyboardBounds();
    }
  });
}

function createDynamicViews() {
  const loadingPromises = [];

  // Tab views
  const tabs = store.get('tabs', [
    { name: 'Autodarts', url: 'https://play.autodarts.io/' },
    { name: 'Service', url: 'http://localhost:3180/' }
  ]);
  tabs.forEach((tab, index) => {
    if (tab && tab.url && tab.url.trim() !== '') {
      const view = new BrowserView({ webPreferences: { contextIsolation: true, sandbox: false, preload: path.join(__dirname, 'preload.js') } });
      mainWindow.addBrowserView(view);
      views[`tab${index}`] = view;
      loadingPromises.push(view.webContents.loadURL(tab.url).catch(e => log.error(`tab${index} load error:`, e)));
    }
  });

  // Toolbar view
  toolbarView = new BrowserView({
    webPreferences: { contextIsolation: true, sandbox: false, preload: path.join(__dirname, 'preload.js') }
  });
  mainWindow.addBrowserView(toolbarView);
  loadingPromises.push(toolbarView.webContents.loadFile(path.join(__dirname, 'index.html')));

  // Keyboard view
  const keyboardLayout = store.get('keyboard.layout', 'de');
  keyboardView = new BrowserView({
    webPreferences: { contextIsolation: true, sandbox: false, preload: path.join(__dirname, 'preload.js') },
    transparent: true
  });
  mainWindow.addBrowserView(keyboardView);
  // The keyboard now fetches its own layout, so we don't need to pass it as a query param.
  loadingPromises.push(keyboardView.webContents.loadFile(path.join(__dirname, 'keyboard', 'index.html')));

  return Promise.all(loadingPromises).catch(e => log.error('Error loading one or more dynamic views:', e));
}

async function reloadDynamicViews() {
  log.info('Reloading dynamic views...');
  if (!mainWindow) return;

  // 1. Destroy only the dynamic views
  const dynamicViews = [
    ...Object.values(views),
    toolbarView,
    keyboardView,
  ];
  dynamicViews.forEach(view => {
    if (view && !view.webContents.isDestroyed()) {
      mainWindow.removeBrowserView(view);
      view.webContents.destroy();
    }
  });

  // 2. Reset dynamic view containers
  views = {};
  toolbarView = null;
  keyboardView = null;
  keyboardVisible = false;

  // 3. Re-create dynamic views and wait for them to load
  try {
    await createDynamicViews();
    log.info('Dynamic views finished loading.');
  } catch (error) {
    log.error('An error occurred during dynamic view reload:', error);
    return;
  }

  // 4. Determine initial tab and layout the UI
  let firstAvailableTab = Object.keys(views).length > 0 ? 'tab0' : null;
  currentView = firstAvailableTab;
  showTab(currentView);

  // 5. Apply settings and run setup
  applySettings();
  setTimeout(() => {
    setupAutoKeyboard();
  }, 1000);

  log.info('Dynamic views reloaded successfully.');
}

function showTab(tab) {
  if (!mainWindow) return;
  const [w, h] = mainWindow.getSize();

  // Calculate available height for content
  const availableHeight = h - TOOLBAR_HEIGHT - (keyboardVisible ? keyboardActualHeight : 0);
  log.info(`Layout update - Window: ${w}x${h}, Available content height: ${availableHeight}, Keyboard visible: ${keyboardVisible}, Keyboard height: ${keyboardActualHeight}`);

  Object.keys(views).forEach(k => {
    const v = views[k];
    if (k === tab) {
      // Active view gets the full available space
      v.setBounds({ 
        x: 0, 
        y: TOOLBAR_HEIGHT, 
        width: w, 
        height: availableHeight
      });
      v.setAutoResize({ width: true, height: true });
    } else {
      // Hidden views are moved off-screen
      v.setBounds({ 
        x: 0, 
        y: h, 
        width: w, 
        height: availableHeight 
      });
      v.setAutoResize({ width: true, height: true });
    }
  });

  if (tab === 'settings') {
    settingsView.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width: w, height: availableHeight });
    settingsView.setAutoResize({ width: true, height: true });
  } else {
    settingsView.setBounds({ x: 0, y: h, width: w, height: availableHeight });
  }

  try {
    toolbarView.setBounds({ x: 0, y: 0, width: w, height: TOOLBAR_HEIGHT });
    toolbarView.setAutoResize({ width: true });
  } catch (e) {
    log.error('Error setting toolbar bounds:', e);
  }

  currentView = tab;

  // Notify the toolbar that the active view has changed.
  if (toolbarView && toolbarView.webContents && !toolbarView.webContents.isDestroyed()) {
    toolbarView.webContents.send('active-view-changed', currentView);
  }

  if (keyboardVisible) updateKeyboardBounds();
}

function updateMainViewBounds() {
  if (!mainWindow) return;
  const [w, h] = mainWindow.getSize();

  // Determine the active view
  const activeView = (currentView === 'settings') ? settingsView : views[currentView];
  if (!activeView || !activeView.webContents || activeView.webContents.isDestroyed()) {
    log.error(`updateMainViewBounds: Cannot resize invalid or destroyed active view: ${currentView}`);
    return;
  }

  // Calculate available height for content
  const availableHeight = h - TOOLBAR_HEIGHT - (keyboardVisible ? keyboardActualHeight : 0);

  // Set bounds for only the active view
  activeView.setBounds({
    x: 0,
    y: TOOLBAR_HEIGHT,
    width: w,
    height: availableHeight
  });
}

function updateKeyboardBounds() {
  if (!mainWindow || !keyboardView) return;
  const [w, h] = mainWindow.getSize();
  
  // Position keyboard at the bottom
  keyboardView.setBounds({ 
    x: 0, 
    y: h - keyboardActualHeight, 
    width: w, 
    height: keyboardActualHeight 
  });
  keyboardView.setAutoResize({ width: true });
}

function showKeyboardView() {
  if (!keyboardVisible) {
    log.info('Showing keyboard view');
    
    if (keyboardView && keyboardView.webContents) {
      keyboardView.webContents.executeJavaScript('window.showKeyboard && window.showKeyboard()').catch(e => log.error('Failed to reset keyboard:', e));
    }
    
    keyboardVisible = true;
    
    applyKeyboardStyle();
    showTab(currentView); // This will resize the main view
    updateKeyboardBounds(); // This will position the keyboard correctly
    
    setTimeout(() => {
      measureKeyboardHeight();
    }, 100);
  }
}

function hideKeyboardView() {
  if (keyboardVisible) {
    log.info('Hiding keyboard view');
    keyboardVisible = false;
    
    // Move keyboard off-screen instead of removing it
    if (mainWindow && keyboardView) {
      const [w, h] = mainWindow.getSize();
      keyboardView.setBounds({ x: 0, y: h, width: w, height: keyboardActualHeight });
    }

    // Update layout without keyboard
    showTab(currentView);
  }
}

function measureKeyboardHeight() {
  if (keyboardView && keyboardView.webContents) {
    keyboardView.webContents.executeJavaScript('document.getElementById("keyboard")?.offsetHeight || 0')
    .then(height => {
      if (height > 100) {
        if (keyboardActualHeight !== height) {
          keyboardActualHeight = height;
          if (keyboardVisible) {
            updateKeyboardBounds();
            showTab(currentView);
          }
        }
      } else {
        keyboardActualHeight = 250;
        if(keyboardVisible) {
            updateKeyboardBounds();
            showTab(currentView);
        }
      }
    }).catch(e => {
      log.error('Failed to measure keyboard height via JS, using fallback.', e);
      keyboardActualHeight = 250;
      if (keyboardVisible) {
        updateKeyboardBounds();
        showTab(currentView);
      }
    });
  }
}

function toggleKeyboardView() {
  if (keyboardVisible) {
    hideKeyboardView();
  } else {
    showKeyboardView();
  }
}

function applySettings() {
  const volume = store.get('volume', 50);

  // Set system volume
  exec(`amixer -D pulse sset Master ${volume}%`, (error, stdout, stderr) => {
    if (error) {
      log.error(`exec error: ${error}`);
      return;
    }
    log.info(`System volume set to ${volume}%`);
  });

  // Also apply keyboard style if visible
  applyKeyboardStyle();
}

function applyKeyboardStyle(style) {
  const keyboardWidth = style ? style.width : store.get('keyboard.width', 100);
  const keyHeight = style ? style.keyHeight : store.get('keyboard.keyHeight', 50);
  const keyboardLayout = style ? style.layout : store.get('keyboard.layout', 'de');

  if (keyboardView && keyboardView.webContents) {
    const sendStyle = () => {
      keyboardView.webContents.send('update-keyboard-style', {
        width: keyboardWidth,
        keyHeight: keyHeight,
        layout: keyboardLayout
      });
    };
    if (keyboardView.webContents.isLoading()) {
      keyboardView.webContents.once('dom-ready', sendStyle);
    } else {
      sendStyle();
    }
  }
}

// Helper function to inject focus detection script reliably
function injectFocusDetector(view, viewName) {
  if (!view || !view.webContents || view.webContents.isDestroyed()) {
    log.error(`[Debug] Skipping focus injection for invalid/destroyed view: ${viewName}`);
    return;
  }

  // This script is injected into each webview to detect when an input is focused.
  const script = `
      (function() {
        if (window.keyboardFocusHandlersInstalled) {
          return;
        }
        window.keyboardFocusHandlersInstalled = true;

        function isInputElement(element) {
          if (!element) return false;
          const tagName = element.tagName ? element.tagName.toLowerCase() : '';
          const type = element.type ? element.type.toLowerCase() : '';
          const isContentEditable = element.contentEditable === 'true' || element.getAttribute('contenteditable') === 'true';
          return tagName === 'input' || tagName === 'textarea' || isContentEditable;
        }

        function notifyMainProcess(eventType) {
          if (window.electronAPI && typeof window.electronAPI.inputFocused === 'function') {
            if (eventType === 'focus') {
              window.electronAPI.inputFocused('${viewName}');
            } else {
              window.electronAPI.inputBlurred('${viewName}');
            }
          }
        }

        function handleFocus(event) {
          if (isInputElement(event.target)) {
            notifyMainProcess('focus');
          }
        }

        function handleBlur(event) {
          if (isInputElement(event.target)) {
            setTimeout(() => {
              if (!document.activeElement || !isInputElement(document.activeElement)) {
                notifyMainProcess('blur');
              }
            }, 100);
          }
        }

        document.addEventListener('focusin', handleFocus, true);
        document.addEventListener('focusout', handleBlur, true);
      })();
  `;

  const doInjection = () => {
      view.webContents.executeJavaScript(script).catch(err => {
          log.error(`[Debug] FAILED to inject focus script into ${viewName}:`, err);
      });
  };

  if (view.webContents.isLoading()) {
      view.webContents.once('dom-ready', doInjection);
  } else {
      doInjection();
  }
}

function setupAutoKeyboard() {
  const allViews = { ...views, settings: settingsView };

  Object.entries(allViews).forEach(([viewName, view]) => {
      if (!view || view.webContents.isDestroyed()) {
          return;
      }
      injectFocusDetector(view, viewName);
  });
}

// IPC
ipcMain.on('open-settings', () => {
  if (currentView !== 'settings') {
    previousView = currentView;
    settingsView.webContents.reload();
    showTab('settings');
    showKeyboardView();
    autoCloseEnabled = false;
  }
});
ipcMain.on('switch-tab', (ev, tab) => {
  if (tab && views[tab]) {
    if (currentView === 'settings' && tab !== 'settings') {
      applySettings();
      hideKeyboardView();
      autoCloseEnabled = true;
    }
    showTab(tab);
  }
});
ipcMain.on('refresh', () => {
  const view = (currentView === 'settings') ? settingsView : views[currentView];
  if (view) view.webContents.reload();
});

ipcMain.on('force-reload', () => {
  const view = views[currentView];
  if (view) {
    const tabs = store.get('tabs', []);
    const tabIndex = parseInt(currentView.replace('tab', ''), 10);
    if (tabs[tabIndex] && tabs[tabIndex].url) {
      view.webContents.loadURL(tabs[tabIndex].url);
    }
  }
});

ipcMain.on('toggle-webkeyboard', () => {
  if (currentView === 'settings') {
    showKeyboardView();
    return;
  }
  toggleKeyboardView();
});

ipcMain.on('open-power-menu', () => {
    if (mainWindow && powerMenuView && !powerMenuView.webContents.isDestroyed()) {
        const [w, h] = mainWindow.getSize();
        powerMenuView.setBounds({ x: 0, y: 0, width: w, height: h });
        mainWindow.setTopBrowserView(powerMenuView);
    }
});

ipcMain.on('close-power-menu', () => {
    if (mainWindow && powerMenuView && !powerMenuView.webContents.isDestroyed()) {
        const [w, h] = mainWindow.getSize();
        powerMenuView.setBounds({ x: 0, y: h, width: w, height: h });
    }
});

ipcMain.handle('getExtensionVersions', async () => {
  log.info('IPC: getExtensionVersions called.');
  try {
    const installed = getInstalledExtensionVersion();
    const latestInfo = await getLatestExtensionInfo();
    if (!latestInfo) {
      return { error: 'Could not fetch latest version info from GitHub.' };
    }
    const latest = latestInfo.version;
    const isUpdateAvailable = installed && latest ? semver.gt(latest, installed) : false;
    log.info(`IPC: getExtensionVersions returning: installed=${installed}, latest=${latest}, updateAvailable=${isUpdateAvailable}`);
    return { installed, latest, isUpdateAvailable };
  } catch (error) {
    log.error('IPC: getExtensionVersions error:', error);
    return { error: error.message };
  }
});

ipcMain.handle('downloadExtension', async () => {
  log.info('IPC: downloadExtension called.');
  const latestInfo = await getLatestExtensionInfo();
  if (latestInfo && latestInfo.url && latestInfo.version) {
    const success = await downloadAndInstallExtension(latestInfo.url, latestInfo.version);
    if (success) {
      if (autodartsToolsExtensionId) {
        await session.defaultSession.removeExtension(autodartsToolsExtensionId);
        log.info('Removed old extension version to prepare for reload.');
        autodartsToolsExtensionId = null;
      }
      if (store.get('enableExtension', false)) {
        try {
          const extension = await session.defaultSession.loadExtension(EXTENSION_DIR, { allowFileAccess: true });
          autodartsToolsExtensionId = extension.id;
          log.info('Successfully reloaded extension after download/update.');
        } catch (error) {
          log.error('Failed to reload extension after download/update:', error);
        }
      }
    }
    return { success };
  }
  log.error('IPC: downloadExtension failed because latest info was not available.');
  return { success: false, error: 'Could not get latest release information.' };
});

ipcMain.on('open-log-file', () => {
  const logFilePath = log.transports.file.getFile().path;
  log.info(`IPC: open-log-file called. Opening: ${logFilePath}`);
  shell.showItemInFolder(logFilePath);
});

ipcMain.on('power-control', (event, action) => {
  switch (action) {
    case 'shutdown':
      exec('shutdown -h now', (err) => {
        if (err) log.error('Shutdown command failed:', err);
      });
      break;
    case 'restart':
      exec('reboot', (err) => {
        if (err) log.error('Restart command failed:', err);
      });
      break;
    case 'close-app':
      app.quit();
      break;
  }
});

ipcMain.handle('get-keyboard-layouts', async () => {
  const layoutDir = path.join(__dirname, 'keyboard', 'layouts');
  try {
    const files = await fs.promises.readdir(layoutDir);
    return files
      .filter(file => file.endsWith('.js'))
      .map(file => file.replace('.js', ''));
  } catch (error) {
    log.error(`FATAL: Could not read keyboard layouts from ${layoutDir}.`, error);
    return [];
  }
});

ipcMain.handle('get-keyboard-layout-data', async (event, layoutName) => {
  const requestedLayout = (layoutName || '').toLowerCase();
  if (!requestedLayout) {
    log.error('Request for invalid or empty layout name rejected.');
    return null;
  }

  const layoutDir = path.join(__dirname, 'keyboard', 'layouts');

  try {
    const files = await fs.promises.readdir(layoutDir);
    const targetFile = files.find(file =>
      path.basename(file, '.js').toLowerCase() === requestedLayout
    );

    if (!targetFile) {
      log.error(`Layout file not found for '${layoutName}' in directory ${layoutDir}`);
      return null;
    }

    const layoutPath = path.join(layoutDir, targetFile);
    const layoutData = require(layoutPath);
    delete require.cache[require.resolve(layoutPath)];
    return layoutData;
  } catch (error) {
    log.error(`FATAL: Could not load layout module for '${layoutName}'.`, error);
    return null;
  }
});

ipcMain.handle('get-settings', async () => {
  return {
    volume: store.get('volume', 50),
    keyboardWidth: store.get('keyboard.width', 100),
    keyHeight: store.get('keyboard.keyHeight', 50),
    keyboardLayout: store.get('keyboard.layout', 'de'),
    enableExtension: store.get('enableExtension', false),
    tabs: store.get('tabs', [
      { name: 'Autodarts', url: 'https://play.autodarts.io/' },
      { name: 'Service', url: 'http://localhost:3180/' }
    ])
  };
});

ipcMain.on('save-settings', async (event, settings) => {
  log.info('Saving settings...');
  const oldEnableExtension = store.get('enableExtension', false);

  store.set('volume', settings.volume);
  store.set('keyboard.width', settings.keyboardWidth);
  store.set('keyboard.keyHeight', settings.keyHeight);
  store.set('keyboard.layout', settings.keyboardLayout);
  store.set('tabs', settings.tabs);
  store.set('enableExtension', settings.enableExtension);

  if (oldEnableExtension !== settings.enableExtension) {
    if (settings.enableExtension) {
      if (!autodartsToolsExtensionId && fs.existsSync(EXTENSION_DIR)) {
        try {
          const extension = await session.defaultSession.loadExtension(EXTENSION_DIR, { allowFileAccess: true });
          autodartsToolsExtensionId = extension.id;
          log.info('Autodarts Tools extension dynamically loaded.');
        } catch (error) {
          log.error('Failed to dynamically load extension:', error);
        }
      }
    } else {
      if (autodartsToolsExtensionId) {
        try {
          await session.defaultSession.removeExtension(autodartsToolsExtensionId);
          log.info('Autodarts Tools extension dynamically unloaded.');
          autodartsToolsExtensionId = null;
        } catch (error) {
          log.error('Failed to dynamically unload extension:', error);
        }
      }
    }
  }

  applySettings();

  setTimeout(async () => {
    await reloadDynamicViews();

    if (previousView && views[previousView]) {
      showTab(previousView);
    } else {
      const firstTab = Object.keys(views).find(k => k.startsWith('tab'));
      showTab(firstTab || null);
    }
    previousView = null;
    autoCloseEnabled = true;
    log.info('Settings saved and dynamic views reloaded successfully.');
  }, 100);

  hideKeyboardView();
});

ipcMain.on('set-cursor-visibility', (event, visible) => {
    const css = `* { cursor: ${visible ? 'default' : 'none'} !important; }`;
    const allViews = [...Object.values(views), toolbarView, settingsView, keyboardView, powerMenuView];
    allViews.forEach(view => {
        if (view && view.webContents && !view.webContents.isDestroyed()) {
            view.webContents.insertCSS(css).catch(e => log.error(`Failed to set cursor visibility for a view: ${e}`));
        }
    });
});

ipcMain.handle('get-tabs', async () => {
  return store.get('tabs', [
    { name: 'Autodarts', url: 'https://play.autodarts.io/' },
    { name: 'Service', url: 'http://localhost:3180/' }
  ]);
});

ipcMain.handle('get-current-view', () => {
  return currentView;
});

ipcMain.on('close-settings', () => {
  // Restore original settings from store before closing, discarding any live changes
  applySettings();

  if (previousView) {
    showTab(previousView);
  }
  hideKeyboardView();
  autoCloseEnabled = true;
});

// For live preview of keyboard settings
ipcMain.on('update-keyboard-style-live', (event, style) => {
  applyKeyboardStyle(style);
});

ipcMain.on('keyboard-height-changed', (event, height) => {
  if (height && height > 100) {
    if (keyboardActualHeight !== height) {
      log.info(`IPC: Keyboard height updated to ${height}px`);
      keyboardActualHeight = height;
      if (keyboardVisible) {
        updateKeyboardBounds();
        updateMainViewBounds();
      }
    }
  } else {
    log.warn(`IPC: Received invalid keyboard height: ${height}px. Using fallback.`);
    keyboardActualHeight = 250;
    if (keyboardVisible) {
      updateKeyboardBounds();
      updateMainViewBounds();
    }
  }
});

// Auto-focus keyboard handlers
ipcMain.on('input-focused', (event, viewName) => {
  log.info(`[FOCUS_DEBUG] Main process received 'input-focused' from view: ${viewName}.`);
  if (!keyboardVisible) {
    log.info('[FOCUS_DEBUG] Keyboard not visible, showing it now.');
    showKeyboardView();
  }
});

ipcMain.on('input-blurred', (event, viewName) => {
  log.info(`[FOCUS_DEBUG] Main process received 'input-blurred' from view: ${viewName}.`);
  if (keyboardVisible && autoCloseEnabled) {
    log.info('[FOCUS_DEBUG] Keyboard is visible and auto-close is enabled. Hiding keyboard after delay.');
    setTimeout(() => {
      if (keyboardVisible && autoCloseEnabled) {
        log.info('[FOCUS_DEBUG] Auto-hiding keyboard now.');
        hideKeyboardView();
      }
    }, 300);
  }
});

// receive key presses from keyboard page (via preload -> ipc)
ipcMain.on('webkeyboard-key', (ev, key) => {
  const targetView = (currentView === 'settings') ? settingsView : views[currentView];

  if (!targetView || !targetView.webContents || targetView.webContents.isDestroyed()) {
    log.error(`Cannot send key to invalid or destroyed view: ${currentView}`);
    return;
  }

  log.info(`Sending key '${key}' to view '${currentView}'. Shift active: ${shiftActive}`);

  if (key === '{bksp}') {
    targetView.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
    targetView.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
  } else if (key === '{enter}') {
    targetView.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    targetView.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  } else if (key === '{space}' || key === ' ') {
    targetView.webContents.sendInputEvent({ type: 'char', keyCode: ' ' });
  } else if (key === '{tab}') {
    targetView.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    targetView.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
  } else if (key === '{shift}') {
    shiftActive = !shiftActive;
  } else if (key === '{capslock}') {
    shiftActive = !shiftActive;
  } else {
    targetView.webContents.sendInputEvent({ type: 'char', keyCode: key });
  }
});

// Receive shift status updates from keyboard
ipcMain.on('keyboard-shift-status', (ev, isActive) => {
  shiftActive = isActive;
});

app.whenReady().then(async () => {
  const enableExtension = store.get('enableExtension', false);
  if (enableExtension && fs.existsSync(EXTENSION_DIR)) {
    try {
      const extension = await session.defaultSession.loadExtension(EXTENSION_DIR, { allowFileAccess: true });
      autodartsToolsExtensionId = extension.id;
      log.info('Autodarts Tools extension loaded successfully on startup.');
    } catch (error) {
      log.error('Failed to load Autodarts Tools extension on startup:', error);
    }
  }
  createWindow();
});

app.on('window-all-closed', () => app.quit());