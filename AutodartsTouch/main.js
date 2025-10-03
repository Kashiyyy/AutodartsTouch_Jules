const { app, BrowserWindow, BrowserView, ipcMain, screen, session, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const { exec } = require('child_process');
const axios = require('axios');
const unzipper = require('unzipper');
const semver = require('semver');

const store = new Store();

let mainWindow;
let views = {};
let toolbarView;
let keyboardView;
let settingsView;
let powerMenuView;
let currentView = 'tab0';
let previousView = null;
let autodartsToolsExtensionId = null;
let availableUpdateVersion = null; // To store update info

const GITHUB_REPO = 'creazy231/tools-for-autodarts';
const APP_GITHUB_REPO = 'Kashiyyy/AutodartsTouch';
let EXTENSION_DIR; // Will be initialized once the app is ready

// Helper function to get latest app release info
async function getLatestAppInfo() {
  try {
    const response = await axios.get(`https://api.github.com/repos/${APP_GITHUB_REPO}/releases/latest`);
    // Return the raw tag name, as that's what the install script and git expect.
    return { version: response.data.tag_name };
  } catch (error) {
    console.error('Failed to fetch latest app info:', error);
    return null;
  }
}

// Helper function to get the currently installed app version from version.json
function getInstalledAppVersion() {
  const versionPath = path.join(__dirname, 'version.json');
  if (fs.existsSync(versionPath)) {
    try {
      const versionFile = JSON.parse(fs.readFileSync(versionPath, 'utf-8'));
      return versionFile.version;
    } catch (error) {
      console.error('Failed to read or parse app version file:', error);
      return null;
    }
  }
  return null;
}

// Helper function to get latest release info (version and download URL)
async function getLatestExtensionInfo() {
  try {
    const response = await axios.get(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
    const latestVersion = semver.clean(response.data.tag_name);
    const chromeAsset = response.data.assets.find(asset => asset.name.endsWith('-chrome.zip'));

    if (!chromeAsset) {
      console.error('Could not find Chrome asset in the latest release.');
      return null;
    }

    return {
      version: latestVersion,
      url: chromeAsset.browser_download_url,
    };
  } catch (error) {
    console.error('Failed to fetch latest extension info:', error);
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
      return semver.clean(installedVersion);
    } catch (error) {
      console.error('Failed to read or parse installed extension manifest:', error);
      return null;
    }
  }
  return null;
}

// Helper function to download and extract the extension
async function downloadAndInstallExtension(url, version) {
  try {
    if (fs.existsSync(EXTENSION_DIR)) {
      fs.rmSync(EXTENSION_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(EXTENSION_DIR, { recursive: true });

    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream'
    });

    const extraction = response.data.pipe(unzipper.Extract({ path: EXTENSION_DIR }));

    await new Promise((resolve, reject) => {
      extraction.on('finish', () => {
        resolve();
      });
      extraction.on('error', (err) => {
        console.error('An error occurred during extraction:', err);
        reject(err);
      });
    });

    return true;
  } catch (error) {
    console.error(`Failed to download or extract extension: ${error}`);
    if (fs.existsSync(EXTENSION_DIR)) {
      fs.rmSync(EXTENSION_DIR, { recursive: true, force: true });
    }
    return false;
  }
}

let toolbarHeight;

const getSetting = (key, defaultValue) => {
  const value = store.get(key, defaultValue);
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
};

toolbarHeight = getSetting('toolbar.height', 72);

// Helper function to inject CSS that disables text selection.
function applyGlobalCss(view) {
  if (!view || !view.webContents || view.webContents.isDestroyed()) return;

  const css = `html, body { -webkit-user-select: none !important; user-select: none !important; } input, textarea { -webkit-user-select: auto !important; user-select: auto !important; }`;

  const doInject = () => {
    view.webContents.insertCSS(css).catch(err => console.error(`Failed to inject global CSS:`, err));
  };

  if (view.webContents.isLoading()) {
    view.webContents.once('dom-ready', doInject);
  } else {
    doInject();
  }
}

const KEYBOARD_HEIGHT = 300;
let keyboardVisible = false;
let shiftActive = false;
let keyboardActualHeight = 300;
let autoCloseEnabled = true;

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

  settingsView = new BrowserView({ webPreferences: { contextIsolation: true, sandbox: false, preload: path.join(__dirname, 'preload.js') } });
  applyGlobalCss(settingsView);
  mainWindow.addBrowserView(settingsView);
  settingsView.webContents.loadFile(path.join(__dirname, 'settings.html'));

  powerMenuView = new BrowserView({
    webPreferences: { contextIsolation: true, sandbox: false, preload: path.join(__dirname, 'preload.js') },
    transparent: true
  });
  applyGlobalCss(powerMenuView);
  mainWindow.addBrowserView(powerMenuView);
  powerMenuView.webContents.loadFile(path.join(__dirname, 'power-menu.html'));

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

  const tabs = store.get('tabs', [
    { name: 'Autodarts', url: 'https://play.autodarts.io/' },
    { name: 'Service', url: 'http://localhost:3180/' }
  ]);
  tabs.forEach((tab, index) => {
    if (tab && tab.url && tab.url.trim() !== '') {
      const view = new BrowserView({ webPreferences: { contextIsolation: true, sandbox: false, preload: path.join(__dirname, 'preload.js') } });
      applyGlobalCss(view);
      mainWindow.addBrowserView(view);
      views[`tab${index}`] = view;
      loadingPromises.push(view.webContents.loadURL(tab.url).catch(e => console.error(`tab${index} load error:`, e)));
    }
  });

  toolbarView = new BrowserView({
    webPreferences: { contextIsolation: true, sandbox: false, preload: path.join(__dirname, 'preload.js') }
  });
  applyGlobalCss(toolbarView);
  mainWindow.addBrowserView(toolbarView);
  loadingPromises.push(toolbarView.webContents.loadFile(path.join(__dirname, 'index.html')));

  keyboardView = new BrowserView({
    webPreferences: { contextIsolation: true, sandbox: false, preload: path.join(__dirname, 'preload.js') },
    transparent: true
  });
  applyGlobalCss(keyboardView);
  mainWindow.addBrowserView(keyboardView);
  loadingPromises.push(keyboardView.webContents.loadFile(path.join(__dirname, 'keyboard', 'index.html')));

  return Promise.all(loadingPromises).catch(e => console.error('Error loading one or more dynamic views:', e));
}

async function reloadDynamicViews() {
  if (!mainWindow) return;

  const dynamicViews = [ ...Object.values(views), toolbarView, keyboardView ];
  dynamicViews.forEach(view => {
    if (view && !view.webContents.isDestroyed()) {
      mainWindow.removeBrowserView(view);
      view.webContents.destroy();
    }
  });

  views = {};
  toolbarView = null;
  keyboardView = null;
  keyboardVisible = false;

  try {
    await createDynamicViews();
  } catch (error) {
    console.error('An error occurred during dynamic view reload:', error);
    return;
  }

  let firstAvailableTab = Object.keys(views).length > 0 ? 'tab0' : null;
  currentView = firstAvailableTab;
  showTab(currentView);

  applySettings();
  setTimeout(() => {
    setupAutoKeyboard();
  }, 1000);
}

function showTab(tab) {
  if (!mainWindow) return;
  const [w, h] = mainWindow.getSize();

  const currentToolbarHeight = getSetting('toolbar.height', 72);
  const availableHeight = h - currentToolbarHeight - (keyboardVisible ? keyboardActualHeight : 0);

  Object.keys(views).forEach(k => {
    const v = views[k];
    if (k === tab) {
      v.setBounds({ x: 0, y: currentToolbarHeight, width: w, height: availableHeight });
      v.setAutoResize({ width: true, height: true });
    } else {
      v.setBounds({ x: 0, y: h, width: w, height: availableHeight });
      v.setAutoResize({ width: true, height: true });
    }
  });

  if (tab === 'settings') {
    const currentToolbarHeight = getSetting('toolbar.height', 72);
    settingsView.setBounds({ x: 0, y: currentToolbarHeight, width: w, height: availableHeight });
    settingsView.setAutoResize({ width: true, height: true });
  } else {
    settingsView.setBounds({ x: 0, y: h, width: w, height: availableHeight });
  }

  try {
    const currentToolbarHeight = getSetting('toolbar.height', 72);
    toolbarView.setBounds({ x: 0, y: 0, width: w, height: currentToolbarHeight });
    toolbarView.setAutoResize({ width: true });
  } catch (e) {
    console.error('Error setting toolbar bounds:', e);
  }

  currentView = tab;

  if (toolbarView && toolbarView.webContents && !toolbarView.webContents.isDestroyed()) {
    toolbarView.webContents.send('active-view-changed', currentView);
  }

  if (keyboardVisible) updateKeyboardBounds();
}

function updateMainViewBounds() {
  if (!mainWindow) return;
  const [w, h] = mainWindow.getSize();
  const activeView = (currentView === 'settings') ? settingsView : views[currentView];
  if (!activeView || !activeView.webContents || activeView.webContents.isDestroyed()) {
    console.error(`updateMainViewBounds: Cannot resize invalid or destroyed active view: ${currentView}`);
    return;
  }
  const currentToolbarHeight = getSetting('toolbar.height', 72);
  const availableHeight = h - currentToolbarHeight - (keyboardVisible ? keyboardActualHeight : 0);
  activeView.setBounds({ x: 0, y: currentToolbarHeight, width: w, height: availableHeight });
}

function updateKeyboardBounds() {
  if (!mainWindow || !keyboardView) return;
  const [w, h] = mainWindow.getSize();
  keyboardView.setBounds({ x: 0, y: h - keyboardActualHeight, width: w, height: keyboardActualHeight });
  keyboardView.setAutoResize({ width: true });
}

function showKeyboardView() {
  if (!keyboardVisible) {
    if (keyboardView && keyboardView.webContents) {
      keyboardView.webContents.executeJavaScript('window.showKeyboard && window.showKeyboard()').catch(e => console.error('Failed to reset keyboard:', e));
    }
    keyboardVisible = true;
    applyKeyboardStyle();
    showTab(currentView);
    updateKeyboardBounds();
    setTimeout(measureKeyboardHeight, 100);
  }
}

function hideKeyboardView() {
  if (keyboardVisible) {
    keyboardVisible = false;
    if (mainWindow && keyboardView) {
      const [w, h] = mainWindow.getSize();
      keyboardView.setBounds({ x: 0, y: h, width: w, height: keyboardActualHeight });
    }
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
      console.error('Failed to measure keyboard height via JS, using fallback.', e);
      keyboardActualHeight = 250;
      if (keyboardVisible) {
        updateKeyboardBounds();
        showTab(currentView);
      }
    });
  }
}

function toggleKeyboardView() {
  if (keyboardVisible) hideKeyboardView(); else showKeyboardView();
}

function applySettings() {
  const volume = getSetting('volume', 50);
  exec(`amixer -D pulse sset Master ${volume}%`, (error) => {
    if (error) console.error(`exec error: ${error}`);
  });
  applyKeyboardStyle();
  applyToolbarStyle();
}

function applyToolbarStyle(style) {
  const height = style ? style.height : getSetting('toolbar.height', 72);
  toolbarHeight = height;
  const fontSize = style ? style.fontSize : getSetting('toolbar.fontSize', 24);
  if (toolbarView && toolbarView.webContents) {
    const sendStyle = () => toolbarView.webContents.send('update-toolbar-style', { height, fontSize });
    if (toolbarView.webContents.isLoading()) toolbarView.webContents.once('dom-ready', sendStyle);
    else sendStyle();
  }
}

function applyKeyboardStyle(style) {
  const keyboardWidth = style ? style.width : getSetting('keyboard.width', 100);
  const keyHeight = style ? style.keyHeight : getSetting('keyboard.keyHeight', 50);
  const keyboardLayout = store.get('keyboard.layout', 'de'); // Layout is a string, no need to parse
  if (keyboardView && keyboardView.webContents) {
    const sendStyle = () => keyboardView.webContents.send('update-keyboard-style', { width: keyboardWidth, keyHeight: keyHeight, layout: keyboardLayout });
    if (keyboardView.webContents.isLoading()) keyboardView.webContents.once('dom-ready', sendStyle);
    else sendStyle();
  }
}

function injectFocusDetector(view, viewName) {
  if (!view || !view.webContents || view.webContents.isDestroyed()) {
    console.error(`Skipping focus injection for invalid/destroyed view: ${viewName}`);
    return;
  }
  const script = `(function() {
    if (window.keyboardFocusHandlersInstalled) return;
    window.keyboardFocusHandlersInstalled = true;
    function isInputElement(el) {
      if (!el) return false;
      const tn = el.tagName ? el.tagName.toLowerCase() : '';
      const ty = el.type ? el.type.toLowerCase() : '';
      return tn === 'input' || tn === 'textarea' || el.contentEditable === 'true';
    }
    function notify(type) {
      if (window.electronAPI) {
        if (type === 'focus') window.electronAPI.inputFocused('${viewName}');
        else window.electronAPI.inputBlurred('${viewName}');
      }
    }
    document.addEventListener('focusin', e => { if (isInputElement(e.target)) notify('focus'); }, true);
    document.addEventListener('focusout', e => {
      if (isInputElement(e.target)) setTimeout(() => {
        if (!document.activeElement || !isInputElement(document.activeElement)) notify('blur');
      }, 100);
    }, true);
  })();`;
  const doInjection = () => view.webContents.executeJavaScript(script).catch(err => console.error(`Failed to inject focus script into ${viewName}:`, err));
  if (view.webContents.isLoading()) view.webContents.once('dom-ready', doInjection);
  else doInjection();
}

function setupAutoKeyboard() {
  Object.entries({ ...views, settings: settingsView }).forEach(([viewName, view]) => {
    if (view && !view.webContents.isDestroyed()) injectFocusDetector(view, viewName);
  });
}

// This is the main entry point.
app.whenReady().then(async () => {
  // Initialize paths now that app is ready
  const extensionName = GITHUB_REPO.split('/')[1];
  EXTENSION_DIR = path.join(__dirname, 'extensions', extensionName);

  // Register IPC Handlers that depend on app paths
  ipcMain.handle('getAppVersions', async () => {
    try {
      const installed = getInstalledAppVersion();
      const latestInfo = await getLatestAppInfo();
      if (!latestInfo) return { error: 'Could not fetch latest version info from GitHub.', installed };
      const latest = latestInfo.version;

      let isUpdateAvailable = false;
      // If the latest version is valid and the installed version is not,
      // consider an update available (e.g., from 'main' to a release).
      if (semver.valid(latest)) {
        if (!semver.valid(installed)) {
          isUpdateAvailable = true;
        } else {
          // Both are valid, so compare them.
          isUpdateAvailable = semver.gt(latest, installed);
        }
      }

      return { installed, latest, isUpdateAvailable };
    } catch (error) {
      // Return a generic error but still provide the installed version if possible
      console.error('IPC: getAppVersions error:', error);
      const installed = getInstalledAppVersion();
      return { error: error.message, installed };
    }
  });

  function runUpdateScript(version) {
    // This script is now part of the application bundle.
    const scriptPath = path.join(__dirname, 'update.sh');

    // Ensure the script is executable, as permissions might be lost.
    try {
      fs.chmodSync(scriptPath, '755');
    } catch (error) {
      console.error(`Failed to set permissions on update script: ${error}`);
      settingsView.webContents.send('update-failed', 'Failed to set permissions on update script.');
      return;
    }

    // Execute the local update script, passing the target version as an argument.
    exec(`bash "${scriptPath}" "${version || ''}"`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Update script execution failed: ${error}`);
        settingsView.webContents.send('update-failed', stderr);
        return;
      }
      // On success, notify the settings window.
      settingsView.webContents.send('update-successful');
    });
  }

  ipcMain.on('updateApp', (event, version) => {
    runUpdateScript(version);
  });

  ipcMain.on('reinstallApp', (event, version) => {
    runUpdateScript(version);
  });

  ipcMain.on('reboot-system', () => {
    exec('reboot', (err) => {
      if (err) {
        console.error('Reboot command failed:', err);
        // Inform the user if the command fails
        settingsView.webContents.send('reboot-failed', 'Reboot command failed. Please reboot manually.');
      }
    });
  });

  ipcMain.handle('getExtensionVersions', async () => {
    try {
      const installed = getInstalledExtensionVersion();
      const latestInfo = await getLatestExtensionInfo();
      if (!latestInfo) return { error: 'Could not fetch latest version info from GitHub.' };
      const latest = latestInfo.version;
      const isUpdateAvailable = installed && latest ? semver.gt(latest, installed) : false;
      return { installed, latest, isUpdateAvailable };
    } catch (error) {
      console.error('IPC: getExtensionVersions error:', error);
      return { error: error.message };
    }
  });

  ipcMain.handle('downloadExtension', async () => {
    const latestInfo = await getLatestExtensionInfo();
    if (latestInfo && latestInfo.url && latestInfo.version) {
      const success = await downloadAndInstallExtension(latestInfo.url, latestInfo.version);
      if (success) {
        if (autodartsToolsExtensionId) {
          await session.defaultSession.removeExtension(autodartsToolsExtensionId);
          autodartsToolsExtensionId = null;
        }
        if (store.get('enableExtension', false)) {
          try {
            const extension = await session.defaultSession.loadExtension(EXTENSION_DIR, { allowFileAccess: true });
            autodartsToolsExtensionId = extension.id;
          } catch (error) {
            console.error('Failed to reload extension after download/update:', error);
          }
        }
        if (toolbarView && toolbarView.webContents && !toolbarView.webContents.isDestroyed()) {
          toolbarView.webContents.send('update-installed');
        }
      }
      return { success };
    }
    console.error('IPC: downloadExtension failed because latest info was not available.');
    return { success: false, error: 'Could not get latest release information.' };
  });

  // Other IPC Handlers not dependent on app paths
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
      if (tabs[tabIndex] && tabs[tabIndex].url) view.webContents.loadURL(tabs[tabIndex].url);
    }
  });

  ipcMain.on('toggle-webkeyboard', () => {
    if (currentView === 'settings') showKeyboardView(); else toggleKeyboardView();
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

  ipcMain.on('power-control', (event, action) => {
    switch (action) {
      case 'shutdown': exec('shutdown -h now', (err) => { if (err) console.error('Shutdown command failed:', err); }); break;
      case 'restart': exec('reboot', (err) => { if (err) console.error('Restart command failed:', err); }); break;
      case 'close-app': app.quit(); break;
    }
  });

  ipcMain.on('toolbar-ready', () => {
    // Check for updates when the toolbar is ready to display notifications
    checkForUpdatesAndNotifyToolbar();
  });

  ipcMain.handle('get-keyboard-layouts', async () => {
    const layoutDir = path.join(__dirname, 'keyboard', 'layouts');
    try {
      const files = await fs.promises.readdir(layoutDir);
      return files.filter(file => file.endsWith('.js')).map(file => file.replace('.js', ''));
    } catch (error) {
      console.error(`FATAL: Could not read keyboard layouts from ${layoutDir}.`, error);
      return [];
    }
  });

  ipcMain.handle('get-keyboard-layout-data', async (event, layoutName) => {
    const requestedLayout = (layoutName || '').toLowerCase();
    if (!requestedLayout) { console.error('Request for invalid or empty layout name rejected.'); return null; }
    const layoutDir = path.join(__dirname, 'keyboard', 'layouts');
    try {
      const files = await fs.promises.readdir(layoutDir);
      const targetFile = files.find(file => path.basename(file, '.js').toLowerCase() === requestedLayout);
      if (!targetFile) { console.error(`Layout file not found for '${layoutName}' in directory ${layoutDir}`); return null; }
      const layoutPath = path.join(layoutDir, targetFile);
      const layoutData = require(layoutPath);
      delete require.cache[require.resolve(layoutPath)];
      return layoutData;
    } catch (error) {
      console.error(`FATAL: Could not load layout module for '${layoutName}'.`, error);
      return null;
    }
  });

  ipcMain.handle('get-settings', async () => {
    return {
      volume: getSetting('volume', 50),
      keyboardWidth: getSetting('keyboard.width', 100),
      keyHeight: getSetting('keyboard.keyHeight', 50),
      keyboardLayout: store.get('keyboard.layout', 'de'),
      toolbarHeight: getSetting('toolbar.height', 72),
      toolbarFontSize: getSetting('toolbar.fontSize', 24),
      enableExtension: store.get('enableExtension', false),
      tabs: store.get('tabs', [
        { name: 'Autodarts', url: 'https://play.autodarts.io/' },
        { name: 'Service', url: 'http://localhost:3180/' }
      ])
    };
  });

  ipcMain.on('save-settings', async (event, settings) => {
    const oldEnableExtension = store.get('enableExtension', false);

    store.set('volume', settings.volume);
    store.set('keyboard.width', settings.keyboardWidth);
    store.set('keyboard.keyHeight', settings.keyHeight);
    store.set('keyboard.layout', settings.keyboardLayout);
    store.set('toolbar.height', settings.toolbarHeight);
    store.set('toolbar.fontSize', settings.toolbarFontSize);
    store.set('tabs', settings.tabs);
    store.set('enableExtension', settings.enableExtension);

    if (oldEnableExtension !== settings.enableExtension) {
      if (settings.enableExtension) {
        if (!autodartsToolsExtensionId && fs.existsSync(EXTENSION_DIR)) {
          try {
            const extension = await session.defaultSession.loadExtension(EXTENSION_DIR, { allowFileAccess: true });
            autodartsToolsExtensionId = extension.id;
          } catch (error) {
            console.error('Failed to dynamically load extension:', error);
          }
        }
      } else {
        if (autodartsToolsExtensionId) {
          try {
            await session.defaultSession.removeExtension(autodartsToolsExtensionId);
            autodartsToolsExtensionId = null;
          } catch (error) {
            console.error('Failed to dynamically unload extension:', error);
          }
        }
      }
    }
    applySettings();
    setTimeout(async () => {
      await reloadDynamicViews();
      if (previousView && views[previousView]) showTab(previousView);
      else showTab(Object.keys(views).find(k => k.startsWith('tab')) || null);
      previousView = null;
      autoCloseEnabled = true;
    }, 100);
    hideKeyboardView();
  });

  ipcMain.on('set-cursor-visibility', (event, visible) => {
      const css = `* { cursor: ${visible ? 'default' : 'none'} !important; }`;
      const allViews = [...Object.values(views), toolbarView, settingsView, keyboardView, powerMenuView];
      allViews.forEach(view => {
          if (view && view.webContents && !view.webContents.isDestroyed()) {
              view.webContents.insertCSS(css).catch(e => console.error(`Failed to set cursor visibility for a view: ${e}`));
          }
      });
  });

  ipcMain.handle('get-tabs', async () => store.get('tabs', [ { name: 'Autodarts', url: 'https://play.autodarts.io/' }, { name: 'Service', url: 'http://localhost:3180/' } ]));
  ipcMain.handle('get-current-view', () => currentView);
  ipcMain.on('close-settings', () => {
    applySettings();
    if (previousView) showTab(previousView);
    hideKeyboardView();
    autoCloseEnabled = true;
  });

  ipcMain.on('update-keyboard-style-live', (event, style) => applyKeyboardStyle(style));
  ipcMain.on('update-toolbar-style-live', (event, style) => {
    applyToolbarStyle(style);
    showTab(currentView);
  });
  ipcMain.on('keyboard-height-changed', (event, height) => {
    if (height && height > 100) {
      if (keyboardActualHeight !== height) {
        keyboardActualHeight = height;
        if (keyboardVisible) {
          updateKeyboardBounds();
          updateMainViewBounds();
        }
      }
    } else {
      // Using a fallback height if the received height is invalid
      keyboardActualHeight = 250;
      if (keyboardVisible) {
        updateKeyboardBounds();
        updateMainViewBounds();
      }
    }
  });
  ipcMain.on('input-focused', (event, viewName) => {
    if (!keyboardVisible) {
      showKeyboardView();
    }
  });

  ipcMain.on('input-blurred', (event, viewName) => {
    if (keyboardVisible && autoCloseEnabled) {
      setTimeout(() => {
        if (keyboardVisible && autoCloseEnabled) {
          hideKeyboardView();
        }
      }, 300);
    }
  });

  ipcMain.on('webkeyboard-key', (ev, key) => {
    const targetView = (currentView === 'settings') ? settingsView : views[currentView];
    if (!targetView || !targetView.webContents || targetView.webContents.isDestroyed()) {
      console.error(`Cannot send key to invalid or destroyed view: ${currentView}`);
      return;
    }
    if (key === '{bksp}') {
      targetView.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
      targetView.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
    } else if (key === '{enter}') {
      targetView.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      targetView.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    } else if (key === '{space}' || key === ' ') {
      targetView.webContents.sendInputEvent({ type: 'char', keyCode: ' ' });
    } else if (key === '{tab}') {
      targetView.webContents.sendInputEvent({ type: 'keyDown',keyCode: 'Tab' });
      targetView.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    } else if (key === '{shift}' || key === '{capslock}') {
      shiftActive = !shiftActive;
    } else {
      targetView.webContents.sendInputEvent({ type: 'char', keyCode: key });
    }
  });

  ipcMain.on('keyboard-shift-status', (ev, isActive) => {
    shiftActive = isActive;
  });

  // Load extension on startup if enabled
  const enableExtension = store.get('enableExtension', false);
  if (enableExtension && fs.existsSync(EXTENSION_DIR)) {
    try {
      const extension = await session.defaultSession.loadExtension(EXTENSION_DIR, { allowFileAccess: true });
      autodartsToolsExtensionId = extension.id;
    } catch (error) {
      console.error('Failed to load Autodarts Tools extension on startup:', error);
    }
  }

  await createWindow();
});

app.on('window-all-closed', () => app.quit());

async function checkForUpdatesAndNotifyToolbar() {
  const isExtensionEnabled = store.get('enableExtension', false);

  if (!isExtensionEnabled) {
    return;
  }

  try {
    const installedVersion = getInstalledExtensionVersion();
    const latestInfo = await getLatestExtensionInfo();

    if (installedVersion && latestInfo && latestInfo.version) {
      if (semver.gt(latestInfo.version, installedVersion)) {
        if (toolbarView && toolbarView.webContents && !toolbarView.webContents.isDestroyed()) {
          toolbarView.webContents.send('update-available', 'Tools for Autodarts has a new update.');
        }
      }
    }
  } catch (error) {
    console.error('An error occurred during the startup update check:', error);
  }
}