const { app, BrowserWindow, BrowserView, ipcMain, screen } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { exec } = require('child_process');

const store = new Store();

let mainWindow;
let views = {};
let toolbarView;
let keyboardView;
let settingsView;
let currentView = 'tab1';
let previousView = null;

const TOOLBAR_HEIGHT = 72;
const KEYBOARD_HEIGHT = 300;
let keyboardVisible = false;
let shiftActive = false;
let keyboardActualHeight = 300; // Dynamic keyboard height
let autoCloseEnabled = true; // Option to disable auto-close

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

  // Content BrowserViews
  views.tab1 = new BrowserView({ webPreferences: { sandbox: false, preload: path.join(__dirname, 'preload.js') } });
  views.tab2 = new BrowserView({ webPreferences: { sandbox: false, preload: path.join(__dirname, 'preload.js') } });
  settingsView = new BrowserView({ webPreferences: { sandbox: false, preload: path.join(__dirname, 'preload.js') } });

  // primary content (tab1) and your original service (tab2)
  views.tab1.webContents.loadURL('https://play.autodarts.io/').catch(e => console.error('tab1 load', e));
  views.tab2.webContents.loadURL('http://localhost:3180/').catch(e => console.error('tab2 load', e));
  settingsView.webContents.loadFile(path.join(__dirname, 'settings.html')).catch(e => console.error('settings load', e));

  // Toolbar view
  toolbarView = new BrowserView({
    webPreferences: { contextIsolation: true, sandbox: false, preload: path.join(__dirname, 'preload.js') }
  });
  toolbarView.webContents.loadFile(path.join(__dirname, 'index.html')).catch(e => console.error('toolbar load', e));

  // Keyboard view - load the local keyboard page (file://)
  keyboardView = new BrowserView({
    webPreferences: { contextIsolation: true, sandbox: false, preload: path.join(__dirname, 'preload.js') }
  });
  keyboardView.webContents.loadFile(path.join(__dirname, 'keyboard', 'index.html')).catch(e => console.error('keyboard load', e));

  // Add main content and toolbar (keyboard not added yet)
  mainWindow.addBrowserView(views.tab1);
  mainWindow.addBrowserView(views.tab2);
  mainWindow.addBrowserView(settingsView);
  mainWindow.addBrowserView(toolbarView);

  showTab(currentView);

  applySettings();

  // Setup auto-keyboard after views are ready
  setTimeout(() => {
    setupAutoKeyboard();
  }, 1000);
  
  // Additional setup for localhost (might need more time to load)
  setTimeout(() => {
    console.log('Re-running auto-keyboard setup for localhost pages...');
    setupAutoKeyboard();
  }, 3000);

  mainWindow.on('resize', () => {
    showTab(currentView);
    if (keyboardVisible) updateKeyboardBounds();
  });
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
    
    // Reset keyboard to default state
    if (keyboardView && keyboardView.webContents) {
      keyboardView.webContents.executeJavaScript(`
        if (window.showKeyboard) {
          window.showKeyboard();
        }
      `).catch(e => console.error('Failed to reset keyboard:', e));
    }
    
    mainWindow.addBrowserView(keyboardView);
    keyboardVisible = true;
    
    // Apply custom styles
    applyKeyboardStyle();

    // Initial layout with default height
    showTab(currentView);
    updateKeyboardBounds();
    
    // Measure actual height after a delay to ensure DOM is ready
    setTimeout(() => {
      measureKeyboardHeight();
    }, 100);
  }
}

function hideKeyboardView() {
  if (keyboardVisible) {
    console.log('Hiding keyboard view');
    try { 
      mainWindow.removeBrowserView(keyboardView); 
    } catch(e) {
      console.error('Error removing keyboard view:', e);
    }
    keyboardVisible = false;
    
    // Update layout without keyboard
    showTab(currentView);
  }
}

function measureKeyboardHeight() {
  // Try to get the actual keyboard height from the DOM
  if (keyboardView && keyboardView.webContents) {
    keyboardView.webContents.executeJavaScript(`
      (function() {
        const keyboardElement = document.getElementById('keyboard');
        if (keyboardElement) {
          // Force a layout reflow
          keyboardElement.offsetHeight;
          
          // Get the pure element height - this is what we actually need
          const elementHeight = keyboardElement.offsetHeight;
          
          console.log('Keyboard measurements:');
          console.log('- Pure element height:', elementHeight, '<-- This is what we need');
          console.log('- Window height:', window.innerHeight);
          console.log('- Body height:', document.body.offsetHeight);
          
          return {
            height: elementHeight, // Use pure element height
            elementHeight: elementHeight,
            windowHeight: window.innerHeight,
            bodyHeight: document.body.offsetHeight
          };
        }
        return { height: 300, elementHeight: 0, windowHeight: 0, bodyHeight: 0 };
      })();
    `).then(result => {
      console.log('Keyboard measurement result:', result);
      
      if (result && result.elementHeight > 0) {
        // Use the pure element height directly
        const newHeight = result.elementHeight;
        console.log(`Setting keyboard height to pure element height: ${newHeight}px (was ${keyboardActualHeight}px)`);
        keyboardActualHeight = newHeight;
        
        // Immediately update layout
        if (keyboardVisible) {
          updateKeyboardBounds();
          showTab(currentView);
        }
      }
    }).catch(e => {
      console.error('Failed to measure keyboard height:', e);
      // Fallback to a reasonable default
      keyboardActualHeight = 220;
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
ipcMain.on('toggle-webkeyboard', () => {
  // Prevent hiding the keyboard while in the settings view
  if (currentView === 'settings') {
    showKeyboardView();
    return;
  }
  toggleKeyboardView();
});

ipcMain.handle('get-settings', async () => {
  return {
    volume: store.get('volume', 50),
    keyboardWidth: store.get('keyboard.width', 100),
    keyHeight: store.get('keyboard.keyHeight', 50)
  };
});

ipcMain.on('save-settings', (event, settings) => {
  store.set('volume', settings.volume);
  store.set('keyboard.width', settings.keyboardWidth);
  store.set('keyboard.keyHeight', settings.keyHeight);

  applySettings(); // Apply and save the settings

  if (previousView) {
    showTab(previousView);
  }
  hideKeyboardView();
  autoCloseEnabled = true;
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

// Keyboard height update from keyboard view
ipcMain.on('keyboard-height-changed', (ev, height) => {
  if (height && height > 0) {
    console.log(`Keyboard height update via IPC: ${height}px (was ${keyboardActualHeight}px)`);
    keyboardActualHeight = height;
    
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
      'ä': 'ä', 'ö': 'ö', 'ü': 'ü', 'ß': 'ß',
      'Ä': 'Ä', 'Ö': 'Ö', 'Ü': 'Ü'
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