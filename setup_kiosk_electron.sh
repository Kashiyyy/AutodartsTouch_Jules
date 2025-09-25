#!/bin/bash
set -euo pipefail

# ===============
# Vollständiges Setup-Skript
# - installiert Node (best-effort)
# - legt ~/kiosk-electron an
# - installiert express, simple-keyboard, electron
# - kopiert simple-keyboard-Assets lokal
# - erstellt main.js, preload.js, toolbar index.html, keyboard page (minimal), keyboard-server.js (optional), start_kiosk.sh
# - richtet Autostart (LXDE + .desktop + crontab) ein
# Hinweis: Als root / via sudo ausführen
# ===============

GUI_USER="${SUDO_USER:-$(logname)}"
HOME_DIR="$(eval echo "~$GUI_USER")"
APP_DIR="$HOME_DIR/kiosk-electron"
START_SCRIPT="$APP_DIR/start_kiosk.sh"
AUTOSTART_LXDIR="$HOME_DIR/.config/lxsession/LXDE-pi"
AUTOSTART_FILE="$AUTOSTART_LXDIR/autostart"
AUTOSTART_DESKTOP_DIR="$HOME_DIR/.config/autostart"
DESKTOP_FILE="$AUTOSTART_DESKTOP_DIR/kiosk-electron.desktop"

echo ">>> Setup startet für GUI-User: $GUI_USER"
echo ">>> Home: $HOME_DIR"
echo ">>> App-Ordner: $APP_DIR"
echo

# -------------------------
# 0) Basic system packages (best-effort)
# -------------------------
apt update
apt install -y curl build-essential jq dos2unix || true

# -------------------------
# 1) Node.js (best-effort)
# -------------------------
# remove older node versions (best-effort)
apt remove -y nodejs npm || true
apt purge -y nodejs npm || true
apt autoremove -y || true

# Install Node 20 LTS (Nodesource) - if available
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1 || true
apt install -y nodejs || true

echo ">>> Node: $(node -v 2>/dev/null || echo 'node missing')    npm: $(npm -v 2>/dev/null || echo 'npm missing')"

# -------------------------
# 2) Create project dir + npm init + install packages
# -------------------------
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"
chown -R "$GUI_USER:$GUI_USER" "$APP_DIR"

# initialize npm and install deps as GUI user
sudo -u "$GUI_USER" bash -c "cd '$APP_DIR' && npm init -y >/dev/null 2>&1"
# install runtime dependencies: express and simple-keyboard (for local assets)
sudo -u "$GUI_USER" bash -c "cd '$APP_DIR' && npm install --save express simple-keyboard >/dev/null 2>&1 || true"
# install electron as dev dependency (npx will use it)
sudo -u "$GUI_USER" bash -c "cd '$APP_DIR' && npm install --save-dev electron >/dev/null 2>&1 || true"

# ensure package.json has main + start script
if [ -f "$APP_DIR/package.json" ]; then
  sudo -u "$GUI_USER" bash -c "jq '.main=\"main.js\" | .scripts.start=\"electron .\"' '$APP_DIR/package.json' > '$APP_DIR/package.tmp' && mv '$APP_DIR/package.tmp' '$APP_DIR/package.json' || true"
fi

# -------------------------
# 3) main.js (Electron) - BrowserView + keyboard loadFile + IPC mapping
# -------------------------
cat > /tmp/main.js <<'MAIN'
const { app, BrowserWindow, BrowserView, ipcMain, screen } = require('electron');
const path = require('path');

let mainWindow;
let views = {};
let toolbarView;
let keyboardView;
let currentView = 'tab1';

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
  views.tab1 = new BrowserView({ webPreferences: { sandbox: false } });
  views.tab2 = new BrowserView({ webPreferences: { sandbox: false } });

  // primary content (tab1) and your original service (tab2)
  views.tab1.webContents.loadURL('https://play.autodarts.io/').catch(e => console.error('tab1 load', e));
  views.tab2.webContents.loadURL('http://localhost:3180/').catch(e => console.error('tab2 load', e));

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
  mainWindow.addBrowserView(toolbarView);

  showTab(currentView);

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
ipcMain.on('switch-tab', (ev, tab) => { if (tab && views[tab]) showTab(tab); });
ipcMain.on('refresh', () => { if (views[currentView]) views[currentView].webContents.reload(); });
ipcMain.on('toggle-webkeyboard', () => { toggleKeyboardView(); });

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
MAIN

mv /tmp/main.js "$APP_DIR/main.js"
chown "$GUI_USER:$GUI_USER" "$APP_DIR/main.js"
chmod 644 "$APP_DIR/main.js"

# -------------------------
# 4) preload.js - expose api.sendKey + tab/refresh/toggle
# -------------------------
cat > /tmp/preload.js <<'PRELOAD'
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
PRELOAD

mv /tmp/preload.js "$APP_DIR/preload.js"
chown "$GUI_USER:$GUI_USER" "$APP_DIR/preload.js"
chmod 644 "$APP_DIR/preload.js"

# -------------------------
# 5) Toolbar index.html (restored with tabs + VK toggle)
# -------------------------
cat > /tmp/index.html <<'HTML'
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Kiosk Toolbar</title>
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=Open+Sans&display=swap" rel="stylesheet">
<style>
html,body{margin:0;height:100%;background:transparent;font-family:'Open Sans',sans-serif}
#toolbar{
  position:fixed; top:0; left:0; right:0; height:72px;
  display:grid; grid-template-columns:80px 1fr 80px; align-items:center; padding:0 12px; z-index:99999;
  background-image:
    radial-gradient(50% 30% at 86% 0%, #313370e3, #40348600),
    radial-gradient(50% 70% at 70% 22%, #26599ae6, #40348600),
    radial-gradient(50% 70% at 112% 44%, #2c436cd9, #40348600),
    radial-gradient(90% 90% at -12% 89%, #0f2f50e0, #40348600),
    radial-gradient(50% 70% at -2% 53%, #34205fe3, #40348600),
    radial-gradient(50% 70% at 36% 22%, #403486d4, #40348600),
    radial-gradient(50% 40% at 66% 59%, #206fb9de 7%, #206fb900),
    radial-gradient(75% 75% at 50% 50%, #3662b9 1%, #2d285b);
  background-repeat:no-repeat;background-size:cover;
}
button{font-family:'Open Sans',sans-serif;font-size:20px;padding:0 12px;border:none;background:none;color:#fff;cursor:pointer}
button:hover{color:#e0e0e0}
#tabs{display:flex;justify-content:space-evenly;gap:16px;align-items:center;height:100%}
.sidebtn{width:56px;height:56px;background:transparent;color:#fff;font-size:24px;border:none;padding:0}
button[aria-selected="true"]::after{content:"";display:block;margin:2px auto 0 auto;width:66%;height:2px;background:#fff;border-radius:1px}
</style>
</head>
<body>
  <div id="toolbar" role="toolbar" aria-label="Kiosk Steuerung">
    <div style="display:flex;align-items:center;justify-content:center;">
      <button class="sidebtn" id="webVKBtn" aria-label="Web-Tastatur">&#x2328;</button>
    </div>

    <div id="tabs" role="tablist" aria-label="Seiten">
      <button onclick="switchTab('tab1')" role="tab" aria-selected="true" id="tab1btn">Seite 1</button>
      <button onclick="switchTab('tab2')" role="tab" aria-selected="false" id="tab2btn">Seite 2</button>
    </div>

    <div style="display:flex;align-items:center;justify-content:center;">
      <button class="sidebtn" onclick="api.refresh()" aria-label="Aktualisieren">&#x27F3;</button>
    </div>
  </div>

<script>
  const tabs = [document.getElementById('tab1btn'), document.getElementById('tab2btn')];
  function setActive(id){ tabs.forEach(t => t.setAttribute('aria-selected', t.id === id+'btn' ? 'true' : 'false')); }
  setActive('tab1');
  function switchTab(id){ setActive(id); if(window.api && window.api.switchTab) window.api.switchTab(id); }

  const webVKBtn = document.getElementById('webVKBtn');
  webVKBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); if(window.api && window.api.toggleWebKeyboard) window.api.toggleWebKeyboard(); });
  webVKBtn.addEventListener('click', (e) => e.preventDefault());
</script>
</body>
</html>
HTML

mv /tmp/index.html "$APP_DIR/index.html"
chown "$GUI_USER:$GUI_USER" "$APP_DIR/index.html"
chmod 644 "$APP_DIR/index.html"

# -------------------------
# 6) keyboard folder + minimal standard keyboard page (UNMODIFIED simple-keyboard)
# -------------------------
mkdir -p "$APP_DIR/keyboard"

# minimal index.html
cat > "$APP_DIR/keyboard/index.html" <<'KBD'
<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no" />
  <title>Deutsche Mobile Tastatur</title>
  <style>
    * {
      -webkit-tap-highlight-color: transparent;
      -webkit-touch-callout: none;
      -webkit-user-select: none;
      user-select: none;
    }
    
    body {
      margin: 0;
      padding: 0px 0px 0px 0px;
      background: #000000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #ffffff;
      overflow: hidden;
    }
    
    #keyboard {
      background: #1c1c1e;
      border-radius: 0px;
      padding: 8px;
      width: 100%;
      box-sizing: border-box;
    }
    
    .hg-row {
      display: flex;
      justify-content: center;
      margin-bottom: 6px;
      gap: 4px;
    }
    
    .hg-row:last-child {
      margin-bottom: 0;
    }
    
    .hg-button {
      background: #323234;
      color: #ffffff;
      border: none;
      border-radius: 8px;
      transition: all 0.1s ease;
      font-weight: 400;
      font-size: 18px;
      height: 46px;
      min-width: 32px;
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      touch-action: manipulation;
      font-family: inherit;
    }
    
    .hg-button[data-skbtn="{shift}"],
    .hg-button[data-skbtn="{bksp}"] {
      background: #525254;
      flex: 1.5;
      font-size: 16px;
    }
    
    .hg-button[data-skbtn="{space}"] {
      flex: 5;
      background: #323234;
      font-size: 14px;
    }
    
    .hg-button[data-skbtn="123"],
    .hg-button[data-skbtn="ABC"],
    .hg-button[data-skbtn="{symbols}"],
    .hg-button[data-skbtn="{numbers}"] {
      background: #525254;
      flex: 1.5;
      font-size: 14px;
    }
    
    .hg-button[data-skbtn="return"] {
      background: #0066cc;
      flex: 1.5;
      font-size: 14px;
      color: #ffffff;
    }
    
    .hg-button:active {
      background: #404042;
      transform: scale(0.95);
    }
    
    .hg-button.hg-activeButton {
      background: #0066cc;
      color: #ffffff;
      box-shadow: 0 0 10px rgba(0, 102, 204, 0.3);
    }
    
    .hg-button[data-skbtn="{shift}"]:active,
    .hg-button[data-skbtn="{bksp}"]:active,
    .hg-button[data-skbtn="123"]:active,
    .hg-button[data-skbtn="ABC"]:active {
      background: #606062;
    }
    
    .hg-button[data-skbtn="return"]:active {
      background: #0077dd;
    }
    
    /* Umlaut popup styling */
    .umlaut-popup {
      position: fixed;
      background: #48484a;
      border-radius: 8px;
      padding: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      z-index: 2000;
      display: flex;
      gap: 6px;
      border: 1px solid #5a5a5c;
      animation: popupAppear 0.15s ease-out;
      pointer-events: auto;
      outline: none;
    }
    
    .umlaut-popup::before {
      content: '';
      position: absolute;
      bottom: -6px;
      left: 50%;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 6px solid transparent;
      border-right: 6px solid transparent;
      border-top: 6px solid #48484a;
    }
    
    .umlaut-option {
      background: #323234;
      color: #ffffff;
      border: none;
      border-radius: 6px;
      width: 45px;
      height: 45px;
      font-size: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.1s ease;
      touch-action: manipulation;
      outline: none;
      font-family: inherit;
    }
    
    .umlaut-option:hover,
    .umlaut-option.selected {
      background: #0066cc;
      transform: scale(1.1);
      box-shadow: 0 2px 8px rgba(0, 102, 204, 0.3);
    }
    
    .umlaut-option:active {
      transform: scale(1.05);
      background: #0077dd;
    }
    
    @keyframes popupAppear {
      0% {
        opacity: 0;
        transform: scale(0.8) translateY(10px);
      }
      100% {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }
    
    /* Responsive adjustments */
    @media (max-width: 480px) {
      .hg-button {
        height: 42px;
        font-size: 16px;
        min-width: 28px;
      }
      
      .hg-row {
        gap: 3px;
        margin-bottom: 5px;
      }
    }
    
    @media (max-width: 360px) {
      .hg-button {
        height: 38px;
        font-size: 15px;
        min-width: 26px;
      }
      
      .hg-row {
        gap: 2px;
      }
    }
  </style>
</head>
<body>
  <div id="keyboard"></div>

  <script>
    let keyboardElement = document.getElementById('keyboard');
    let currentLayout = 'default';
    let shiftActive = false;
    let popupElement = null;
    let globalClickDisabled = false;
    
    // Keyboard layouts with Unicode characters
    const layouts = {
      default: [
        ['q', 'w', 'e', 'r', 't', 'z', 'u', 'i', 'o', 'p'],
        ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
        ['{shift}', 'y', 'x', 'c', 'v', 'b', 'n', 'm', '{bksp}'],
        ['123', ',', '{space}', '.', 'return']
      ],
      shift: [
        ['Q', 'W', 'E', 'R', 'T', 'Z', 'U', 'I', 'O', 'P'],
        ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
        ['{shift}', 'Y', 'X', 'C', 'V', 'B', 'N', 'M', '{bksp}'],
        ['123', ',', '{space}', '.', 'return']
      ],
      numbers: [
        ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
        ['\u002D', '\u002F', '\u003A', '\u003B', '\u0028', '\u0029', '\u20AC', '\u0026', '\u0040', '\u0022'],
        ['{symbols}', '.', ',', '\u003F', '\u0021', '\u0027', '\u00DF', '{bksp}'],
        ['ABC', '\u00E4', '{space}', '\u00F6', 'return']
      ],
      symbols: [
        ['\u005B', '\u005D', '\u007B', '\u007D', '\u0023', '\u0025', '\u005E', '\u002A', '\u002B', '\u003D'],
        ['\u005F', '\u005C', '\u007C', '\u007E', '\u003C', '\u003E', '\u0024', '\u00A3', '\u00A5', '\u2022'],
        ['{numbers}', '.', ',', '\u003F', '\u0021', '\u0027', '\u00FC', '{bksp}'],
        ['ABC', '\u00E4', '{space}', '\u00F6', 'return']
      ]
    };
    
    // Umlaut mappings for long press with Unicode
    const umlautMappings = {
      'a': ['\u00E4', '\u00E0', '\u00E1', '\u00E2', '\u00E3', '\u00E5'],
      'A': ['\u00C4', '\u00C0', '\u00C1', '\u00C2', '\u00C3', '\u00C5'],
      'o': ['\u00F6', '\u00F2', '\u00F3', '\u00F4', '\u00F5', '\u00F8'],
      'O': ['\u00D6', '\u00D2', '\u00D3', '\u00D4', '\u00D5', '\u00D8'],
      'u': ['\u00FC', '\u00F9', '\u00FA', '\u00FB', '\u0169'],
      'U': ['\u00DC', '\u00D9', '\u00DA', '\u00DB', '\u0168'],
      'e': ['\u00E9', '\u00E8', '\u00EA', '\u00EB', '\u0113'],
      'E': ['\u00C9', '\u00C8', '\u00CA', '\u00CB', '\u0112'],
      's': ['\u00DF', '\u0161', '\u015B'],
      'S': ['\u0160', '\u015A'],
      'n': ['\u00F1', '\u0144'],
      'N': ['\u00D1', '\u0143'],
      'c': ['\u00E7', '\u0107', '\u010D'],
      'C': ['\u00C7', '\u0106', '\u010C'],
      'i': ['\u00ED', '\u00EC', '\u00EE', '\u00EF', '\u012B'],
      'I': ['\u00CD', '\u00CC', '\u00CE', '\u00CF', '\u012A'],
      'y': ['\u00FD', '\u1EF3', '\u0177', '\u00FF'],
      'Y': ['\u00DD', '\u1EF2', '\u0176', '\u0178']
    };

    function createKeyboard() {
      function renderKeyboard() {
        keyboardElement.innerHTML = '';
        
        const layout = layouts[currentLayout] || layouts.default;
        
        layout.forEach((row) => {
          const rowDiv = document.createElement('div');
          rowDiv.className = 'hg-row';
          
          row.forEach(key => {
            const button = document.createElement('button');
            button.className = 'hg-button';
            button.setAttribute('data-skbtn', key);
            
            // Display text with Unicode for special characters
            let displayText = key;
            if (key === '{shift}') displayText = '\u21E7';
            else if (key === '{bksp}') displayText = '\u232B';
            else if (key === '{space}') displayText = '';
            else if (key === 'return') displayText = '\u21B5';
            else if (key === '{symbols}') displayText = '#+=';
            else if (key === '{numbers}') displayText = '123';
            
            button.textContent = displayText;
            
            // Visual feedback for shift
            if (key === '{shift}' && shiftActive) {
              button.classList.add('hg-activeButton');
            }
            
            // Setup button events
            setupButtonEvents(button, key);
            
            rowDiv.appendChild(button);
          });
          
          keyboardElement.appendChild(rowDiv);
        });
        
        // Report height after rendering
        setTimeout(() => {
          reportKeyboardHeight();
        }, 50);
      }

      function setupButtonEvents(button, key) {
        // Long press handlers (only for letters that have umlauts)
        if (umlautMappings[key] && !key.startsWith('{')) {
          let longPressTimer = null;
          let longPressTriggered = false;
          
          button.onmousedown = function(e) {
            longPressTriggered = false;
            longPressTimer = setTimeout(() => {
              longPressTriggered = true;
              showUmlautPopup(button, key);
              e.preventDefault();
              e.stopPropagation();
            }, 500);
          };
          
          button.onmouseup = function(e) {
            if (longPressTimer) {
              clearTimeout(longPressTimer);
              longPressTimer = null;
            }
            
            // If long press was triggered, check if mouse is over a umlaut option
            if (longPressTriggered && popupElement) {
              const elementUnderMouse = document.elementFromPoint(e.clientX, e.clientY);
              const umlautOption = elementUnderMouse?.closest('.umlaut-option');
              if (umlautOption) {
                const selectedUmlaut = umlautOption.textContent;
                e.preventDefault();
                e.stopPropagation();
                sendKey(selectedUmlaut);
                hideUmlautPopup();
                longPressTriggered = false;
                return false;
              }
              
              e.preventDefault();
              e.stopPropagation();
              return false;
            }
            
            if (longPressTriggered) {
              e.preventDefault();
              e.stopPropagation();
              longPressTriggered = false;
              return false;
            }
          };
          
          // Touch events
          button.ontouchstart = function(e) {
            longPressTriggered = false;
            longPressTimer = setTimeout(() => {
              longPressTriggered = true;
              showUmlautPopup(button, key);
              e.preventDefault();
              e.stopPropagation();
            }, 500);
          };
          
          button.ontouchend = function(e) {
            if (longPressTimer) {
              clearTimeout(longPressTimer);
              longPressTimer = null;
            }
            
            if (longPressTriggered && popupElement && e.changedTouches && e.changedTouches.length > 0) {
              const touch = e.changedTouches[0];
              const elementUnderTouch = document.elementFromPoint(touch.clientX, touch.clientY);
              const umlautOption = elementUnderTouch?.closest('.umlaut-option');
              if (umlautOption) {
                const selectedUmlaut = umlautOption.textContent;
                e.preventDefault();
                e.stopPropagation();
                sendKey(selectedUmlaut);
                hideUmlautPopup();
                longPressTriggered = false;
                return false;
              }
              
              e.preventDefault();
              e.stopPropagation();
              return false;
            }
            
            if (longPressTriggered) {
              e.preventDefault();
              e.stopPropagation();
              longPressTriggered = false;
              return false;
            }
          };
          
          // Override the normal click when long press is active
          button.onclick = function(e) {
            if (longPressTriggered) {
              longPressTriggered = false;
              e.preventDefault();
              e.stopPropagation();
              return false;
            } else {
              handleKeyPress(key);
            }
          };
        } else {
          // Normal buttons without umlauts
          button.onclick = function(e) {
            handleKeyPress(key);
          };
        }
      }

      function handleKeyPress(key) {
        if (key === '{shift}') {
          shiftActive = !shiftActive;
          currentLayout = shiftActive ? 'shift' : 'default';
          renderKeyboard();
          sendKey('{shift}');
        }
        else if (key === '123') {
          currentLayout = 'numbers';
          shiftActive = false;
          renderKeyboard();
        }
        else if (key === 'ABC') {
          currentLayout = shiftActive ? 'shift' : 'default';
          renderKeyboard();
        }
        else if (key === '{symbols}') {
          currentLayout = 'symbols';
          renderKeyboard();
        }
        else if (key === '{numbers}') {
          currentLayout = 'numbers';
          renderKeyboard();
        }
        else if (key === 'return') {
          sendKey('{enter}');
        }
        else if (key === '{space}') {
          sendKey(' ');
        }
        else if (key === '{bksp}') {
          sendKey('{bksp}');
        }
        else {
          sendKey(key);
          
          // Auto-reset shift after character (mobile behavior)
          if (shiftActive && currentLayout === 'shift') {
            shiftActive = false;
            currentLayout = 'default';
            setTimeout(() => {
              renderKeyboard();
            }, 100);
          }
        }
      }

      // Initial render
      renderKeyboard();
      return { handleKeyPress, renderKeyboard };
    }

    function showUmlautPopup(button, character) {
      const umlauts = umlautMappings[character];
      if (!umlauts || umlauts.length === 0) return;
      
      hideUmlautPopup();
      
      popupElement = document.createElement('div');
      popupElement.className = 'umlaut-popup';
      
      umlauts.forEach(umlaut => {
        const option = document.createElement('button');
        option.className = 'umlaut-option';
        option.textContent = umlaut;
        option.setAttribute('data-umlaut', umlaut);
        
        option.onclick = function(e) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          sendKey(umlaut);
          hideUmlautPopup();
          return false;
        };
        
        option.onmousedown = function(e) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          sendKey(umlaut);
          hideUmlautPopup();
          return false;
        };
        
        option.ontouchend = function(e) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          sendKey(umlaut);
          hideUmlautPopup();
          return false;
        };
        
        popupElement.appendChild(option);
      });
      
      // Prevent popup itself from closing
      popupElement.onclick = function(e) {
        e.stopPropagation();
        return false;
      };
      
      // Position popup
      document.body.appendChild(popupElement);
      
      const buttonRect = button.getBoundingClientRect();
      const popupRect = popupElement.getBoundingClientRect();
      
      const left = buttonRect.left + (buttonRect.width / 2) - (popupRect.width / 2);
      const top = buttonRect.top - popupRect.height - 12;
      
      popupElement.style.left = Math.max(8, Math.min(left, window.innerWidth - popupRect.width - 8)) + 'px';
      popupElement.style.top = Math.max(8, top) + 'px';
      
      // Disable global click handler temporarily to prevent immediate closing
      globalClickDisabled = true;
      
      setTimeout(() => {
        globalClickDisabled = false;
      }, 200);
      
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    }

    function hideUmlautPopup() {
      if (popupElement) {
        popupElement.remove();
        popupElement = null;
      }
      globalClickDisabled = false;
    }

    function sendKey(key) {
      if (window.api && window.api.sendKey) {
        try {
          window.api.sendKey(key);
        } catch (e) {
          console.error('Error sending key:', e);
        }
      }
    }

    function reportKeyboardHeight() {
      // Measure and report keyboard height to main process
      const keyboardEl = document.getElementById('keyboard');
      
      if (keyboardEl && window.api && window.api.reportKeyboardHeight) {
        // Force layout reflow
        keyboardEl.offsetHeight;
        
        // Get the pure element height
        const elementHeight = keyboardEl.offsetHeight;
        
        // Send the pure element height
        window.api.reportKeyboardHeight(elementHeight);
      }
    }

    function resetKeyboardToDefault() {
      // Always reset to default layout when keyboard is shown
      currentLayout = 'default';
      shiftActive = false;
      console.log('Keyboard reset to default layout');
    }

    // Global event handlers for drag-and-drop support
    document.onmouseup = function(e) {
      if (popupElement) {
        const elementUnderMouse = document.elementFromPoint(e.clientX, e.clientY);
        const umlautOption = elementUnderMouse?.closest('.umlaut-option');
        if (umlautOption) {
          const selectedUmlaut = umlautOption.textContent;
          e.preventDefault();
          e.stopPropagation();
          sendKey(selectedUmlaut);
          hideUmlautPopup();
          return false;
        }
      }
    };

    document.ontouchend = function(e) {
      if (popupElement && e.changedTouches && e.changedTouches.length > 0) {
        const touch = e.changedTouches[0];
        const elementUnderTouch = document.elementFromPoint(touch.clientX, touch.clientY);
        const umlautOption = elementUnderTouch?.closest('.umlaut-option');
        if (umlautOption) {
          const selectedUmlaut = umlautOption.textContent;
          e.preventDefault();
          e.stopPropagation();
          sendKey(selectedUmlaut);
          hideUmlautPopup();
          return false;
        }
      }
    };

    // Close popup when clicking outside
    document.onclick = function(e) {
      if (globalClickDisabled) return;
      
      if (popupElement) {
        const isPopupClick = e.target.closest('.umlaut-popup');
        const isUmlautOption = e.target.classList.contains('umlaut-option');
        
        if (!isPopupClick && !isUmlautOption) {
          hideUmlautPopup();
        }
      }
    };

    // Initialize
    const keyboardInstance = createKeyboard();
    
    // Report initial height
    setTimeout(() => {
      reportKeyboardHeight();
    }, 100);
    
    // Report height on window resize
    window.addEventListener('resize', () => {
      setTimeout(reportKeyboardHeight, 100);
    });
    
    // Global functions for main process
    window.updateKeyboardLayout = () => {
      if (keyboardInstance) {
        keyboardInstance.renderKeyboard();
      }
    };

    window.resetKeyboard = () => {
      resetKeyboardToDefault();
      if (keyboardInstance) {
        keyboardInstance.renderKeyboard();
      }
    };

    window.showKeyboard = () => {
      resetKeyboardToDefault();
      if (keyboardInstance) {
        keyboardInstance.renderKeyboard();
      }
      // Report height after reset
      setTimeout(reportKeyboardHeight, 50);
    };

    // Cleanup
    window.addEventListener('blur', hideUmlautPopup);
    window.addEventListener('resize', hideUmlautPopup);
  </script>
</body>
</html>
KBD

# Versuch lokale Assets zu kopieren
sudo -u "$GUI_USER" bash -c "cd '$APP_DIR' && \
cp -v node_modules/simple-keyboard/build/index.js keyboard/simple-keyboard.js 2>/dev/null || cp -v node_modules/simple-keyboard/dist/index.js keyboard/simple-keyboard.js 2>/dev/null || true"
sudo -u "$GUI_USER" bash -c "cd '$APP_DIR' && \
cp -v node_modules/simple-keyboard/build/css/index.css keyboard/simple-keyboard.css 2>/dev/null || cp -v node_modules/simple-keyboard/dist/index.css keyboard/simple-keyboard.css 2>/dev/null || true"

# ownership setzen
chown -R "$GUI_USER:$GUI_USER" "$APP_DIR/keyboard"


# -------------------------
# 7) keyboard-server.js (optional small express server to serve keyboard)
# -------------------------
cat > "$APP_DIR/keyboard-server.js" <<'SRV'
const express = require("express");
const path = require("path");
const app = express();
const PORT = 4000;
app.use(express.static(path.join(__dirname, "keyboard")));
app.listen(PORT, () => console.log(`Keyboard server running on http://localhost:${PORT}`));
SRV

chown "$GUI_USER:$GUI_USER" "$APP_DIR/keyboard-server.js"

# -------------------------
# 8) start_kiosk.sh - starts keyboard-server (background) then electron
# -------------------------
cat > /tmp/start_kiosk.sh <<'SH'
#!/bin/bash
set -euo pipefail

export DISPLAY=:0
export XAUTHORITY="$HOME/.Xauthority"

cd "$HOME/kiosk-electron" || exit 1

# Start keyboard server in background (optional, keyboard page already loads via file://)
node keyboard-server.js &>/dev/null &

# Start electron as GUI user (npx uses local node_modules)
exec /usr/bin/env npx electron . --disable-gpu --no-sandbox
SH

mv /tmp/start_kiosk.sh "$START_SCRIPT"
chown "$GUI_USER:$GUI_USER" "$START_SCRIPT"
chmod 755 "$START_SCRIPT"

# -------------------------
# 9) Autostart (LXDE + .desktop + crontab)
# -------------------------
mkdir -p "$AUTOSTART_LXDIR"
echo "@bash $START_SCRIPT" > "$AUTOSTART_FILE"
chown "$GUI_USER:$GUI_USER" "$AUTOSTART_FILE"
chmod 644 "$AUTOSTART_FILE"

mkdir -p "$AUTOSTART_DESKTOP_DIR"
cat > "$DESKTOP_FILE" <<DESK
[Desktop Entry]
Type=Application
Name=KioskElectron
Exec=bash $START_SCRIPT
Terminal=false
X-GNOME-Autostart-enabled=true
DESK
chown "$GUI_USER:$GUI_USER" "$DESKTOP_FILE"
chmod 644 "$DESKTOP_FILE"

CRON_LINE="@reboot bash $START_SCRIPT"
EXISTING_CRON="$(crontab -u "$GUI_USER" -l 2>/dev/null || true)"
if echo "$EXISTING_CRON" | grep -Fxq "$CRON_LINE"; then
  echo "Crontab entry already exists"
else
  ( printf "%s\n" "$EXISTING_CRON" | sed '/^\s*$/d' ; echo "$CRON_LINE" ) | crontab -u "$GUI_USER" -
  echo "Crontab @reboot set for $GUI_USER"
fi

# -------------------------
# 10) Final ownership / perms
# -------------------------
chown -R "$GUI_USER:$GUI_USER" "$APP_DIR"
chmod -R u+rwX,go+rX,go-w "$APP_DIR"

echo
echo ">>> Setup abgeschlossen!"
echo "Test (als GUI-User):"
echo "  cd $APP_DIR"
echo "  node keyboard-server.js &    # optional"
echo "  /usr/bin/env npx electron ."
echo
echo "Tipps:"
echo " - Keyboard local page: file://$APP_DIR/keyboard/index.html  (oder http://localhost:4000 if server started)"
echo " - In the app: switch to Tab2 (your original site), focus input, click toolbar ? to toggle web keyboard and type."
echo
echo "If the keyboard looks wrong inside Electron but OK in a normal browser, start Electron from terminal to see logs:"
echo "  sudo -u $GUI_USER bash -c 'cd $APP_DIR && /usr/bin/env npx electron .'"
echo
