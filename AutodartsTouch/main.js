const { app, BrowserWindow, BrowserView, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const { exec } = require('child_process');

const store = new Store();

let mainWindow;
let views = {};
let toolbarView;
let keyboardView;
let settingsView;
let powerMenuView;
let currentView = 'tab0'; // Default to the first tab
let previousView = null;

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
      loadingPromises.push(view.webContents.loadURL(tab.url).catch(e => console.error(`tab${index} load error:`, e)));
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

  return Promise.all(loadingPromises).catch(e => console.error('Error loading one or more dynamic views:', e));
}

async function reloadDynamicViews() {
  console.log('Reloading dynamic views...');
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
    console.log('Dynamic views finished loading.');
  } catch (error) {
    console.error('An error occurred during dynamic view reload:', error);
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

  console.log('Dynamic views reloaded successfully.');
}

function showTab(tab) {
  if (!mainWindow) return;
  const [w, h] = mainWindow.getSize();

  // Calculate available height for content
  const availableHeight = h - TOOLBAR_HEIGHT - (keyboardVisible ? keyboardActualHeight : 0);
  console.log(`Layout update - Window: ${w}x${h}, Available content height: ${availableHeight}, Keyboard visible: ${keyboardVisible}, Keyboard height: ${keyboardActualHeight}`);

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
      console.log(`Active view '${k}' resized to: width=${w}, height=${availableHeight}`);
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
    console.error('Error setting toolbar bounds:', e);
  }

  currentView = tab;
  if (keyboardVisible) updateKeyboardBounds();
}

function updateMainViewBounds() {
  if (!mainWindow) return;
  const [w, h] = mainWindow.getSize();

  // Determine the active view
  const activeView = (currentView === 'settings') ? settingsView : views[currentView];
  if (!activeView || !activeView.webContents || activeView.webContents.isDestroyed()) {
    console.error(`updateMainViewBounds: Cannot resize invalid or destroyed active view: ${currentView}`);
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
  console.log(`Optimized resize for '${currentView}': height=${availableHeight}`);
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
  
  console.log(`Keyboard positioned at: y=${h - keyboardActualHeight}, height=${keyboardActualHeight}`);
}

function showKeyboardView() {
  if (!keyboardVisible) {
    console.log('Showing keyboard view');
    
    if (keyboardView && keyboardView.webContents) {
      keyboardView.webContents.executeJavaScript('window.showKeyboard && window.showKeyboard()').catch(e => console.error('Failed to reset keyboard:', e));
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
    console.log('Hiding keyboard view');
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
  // This function is now a fallback. The primary method is the IPC listener below.
  if (keyboardView && keyboardView.webContents) {
    keyboardView.webContents.executeJavaScript('document.getElementById("keyboard")?.offsetHeight || 0')
    .then(height => {
      console.log(`Measured keyboard height via JS execution: ${height}px`);
      if (height > 100) { // Only accept reasonable heights
        if (keyboardActualHeight !== height) {
          console.log(`Updating keyboard height to ${height}px`);
          keyboardActualHeight = height;
          if (keyboardVisible) {
            updateKeyboardBounds();
            showTab(currentView);
          }
        }
      } else {
        console.warn(`Measured height (${height}px) is too small. Using fallback height.`);
        // If measurement is invalid, use a safe fallback but still update layout
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
  console.log('Toggle keyboard - currently visible:', keyboardVisible);
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
      console.error(`exec error: ${error}`);
      return;
    }
    console.log(`System volume set to ${volume}%`);
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
    console.error(`[Debug] Skipping focus injection for invalid/destroyed view: ${viewName}`);
    return;
  }

  // This script is injected into each webview to detect when an input is focused.
  const script = `
      (function() {
        if (window.keyboardFocusHandlersInstalled) {
          console.log('[FOCUS_DEBUG] Focus handlers already installed in ${viewName}.');
          return;
        }
        window.keyboardFocusHandlersInstalled = true;
        console.log('[FOCUS_DEBUG] Installing keyboard auto-focus handlers in ${viewName}.');

        function isInputElement(element) {
          if (!element) return false;
          const tagName = element.tagName ? element.tagName.toLowerCase() : '';
          const type = element.type ? element.type.toLowerCase() : '';
          const isContentEditable = element.contentEditable === 'true' || element.getAttribute('contenteditable') === 'true';
          return tagName === 'input' || tagName === 'textarea' || isContentEditable;
        }

        function notifyMainProcess(eventType) {
          console.log('[FOCUS_DEBUG] Renderer: Notifying main of "' + eventType + '" for view "' + '${viewName}' + '".');
          if (window.electronAPI && typeof window.electronAPI.inputFocused === 'function') {
            if (eventType === 'focus') {
              window.electronAPI.inputFocused('${viewName}');
            } else {
              window.electronAPI.inputBlurred('${viewName}');
            }
          } else {
            console.error('[FOCUS_DEBUG] electronAPI not available or methods are missing in ${viewName}.');
          }
        }

        function handleFocus(event) {
          if (isInputElement(event.target)) {
            console.log('[FOCUS_DEBUG] Input element focused in ${viewName}:', { tag: event.target.tagName, type: event.target.type });
            notifyMainProcess('focus');
          }
        }

        function handleBlur(event) {
          if (isInputElement(event.target)) {
            console.log('[FOCUS_DEBUG] Input element blurred in ${viewName}:', { tag: event.target.tagName, type: event.target.type });
            // Delay to check if focus moves to another input
            setTimeout(() => {
              if (!document.activeElement || !isInputElement(document.activeElement)) {
                console.log('[FOCUS_DEBUG] No new input focused. Sending blur event for ${viewName}.');
                notifyMainProcess('blur');
              }
            }, 100);
          }
        }

        document.addEventListener('focusin', handleFocus, true);
        document.addEventListener('focusout', handleBlur, true);
        console.log('[FOCUS_DEBUG] Auto-keyboard handlers installed successfully in ${viewName}.');
      })();
  `;

  const doInjection = () => {
      console.log(`[Debug] Attempting to inject focus script into ${viewName}.`);
      view.webContents.executeJavaScript(script).catch(err => {
          console.error(`[Debug] FAILED to inject focus script into ${viewName}:`, err);
      });
  };

  // Prevent race condition by checking if the view is already loaded.
  if (view.webContents.isLoading()) {
      view.webContents.once('dom-ready', doInjection);
  } else {
      doInjection();
  }
}

function setupAutoKeyboard() {
  console.log('[Debug] Setting up auto-keyboard for all views...');

  // Combine all views (tabs and static views) into one object to iterate over.
  const allViews = { ...views, settings: settingsView };

  Object.entries(allViews).forEach(([viewName, view]) => {
      if (!view || view.webContents.isDestroyed()) {
          console.log(`[Debug] Skipping setup for invalid or destroyed view: ${viewName}`);
          return;
      }

      injectFocusDetector(view, viewName);

      // Keep console message listener as a fallback, though it's not the primary method.
      view.webContents.on('console-message', (event, level, message) => {
          if (message.includes('KEYBOARD_EVENT:focus:')) {
              console.log(`?? Detected input focus via CONSOLE message from ${viewName}`);
              showKeyboardView();
          } else if (message.includes('KEYBOARD_EVENT:blur:')) {
              console.log(`?? Detected input blur via CONSOLE message from ${viewName}`);
              if (keyboardVisible && autoCloseEnabled) {
                  hideKeyboardView();
              }
          }
      });
  });
}

// IPC
ipcMain.on('open-settings', () => {
  if (currentView !== 'settings') {
    previousView = currentView;
    // Reload the settings page to ensure it has the latest data
    settingsView.webContents.reload();
    showTab('settings');
    showKeyboardView();
    autoCloseEnabled = false; // Disable auto-close while in settings
  }
});
ipcMain.on('switch-tab', (ev, tab) => {
  if (tab && views[tab]) {
    // When switching away from settings, hide keyboard and restore defaults
    if (currentView === 'settings' && tab !== 'settings') {
      applySettings(); // Restore non-live settings
      hideKeyboardView();
      autoCloseEnabled = true; // Re-enable auto-close
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
  // Prevent hiding the keyboard while in the settings view
  if (currentView === 'settings') {
    showKeyboardView();
    return;
  }
  toggleKeyboardView();
});

ipcMain.on('open-power-menu', () => {
    if (mainWindow && powerMenuView && !powerMenuView.webContents.isDestroyed()) {
        const [w, h] = mainWindow.getSize();
        // Set the bounds to cover the screen and bring it to the top.
        powerMenuView.setBounds({ x: 0, y: 0, width: w, height: h });
        mainWindow.setTopBrowserView(powerMenuView);
    }
});

ipcMain.on('close-power-menu', () => {
    if (mainWindow && powerMenuView && !powerMenuView.webContents.isDestroyed()) {
        const [w, h] = mainWindow.getSize();
        // Hide the power menu by moving it off-screen.
        powerMenuView.setBounds({ x: 0, y: h, width: w, height: h });
    }
});

ipcMain.on('power-control', (event, action) => {
  // Add a layer of security/confirmation if needed in a real-world scenario
  switch (action) {
    case 'shutdown':
      exec('shutdown -h now', (err) => {
        if (err) console.error('Shutdown command failed:', err);
      });
      break;
    case 'restart':
      exec('reboot', (err) => {
        if (err) console.error('Restart command failed:', err);
      });
      break;
    case 'close-app':
      app.quit();
      break;
  }
});

ipcMain.handle('get-keyboard-layouts', async () => {
  // In an Electron app, `__dirname` correctly points to the directory of the current file.
  // When packaged into an asar, this path allows fs to read directly from the archive.
  // This is the most reliable way to access bundled resources.
  const layoutDir = path.join(__dirname, 'keyboard', 'layouts');
  try {
    console.log(`Reading keyboard layouts from: ${layoutDir}`);
    const files = await fs.promises.readdir(layoutDir);
    return files
      .filter(file => file.endsWith('.js'))
      .map(file => file.replace('.js', ''));
  } catch (error) {
    console.error(`FATAL: Could not read keyboard layouts from ${layoutDir}.`, error);
    return [];
  }
});

ipcMain.handle('get-keyboard-layout-data', async (event, layoutName) => {
  const requestedLayout = (layoutName || '').toLowerCase();
  if (!requestedLayout) {
    console.error('Request for invalid or empty layout name rejected.');
    return null;
  }

  const layoutDir = path.join(__dirname, 'keyboard', 'layouts');

  try {
    const files = await fs.promises.readdir(layoutDir);
    const targetFile = files.find(file =>
      path.basename(file, '.js').toLowerCase() === requestedLayout
    );

    if (!targetFile) {
      console.error(`Layout file not found for '${layoutName}' in directory ${layoutDir}`);
      return null;
    }

    const layoutPath = path.join(layoutDir, targetFile);
    console.log(`Loading layout module from: ${layoutPath}`);
    // Load the layout as a Node.js module
    const layoutData = require(layoutPath);
    // Invalidate the cache to allow for potential live-reloading in the future
    delete require.cache[require.resolve(layoutPath)];
    return layoutData;
  } catch (error) {
    console.error(`FATAL: Could not load layout module for '${layoutName}'.`, error);
    return null;
  }
});

ipcMain.handle('get-settings', async () => {
  return {
    volume: store.get('volume', 50),
    keyboardWidth: store.get('keyboard.width', 100),
    keyHeight: store.get('keyboard.keyHeight', 50),
    keyboardLayout: store.get('keyboard.layout', 'de'),
    tabs: store.get('tabs', [
      { name: 'Autodarts', url: 'https://play.autodarts.io/' },
      { name: 'Service', url: 'http://localhost:3180/' }
    ])
  };
});

ipcMain.on('save-settings', async (event, settings) => {
  console.log('Saving settings...');
  store.set('volume', settings.volume);
  store.set('keyboard.width', settings.keyboardWidth);
  store.set('keyboard.keyHeight', settings.keyHeight);
  store.set('keyboard.layout', settings.keyboardLayout);
  store.set('tabs', settings.tabs);

  // Apply settings that don't require a reload
  applySettings();

  // Defer the reload to prevent the app from crashing.
  // This gives the settings view time to close before views are recreated.
  setTimeout(async () => {
    await reloadDynamicViews();

    // After the reload, switch back to the previous view or a fallback.
    if (previousView && views[previousView]) {
      showTab(previousView);
    } else {
      const firstTab = Object.keys(views).find(k => k.startsWith('tab'));
      showTab(firstTab || null);
    }
    previousView = null;
    autoCloseEnabled = true;
    console.log('Settings saved and dynamic views reloaded successfully.');
  }, 100); // A short delay is sufficient

  // Hide the keyboard and settings view immediately.
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

ipcMain.handle('get-tabs', async () => {
  return store.get('tabs', [
    { name: 'Autodarts', url: 'https://play.autodarts.io/' },
    { name: 'Service', url: 'http://localhost:3180/' }
  ]);
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
  // This is the primary method for updating keyboard height.
  // It's triggered by the renderer process once the keyboard is fully rendered.
  if (height && height > 100) { // Only accept reasonable heights
    if (keyboardActualHeight !== height) {
      console.log(`IPC: Keyboard height updated to ${height}px`);
      keyboardActualHeight = height;
      if (keyboardVisible) {
        updateKeyboardBounds();
        updateMainViewBounds(); // Optimized resize
      }
    }
  } else {
    console.warn(`IPC: Received invalid keyboard height: ${height}px. Using fallback.`);
    // If the received height is invalid, use a safe fallback.
    keyboardActualHeight = 250;
    if (keyboardVisible) {
      updateKeyboardBounds();
      updateMainViewBounds(); // Optimized resize
    }
  }
});

// Auto-focus keyboard handlers
ipcMain.on('input-focused', (event, viewName) => {
  console.log(`[FOCUS_DEBUG] Main process received 'input-focused' from view: ${viewName}.`);
  if (!keyboardVisible) {
    console.log('[FOCUS_DEBUG] Keyboard not visible, showing it now.');
    showKeyboardView();
  } else {
    console.log('[FOCUS_DEBUG] Keyboard already visible, not showing again.');
  }
});

ipcMain.on('input-blurred', (event, viewName) => {
  console.log(`[FOCUS_DEBUG] Main process received 'input-blurred' from view: ${viewName}.`);
  if (keyboardVisible && autoCloseEnabled) {
    console.log('[FOCUS_DEBUG] Keyboard is visible and auto-close is enabled. Hiding keyboard after delay.');
    setTimeout(() => {
      if (keyboardVisible && autoCloseEnabled) {
        console.log('[FOCUS_DEBUG] Auto-hiding keyboard now.');
        hideKeyboardView();
      }
    }, 300);
  } else {
    console.log('[FOCUS_DEBUG] Keyboard not visible or auto-close is disabled. Not hiding.');
  }
});

// receive key presses from keyboard page (via preload -> ipc)
ipcMain.on('webkeyboard-key', (ev, key) => {
  // Determine the target view for the keypress.
  // This is crucial for making the keyboard work in the settings page.
  const targetView = (currentView === 'settings') ? settingsView : views[currentView];

  if (!targetView || !targetView.webContents || targetView.webContents.isDestroyed()) {
    console.error(`Cannot send key to invalid or destroyed view: ${currentView}`);
    return;
  }

  console.log(`Sending key '${key}' to view '${currentView}'. Shift active: ${shiftActive}`);

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
    // Shift behavior is handled by the keyboard view itself.
    // We just note the status change.
    shiftActive = !shiftActive;
    console.log('Shift toggled to:', shiftActive);
  } else if (key === '{capslock}') {
    // CapsLock behavior
    shiftActive = !shiftActive;
    console.log('CapsLock toggled to:', shiftActive);
  } else {
    // Handle character input. The keyboard view should provide the correct case.
    let charToSend = key;
    
    // Handle special German characters just in case
    const specialChars = {
      '\u00E4': '\u00E4', '\u00F6': '\u00F6', '\u00FC': '\u00FC', '\u00DF': '\u00DF',
      '\u00C4': '\u00C4', '\u00D6': '\u00D6', '\u00DC': '\u00DC'
    };
    
    if (specialChars[key]) {
      charToSend = specialChars[key];
    }
    
    targetView.webContents.sendInputEvent({ type: 'char', keyCode: charToSend });
  }
});

// Receive shift status updates from keyboard
ipcMain.on('keyboard-shift-status', (ev, isActive) => {
  shiftActive = isActive;
  console.log('Shift status updated from keyboard:', shiftActive);
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());