'use strict';

const {
  app, BrowserWindow, Tray, Menu, nativeImage,
  ipcMain, Notification, shell, nativeTheme, clipboard, session, dialog
} = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

let mainWindow = null;
let tray       = null;
let isQuitting = false;
let settings   = {};
let clearingCache = false;

// Optimization and Linux desktop runtime switches
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer,VaapiVideoDecoder');
  app.commandLine.appendSwitch('disable-features', 'OptimizationHints,Translate');
  app.commandLine.appendSwitch('disable-site-isolation-trials');
}

const { cleanCache, sanitizeSettings, safeExternal } = require('./safety');

async function clearCache(parentWindow = null, notifyOnSuccess = false) {
  if (clearingCache) return { error: 'Cache cleanup is already running.' };

  // Only bind modal to parent if parent window is actually visible and restored
  const parent = (parentWindow && typeof parentWindow.isVisible === 'function' && parentWindow.isVisible() && !parentWindow.isMinimized())
    ? parentWindow
    : null;

  const answer = await dialog.showMessageBox(parent, {
    type: 'question',
    buttons: ['Cancel', 'Clear cache'],
    defaultId: 1,
    cancelId: 0,
    title: 'Clear Cache - WhatsApp',
    message: 'Clear temporary browser cache?',
    detail: 'Your login, chats, cookies, and settings will be preserved. Avoid clearing cache during an active call.'
  });

  if (answer.response !== 1) return { cancelled: true };
  clearingCache = true;
  try {
    const bytes = await cleanCache(session.fromPartition('persist:whatsapp'));
    const mb = (bytes / (1024 * 1024)).toFixed(1);

    if (notifyOnSuccess || !parent) {
      if (Notification.isSupported()) {
        new Notification({
          title: 'WhatsApp',
          body: `Cleared ${mb} MB of temporary cache. Login and chats preserved.`,
          icon: path.join(__dirname, '..', 'assets', 'icons', '256x256.png')
        }).show();
      } else {
        await dialog.showMessageBox(null, {
          type: 'info',
          title: 'WhatsApp',
          message: `Cleared ${mb} MB of temporary cache.`
        });
      }
    }
    return { bytes };
  } catch (error) {
    if (notifyOnSuccess || !parent) {
      dialog.showErrorBox('Cache Cleanup Error', error.message || 'Failed to clear cache.');
    }
    return { error: error.message };
  } finally {
    clearingCache = false;
  }
}

function openExternal(url) {
  if (safeExternal(url)) shell.openExternal(url).catch(console.error);
}

// ─── Settings ────────────────────────────────────────────────────────────────

const settingsPath = path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath))
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (_) { settings = {}; }
  const def = (k, v) => { if (settings[k] === undefined) settings[k] = v; };
  def('minimizeToTray',         false);
  def('closeToTray',            true);
  def('showUnreadCountInTitle', true);
  def('enableNotifications',    true);
  def('notificationSound',      true);
  def('startMinimized',         false);
  def('autoStart',              true);
  def('trayAppearance',         'color');
}

function shouldStartHidden() {
  return process.argv.includes('--hidden') || settings.startMinimized;
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath + '.tmp', JSON.stringify(settings, null, 2), 'utf8');
    fs.renameSync(settingsPath + '.tmp', settingsPath);
  } catch (_) {}
}

// ─── Linux autostart ─────────────────────────────────────────────────────────

function getAutostartFile() {
  return path.join(os.homedir(), '.config', 'autostart', 'whatsapp-linux.desktop');
}

function setAutostart(enable) {
  const dir  = path.join(os.homedir(), '.config', 'autostart');
  const file = getAutostartFile();
  if (enable) {
    fs.mkdirSync(dir, { recursive: true });
    const exec = app.isPackaged
      ? `"${process.execPath}" --hidden`
      : `"${process.execPath}" "${path.join(__dirname, '..')}" --hidden`;
    fs.writeFileSync(file,
      ['[Desktop Entry]', 'Type=Application', 'Name=WhatsApp',
       'Comment=WhatsApp Desktop by Meta', `Exec=${exec}`,
       'Icon=whatsapp', 'Terminal=false', 'Hidden=false',
       'StartupWMClass=whatsapp',
       'X-GNOME-Autostart-enabled=true'].join('\n') + '\n', 'utf8');
  } else {
    try { fs.unlinkSync(file); } catch (_) {}
  }
}

// ─── Tray icon ────────────────────────────────────────────────────────────────

const trayIconCache = new Map();
let currentToolTip = 'WhatsApp';

function loadValidatedIcon(fileName, targetSize = 22) {
  const cacheKey = `${fileName}_${targetSize}`;
  if (trayIconCache.has(cacheKey)) return trayIconCache.get(cacheKey);
  const p = path.join(__dirname, '..', 'assets', fileName);
  try {
    if (fs.existsSync(p)) {
      let img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) {
        const size = img.getSize();
        if (size.width > 32 || size.height > 32) {
          img = img.resize({ width: targetSize, height: targetSize, quality: 'best' });
        }
        trayIconCache.set(cacheKey, img);
        return img;
      }
    }
  } catch (_) {}
  return null;
}

function getTrayIcon() {
  const appearance = settings.trayAppearance || 'color';
  const name = appearance === 'light' ? 'tray-icon-white.png'
    : appearance === 'dark' ? 'tray-icon-black.png'
    : 'tray-icon-color.png';

  return loadValidatedIcon(name, 22)
    || loadValidatedIcon('tray-icon-color.png', 22)
    || loadValidatedIcon('tray-icon.png', 22)
    || loadValidatedIcon('whatsapp-color.png', 22)
    || nativeImage.createEmpty();
}

function createTray() {
  try {
    if (tray && !tray.isDestroyed()) return tray;
    const icon = getTrayIcon();
    tray = new Tray(icon);
    tray.setToolTip(currentToolTip);
    if (typeof tray.setIgnoreDoubleClickEvents === 'function') {
      tray.setIgnoreDoubleClickEvents(true);
    }
    updateTrayMenu();
    tray.on('click', toggleWindow);
    tray.on('double-click', showWindow);
    return tray;
  } catch (err) {
    console.error('Tray creation failed:', err);
    tray = null;
    return null;
  }
}

function setupTrayWatcher() {
  if (process.platform !== 'linux') return;
  try {
    const dbus = require('dbus-next');
    const bus = dbus.sessionBus();
    bus.getProxyObject('org.kde.StatusNotifierWatcher', '/StatusNotifierWatcher')
      .then(proxy => {
        const iface = proxy.getInterface('org.kde.StatusNotifierWatcher');
        iface.on('StatusNotifierHostRegistered', () => {
          setTimeout(() => {
            try {
              if (tray && !tray.isDestroyed()) {
                tray.destroy();
                tray = null;
              }
              createTray();
            } catch (_) {}
          }, 1000);
        });
      })
      .catch(() => {});
  } catch (_) {}
}

function updateTrayMenu() {
  try {
    if (!tray || tray.isDestroyed()) return;
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: mainWindow?.isVisible() ? 'Hide WhatsApp' : 'Open WhatsApp',
        click: toggleWindow
      },
      { type: 'separator' },
      {
        label: 'Clear Cache…',
        click: () => { clearCache(null, true); }
      },
      {
        label: 'Settings',
        click: () => { showWindow(); mainWindow?.webContents.send('open-settings'); }
      },
      { type: 'separator' },
      {
        label: 'Run in Background',
        type: 'checkbox',
        checked: settings.closeToTray,
        click: m => {
          settings.closeToTray = m.checked;
          saveSettings();
          updateTrayMenu();
        }
      },
      {
        label: 'Minimize to Tray',
        type: 'checkbox',
        checked: settings.minimizeToTray,
        click: m => { settings.minimizeToTray = m.checked; saveSettings(); }
      },
      {
        label: 'Launch at Login',
        type: 'checkbox',
        checked: settings.autoStart,
        click: m => { settings.autoStart = m.checked; saveSettings(); setAutostart(m.checked); }
      },
      {
        label: 'Notifications',
        type: 'checkbox',
        checked: settings.enableNotifications,
        click: m => { settings.enableNotifications = m.checked; saveSettings(); }
      },
      { type: 'separator' },
      {
        label: 'Quit WhatsApp',
        click: () => { isQuitting = true; app.quit(); }
      }
    ]));
  } catch (err) {
    console.error('Update tray menu failed:', err);
  }
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) { createMainWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  updateTrayMenu();
}

function hideWindow() {
  mainWindow?.hide();
  updateTrayMenu();
}

function toggleWindow() {
  mainWindow?.isVisible() ? hideWindow() : showWindow();
}

let _balloonShown = false;
function showTrayBalloon() {
  if (_balloonShown || !Notification.isSupported()) return;
  _balloonShown = true;
  const n = new Notification({
    title: 'WhatsApp',
    silent: true,
    body: 'Running in background. Click tray icon to restore.',
    icon: path.join(__dirname, '..', 'assets', 'icons', '256x256.png'),
  });
  n.on('click', showWindow);
  n.show();
}

// ─── Main window ──────────────────────────────────────────────────────────────

function createMainWindow() {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    backgroundColor: '#111b21',
    icon: path.join(__dirname, '..', 'assets', 'icons', '256x256.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      sandbox: true,
    },
  });

  mainWindow.webContents.on('will-attach-webview', (event, prefs, params) => {
    if (params.src !== 'https://web.whatsapp.com/' && params.src !== 'https://web.whatsapp.com') {
      event.preventDefault();
      return;
    }
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    prefs.preload = path.join(__dirname, 'guest-preload.js');
  });

  mainWindow.on('closed', () => { mainWindow = null; app.quit(); });
  mainWindow.on('show', updateTrayMenu);
  mainWindow.on('hide', updateTrayMenu);
  mainWindow.loadFile(path.join(__dirname, 'shell.html'));

  mainWindow.once('ready-to-show', () => {
    if (!shouldStartHidden()) mainWindow.show();
  });

  mainWindow.on('minimize', e => {
    if (settings.minimizeToTray) {
      e.preventDefault();
      hideWindow();
      showTrayBalloon();
    }
  });

  mainWindow.on('close', e => {
    if (!isQuitting && settings.closeToTray) {
      e.preventDefault();
      hideWindow();
      showTrayBalloon();
    }
  });

  mainWindow.on('maximize',   () => mainWindow.webContents.send('win-state', { maximized: true }));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('win-state', { maximized: false }));

  mainWindow.webContents.on('did-attach-webview', (_, wc) => {
    wc.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
    wc.on('will-navigate', (event, url) => {
      try { if (new URL(url).origin === 'https://web.whatsapp.com') return; } catch (_) {}
      event.preventDefault(); openExternal(url);
    });

    let crashes = [];
    wc.on('render-process-gone', (_, details) => {
      callNotifications.close();
      if (details.reason === 'clean-exit') return;
      crashes = crashes.filter(t => Date.now() - t < 60000);
      if (crashes.length >= 2) {
        showWindow();
        dialog.showErrorBox('WhatsApp stopped responding', 'Please restart WhatsApp. Repeated automatic reloads have been stopped.');
        return;
      }
      crashes.push(Date.now());
      setTimeout(() => { if (!wc.isDestroyed()) wc.reload(); }, 2000);
    });

    wc.on('did-start-navigation', (_, url, inPlace, isMainFrame) => {
      if (isMainFrame && !inPlace) callNotifications.close();
    });

    // Native Linux keyboard shortcuts
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const ctrl  = input.control || input.meta;
      const shift = input.shift;
      const key   = input.key;

      if (ctrl && (key === 'q' || key === 'Q')) {
        event.preventDefault();
        isQuitting = true;
        app.quit();
      } else if (ctrl && (key === 'w' || key === 'W')) {
        event.preventDefault();
        if (settings.closeToTray) {
          hideWindow();
          showTrayBalloon();
        } else {
          mainWindow.close();
        }
      } else if (ctrl && key === 'r' && !shift) {
        event.preventDefault(); wc.reload();
      } else if ((ctrl && key === 'R' && shift) || key === 'F5') {
        event.preventDefault(); wc.reloadIgnoringCache();
      } else if (input.alt && key === 'ArrowLeft') {
        event.preventDefault(); if (wc.canGoBack()) wc.goBack();
      } else if (input.alt && key === 'ArrowRight') {
        event.preventDefault(); if (wc.canGoForward()) wc.goForward();
      } else if (ctrl && (key === '=' || key === '+')) {
        event.preventDefault(); wc.setZoomLevel(wc.getZoomLevel() + 0.5);
      } else if (ctrl && key === '-') {
        event.preventDefault(); wc.setZoomLevel(wc.getZoomLevel() - 0.5);
      } else if (ctrl && key === '0') {
        event.preventDefault(); wc.setZoomLevel(0);
      } else if (ctrl && shift && (key === 'i' || key === 'I')) {
        event.preventDefault(); wc.openDevTools();
      }
    });

    // Context menu
    wc.on('context-menu', (_, params) => {
      const items = [
        { label: 'Back',    enabled: wc.canGoBack(),    click: () => wc.goBack()    },
        { label: 'Forward', enabled: wc.canGoForward(), click: () => wc.goForward() },
        { label: 'Reload',                              click: () => wc.reload()    },
        { type: 'separator' }
      ];

      if (params.mediaType === 'image' && params.srcURL) {
        items.push(
          { label: 'Copy Image',            click: () => wc.copyImageAt(params.x, params.y) },
          { label: 'Copy Image Address',    click: () => clipboard.writeText(params.srcURL) },
          { label: 'Open Image in Browser', click: () => openExternal(params.srcURL) },
          { label: 'Save Image As…',        click: () => wc.downloadURL(params.srcURL) },
          { type: 'separator' }
        );
      }

      if (params.linkURL) {
        items.push(
          { label: 'Open Link in Browser', click: () => openExternal(params.linkURL) },
          { label: 'Copy Link Address',    click: () => clipboard.writeText(params.linkURL) },
          { type: 'separator' }
        );
      }

      if (params.selectionText) {
        items.push(
          { label: 'Copy', click: () => wc.copy() },
          { label: `Search Web for "${params.selectionText.slice(0, 30)}${params.selectionText.length > 30 ? '…' : ''}"`,
            click: () => openExternal(`https://www.google.com/search?q=${encodeURIComponent(params.selectionText)}`) },
          { type: 'separator' }
        );
      }

      if (params.isEditable) {
        items.push(
          { label: 'Cut',        role: 'cut',       enabled: params.editFlags.canCut   },
          { label: 'Copy',       role: 'copy',      enabled: params.editFlags.canCopy  },
          { label: 'Paste',      role: 'paste',     enabled: params.editFlags.canPaste },
          { label: 'Select All', role: 'selectAll' },
          { type: 'separator' }
        );
      }

      items.push({ label: 'Inspect Element', click: () => wc.inspectElement(params.x, params.y) });
      const menu = Menu.buildFromTemplate(items);
      menu.popup({ window: mainWindow });
    });
  });
}

// ─── IPC ──────────────────────────────────────────────────────────────────────

ipcMain.on('win-minimize', () => { mainWindow?.minimize(); });
ipcMain.on('win-maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('win-close', () => { mainWindow?.close(); });
ipcMain.handle('win-is-maximized', () => mainWindow?.isMaximized() ?? false);

ipcMain.on('wa-notification', (event, data) => {
  if (event.sender !== mainWindow?.webContents || !data || typeof data.title !== 'string') return;
  const { title, body, type } = data;
  if (!settings.enableNotifications) return;
  const n = new Notification({
    title: title || 'WhatsApp',
    body: body || '',
    icon: path.join(__dirname, '..', 'assets', 'icons', '256x256.png'),
    silent: !settings.notificationSound,
    urgency: type === 'call' ? 'critical' : 'normal',
    timeoutType: type === 'call' ? 'never' : 'default',
  });
  n.on('click', showWindow);
  n.show();
});

ipcMain.on('unread-count', (_, count) => {
  currentToolTip = count > 0 ? `WhatsApp (${count})` : 'WhatsApp';
  try {
    if (tray && !tray.isDestroyed()) {
      tray.setToolTip(currentToolTip);
    } else {
      createTray();
    }
  } catch (_) {
    try { createTray(); } catch (_) {}
  }
});

ipcMain.handle('get-settings', () => settings);
ipcMain.handle('save-settings', (_, s) => {
  Object.assign(settings, sanitizeSettings(s));
  saveSettings();
  if (typeof s?.autoStart === 'boolean') setAutostart(s.autoStart);
  try {
    if (!tray || tray.isDestroyed()) {
      createTray();
    } else {
      const icon = getTrayIcon();
      if (!icon.isEmpty()) tray.setImage(icon);
      updateTrayMenu();
    }
  } catch (_) {
    try { createTray(); } catch (_) {}
  }
  return settings;
});

// ─── App lifecycle ────────────────────────────────────────────────────────────

const { CallNotifications } = require('./call-notifications');
const callNotifications = new CallNotifications({
  icon: path.join(__dirname, '..', 'assets', 'icons', '256x256.png'),
  onAction: (action, id) => mainWindow?.webContents.send('call-action', { action, id }),
  onFailure: message => { new Notification({ title: 'WhatsApp call', body: message }).show(); }
});

ipcMain.handle('clear-cache', event => {
  return event.sender === mainWindow?.webContents ? clearCache(mainWindow, false) : { error: 'Unauthorized' };
});

ipcMain.on('open-external', (event, url) => {
  if (event.sender === mainWindow?.webContents) openExternal(url);
});

ipcMain.on('call-state', (event, state) => {
  if (event.sender !== mainWindow?.webContents) return;
  if (!state?.active) { callNotifications.close(); return; }
  if (settings.enableNotifications && typeof state.id === 'string') callNotifications.show(state.id);
});

ipcMain.on('call-result', (event, result) => {
  if (event.sender !== mainWindow?.webContents) return;
  if (!result?.ok) callNotifications.fail('Call action unavailable. Open WhatsApp to check the call.');
  else callNotifications.close();
});

if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(() => {
  loadSettings();
  app.setName('WhatsApp');
  if (process.platform === 'linux' && typeof app.setDesktopName === 'function') {
    app.setDesktopName('whatsapp.desktop');
  }
  const waSession = session.fromPartition('persist:whatsapp');
  const allowed = new Set(['media', 'notifications', 'fullscreen']);
  const trusted = url => {
    try { return new URL(url).origin === 'https://web.whatsapp.com'; } catch (_) { return false; }
  };
  waSession.setPermissionRequestHandler((wc, permission, callback, details) =>
    callback(allowed.has(permission) && trusted(details.requestingUrl || wc.getURL()))
  );
  waSession.setPermissionCheckHandler((wc, permission, origin) =>
    allowed.has(permission) && trusted(origin)
  );

  app.on('second-instance', showWindow);
  createMainWindow();
  try {
    createTray();
    setupTrayWatcher();
  } catch (error) {
    console.error(error);
    settings.closeToTray = false;
    showWindow();
  }
  try { setAutostart(settings.autoStart); } catch (error) { console.error(error); }
});

app.on('window-all-closed', () => app.quit());
app.on('activate', () => (mainWindow ? showWindow() : createMainWindow()));
app.on('before-quit', () => {
  isQuitting = true;
  callNotifications.close();
  tray?.destroy();
  tray = null;
});
