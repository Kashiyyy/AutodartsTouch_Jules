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
  settingsView = new BrowserView({ webPreferences: { sandbox: false, preload: path.join(__dirname, 'preload.js') } });
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
      const view = new BrowserView({ webPreferences: { sandbox: false, preload: path.join(__dirname, 'preload.js') } });
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

  if (keyboardView && keyboardView.webContents) {
    const sendStyle = () => {
      keyboardView.webContents.send('update-keyboard-style', {
        width: keyboardWidth,
        keyHeight: keyHeight
      });
    };
    if (keyboardView.webContents.isLoading()) {
      keyboardView.webContents.once('dom-ready', sendStyle);
    } else {
      sendStyle();
    }
  }
}

function setupAutoKeyboard() {
  console.log('Setting up auto-keyboard functionality...');
  
  // Add focus detection to all webviews
  Object.keys(views).forEach(viewName => {
    const view = views[viewName];
    if (!view || !view.webContents) return;
    
    console.log(`Installing focus detection for view: ${viewName}`);
    
    // Listen to DOM events directly from webContents
    view.webContents.on('dom-ready', () => {
      console.log(`DOM ready for ${viewName}, installing focus handlers`);
      
      view.webContents.executeJavaScript(`
        (function() {
          // Remove existing listeners to prevent duplicates
          if (window.keyboardFocusHandlersInstalled) {
            console.log('Focus handlers already installed');
            return;
          }
          window.keyboardFocusHandlersInstalled = true;
          
          console.log('Installing keyboard auto-focus handlers');
          
          function isInputElement(element) {
            if (!element) return false;
            
            const tagName = element.tagName ? element.tagName.toLowerCase() : '';
            const type = element.type ? element.type.toLowerCase() : '';
            const contentEditable = element.contentEditable;
            
            return (
              tagName === 'input' ||
              tagName === 'textarea' ||
              contentEditable === 'true' ||
              contentEditable === true ||
              element.getAttribute('contenteditable') === 'true' ||
              element.hasAttribute('contenteditable')
            );
          }
          
          function notifyMainProcess(eventType, elementInfo) {
            // Try multiple ways to send the message
            console.log('Trying to notify main process:', eventType, elementInfo);
            
            // Method 1: ipcRenderer (if available)
            try {
              if (window.electronAPI) {
                if (eventType === 'focus') {
                  window.electronAPI.inputFocused();
                  console.log('? Sent via electronAPI.inputFocused');
                  return;
                } else {
                  window.electronAPI.inputBlurred();
                  console.log('? Sent via electronAPI.inputBlurred');
                  return;
                }
              }
            } catch (e) {
              console.log('? electronAPI failed:', e);
            }
            
            // Method 2: Try to use postMessage
            try {
              window.postMessage({
                type: 'keyboard-event',
                event: eventType,
                element: elementInfo
              }, '*');
              console.log('? Sent via postMessage');
            } catch (e) {
              console.log('? postMessage failed:', e);
            }
            
            // Method 3: Try console message (we can listen for this)
            console.log('KEYBOARD_EVENT:' + eventType + ':' + JSON.stringify(elementInfo));
          }
          
          function handleFocus(event) {
            const target = event.target;
            if (isInputElement(target)) {
              const elementInfo = {
                tagName: target.tagName,
                type: target.type || 'no-type',
                id: target.id || 'no-id',
                className: target.className || 'no-class'
              };
              
              console.log('?? Input element focused:', elementInfo);
              notifyMainProcess('focus', elementInfo);
            }
          }
          
          function handleBlur(event) {
            const target = event.target;
            if (isInputElement(target)) {
              const elementInfo = {
                tagName: target.tagName,
                type: target.type || 'no-type'
              };
              
              console.log('?? Input element blurred:', elementInfo);
              
              // Check if another input is getting focus after a short delay
              setTimeout(() => {
                const activeElement = document.activeElement;
                const bodyElement = document.body;
                
                console.log('?? Checking active element after blur:', {
                  activeTag: activeElement ? activeElement.tagName : 'null',
                  activeType: activeElement ? activeElement.type : 'null',
                  isInput: activeElement ? isInputElement(activeElement) : false,
                  isBody: activeElement === bodyElement
                });
                
                if (!activeElement || activeElement === bodyElement || !isInputElement(activeElement)) {
                  console.log('? No input focused anymore, sending blur event');
                  notifyMainProcess('blur', elementInfo);
                } else {
                  console.log('??  Another input is focused, keeping keyboard open');
                }
              }, 100);
            }
          }
          
          // Add event listeners with capture to catch all events
          document.addEventListener('focusin', handleFocus, true);
          document.addEventListener('focusout', handleBlur, true);
          
          // Also try click events on inputs as backup
          document.addEventListener('click', function(event) {
            const target = event.target;
            if (isInputElement(target)) {
              console.log('??? Input clicked, triggering focus');
              setTimeout(() => handleFocus(event), 10);
            }
          }, true);
          
          console.log('? Auto-keyboard handlers installed successfully');
          
          // Test the notification system
          setTimeout(() => {
            console.log('?? Testing notification system...');
            notifyMainProcess('test', {test: true});
          }, 1000);
        })();
      `).catch(e => {
        console.error(`Failed to inject focus detection for ${viewName}:`, e);
      });
    });
    
    // Listen for console messages from the webview
    view.webContents.on('console-message', (event, level, message, line, sourceId) => {
      if (message.includes('KEYBOARD_EVENT:focus:')) {
        console.log('?? Detected input focus via console message');
        showKeyboardView();
      } else if (message.includes('KEYBOARD_EVENT:blur:')) {
        console.log('?? Detected input blur via console message');
        // Auto-hide keyboard
        if (keyboardVisible) {
          setTimeout(() => {
            console.log('Auto-hiding keyboard after blur detection');
            hideKeyboardView();
          }, 300);
        }
      } else if (message.includes('Input element focused:')) {
        console.log('?? Detected input focus via log message');
        showKeyboardView();
      } else if (message.includes('No input focused anymore')) {
        console.log('?? Detected complete input blur via log message');
        if (keyboardVisible) {
          setTimeout(() => {
            console.log('Auto-hiding keyboard after complete blur');
            hideKeyboardView();
          }, 300);
        }
      } else if (message.includes('Testing notification system')) {
        console.log('?? Notification system test received from', viewName);
      }
    });
    
    console.log(`? Auto-keyboard setup completed for view: ${viewName}`);
  });
}

// IPC
ipcMain.on('open-settings', () => {
  if (currentView !== 'settings') {
    previousView = currentView;
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
  const safeLayoutName = (layoutName || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeLayoutName) {
    console.error('Request for invalid or empty layout name rejected.');
    return null;
  }

  // This is the direct and most reliable path to the resource inside the application.
  const layoutPath = path.join(__dirname, 'keyboard', 'layouts', `${safeLayoutName}.js`);
  try {
    console.log(`Reading layout file from: ${layoutPath}`);
    return await fs.promises.readFile(layoutPath, 'utf-8');
  } catch (error) {
    console.error(`FATAL: Could not read layout file from ${layoutPath}.`, error);
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
        showTab(currentView);
      }
    }
  } else {
    console.warn(`IPC: Received invalid keyboard height: ${height}px. Using fallback.`);
    // If the received height is invalid, use a safe fallback.
    keyboardActualHeight = 250;
    if (keyboardVisible) {
      updateKeyboardBounds();
      showTab(currentView);
    }
  }
});

// Auto-focus keyboard handlers
ipcMain.on('input-focused', () => {
  console.log('Input focused - auto-showing keyboard');
  if (!keyboardVisible) {
    showKeyboardView();
  }
});

ipcMain.on('input-blurred', () => {
  console.log('Input blurred - auto-hiding keyboard');
  // Auto-hide keyboard when input loses focus (if enabled)
  if (keyboardVisible && autoCloseEnabled) {
    setTimeout(() => {
      // Double-check if keyboard is still visible and no manual toggle happened
      if (keyboardVisible && autoCloseEnabled) {
        console.log('Auto-hiding keyboard after input blur');
        hideKeyboardView();
      }
    }, 300); // Small delay to prevent flicker when switching between inputs
  }
});

// receive key presses from keyboard page (via preload -> ipc)
ipcMain.on('webkeyboard-key', (ev, key) => {
  const view = views[currentView];
  if (!view || !view.webContents) return;

  console.log('Mobile key pressed:', key, 'Shift active:', shiftActive);

  if (key === '{bksp}') {
    view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
    view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
  } else if (key === '{enter}') {
    view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  } else if (key === '{space}' || key === ' ') {
    view.webContents.sendInputEvent({ type: 'char', keyCode: ' ' });
  } else if (key === '{tab}') {
    view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
  } else if (key === '{shift}') {
    // Mobile shift behavior - just toggle, keyboard handles the layout
    shiftActive = !shiftActive;
    console.log('Mobile shift toggled to:', shiftActive);
  } else if (key === '{capslock}') {
    // CapsLock behavior
    shiftActive = !shiftActive;
    console.log('Mobile CapsLock toggled to:', shiftActive);
  } else {
    // Handle character input - mobile keyboard already sends correct case
    let charToSend = key;
    
    // Mobile keyboard handles most case conversion, but handle special German characters
  const specialChars = {
    '\u00E4': '\u00E4',
    '\u00F6': '\u00F6',
    '\u00FC': '\u00FC',
    '\u00DF': '\u00DF',
    '\u00C4': '\u00C4',
    '\u00D6': '\u00D6', 
    '\u00DC': '\u00DC'  
  };
    
    if (specialChars[key]) {
      charToSend = specialChars[key];
    }
    
    view.webContents.sendInputEvent({ type: 'char', keyCode: charToSend });
  }
});

// Receive shift status updates from keyboard
ipcMain.on('keyboard-shift-status', (ev, isActive) => {
  shiftActive = isActive;
  console.log('Shift status updated from keyboard:', shiftActive);
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());