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

// Disable sandbox to avoid chrome-sandbox setuid requirement on install
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');
}
const { cleanCache, sanitizeSettings, safeExternal } = require('./safety');
let clearingCache = false;
async function clearCache() {
  if (clearingCache) return { error: 'Cache cleanup is already running.' };
  const answer = await dialog.showMessageBox(mainWindow, {
    type: 'question', buttons: ['Cancel', 'Clear cache'], defaultId: 0, cancelId: 0,
    message: 'Clear temporary browser cache?',
    detail: 'Your login, chats, cookies and settings will be kept. Avoid clearing cache during a call.'
  });
  if (answer.response !== 1) return { cancelled: true };
  clearingCache = true;
  try {
    const bytes = await cleanCache(session.fromPartition('persist:whatsapp'));
    return { bytes };
  } catch (error) { return { error: error.message }; }
  finally { clearingCache = false; }
}
function openExternal(url) { if (safeExternal(url)) shell.openExternal(url).catch(console.error); }


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
  def('trayAppearance', 'color');
}

// True when launched at login via the autostart .desktop file (--hidden flag)
// or when the user has enabled "Start minimized" in settings.
function shouldStartHidden() {
  return process.argv.includes('--hidden') || settings.startMinimized;
}

function saveSettings() {
  try { fs.mkdirSync(path.dirname(settingsPath), { recursive: true }); fs.writeFileSync(settingsPath + '.tmp', JSON.stringify(settings, null, 2), 'utf8'); fs.renameSync(settingsPath + '.tmp', settingsPath); }
  catch (_) {}
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
       'Comment=WhatsApp Desktop', `Exec=${exec}`,
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

function loadValidatedIcon(fileName) {
  if (trayIconCache.has(fileName)) return trayIconCache.get(fileName);
  const p = path.join(__dirname, '..', 'assets', fileName);
  try {
    if (fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) {
        trayIconCache.set(fileName, img);
        return img;
      }
    }
  } catch (_) {}
  return null;
}

function getTrayIcon() {
  const name = settings.trayAppearance === 'light' ? 'tray-icon-white.png'
    : settings.trayAppearance === 'dark' ? 'tray-icon-black.png' : 'whatsapp-color.png';
  return loadValidatedIcon(name)
    || loadValidatedIcon('whatsapp-color.png')
    || loadValidatedIcon('tray-icon.png')
    || loadValidatedIcon('icons/256x256.png')
    || nativeImage.createEmpty();
}

function createTray() {
  try {
    if (tray && !tray.isDestroyed()) return tray;
    const icon = getTrayIcon();
    tray = new Tray(icon);
    tray.setToolTip(currentToolTip);
    updateTrayMenu();
    tray.on('click',        toggleWindow);
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
    { label: mainWindow?.isVisible() ? 'Hide WhatsApp' : 'Show WhatsApp',
      click: toggleWindow },
    { type: 'separator' },
    { label: 'Clear cache…', click: async () => {
      const result = await clearCache();
      if (!result.cancelled) dialog.showMessageBox(mainWindow, { message: result.error || `Cleared ${(result.bytes / 1048576).toFixed(1)} MB of temporary cache.` });
    } },
    { label: 'Settings',
      click: () => { showWindow(); mainWindow?.webContents.send('open-settings'); } },
    { type: 'separator' },
    { label: 'Run in Background', type: 'checkbox', checked: settings.closeToTray,
      click: m => {
        settings.closeToTray = m.checked;
        saveSettings(); updateTrayMenu();
      }},
    { label: 'Minimize to Tray', type: 'checkbox', checked: settings.minimizeToTray,
      click: m => { settings.minimizeToTray = m.checked; saveSettings(); }},
    { label: 'Launch at Login', type: 'checkbox', checked: settings.autoStart,
      click: m => { settings.autoStart = m.checked; saveSettings(); setAutostart(m.checked); }},
    { label: 'Notifications', type: 'checkbox', checked: settings.enableNotifications,
      click: m => { settings.enableNotifications = m.checked; saveSettings(); }},
    { type: 'separator' },
    { label: 'Quit WhatsApp',
      click: () => { isQuitting = true; app.quit(); } },
  ]));
  } catch (err) {
    console.error('Update tray menu failed:', err);
  }
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) { createMainWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus();
  updateTrayMenu();
}
function hideWindow() { mainWindow?.hide(); updateTrayMenu(); }
function toggleWindow() { mainWindow?.isVisible() ? hideWindow() : showWindow(); }

let _balloonShown = false;
function showTrayBalloon() {
  if (_balloonShown || !Notification.isSupported()) return;
  _balloonShown = true;
  const n = new Notification({
    title: 'WhatsApp', silent: true,
    body: 'Running in the background. Click the tray icon to restore.',
    icon: path.join(__dirname, '..', 'assets', 'icons', '256x256.png'),
  });
  n.on('click', showWindow); n.show();
}

// ─── Main window ──────────────────────────────────────────────────────────────

function createMainWindow() {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 800, minHeight: 600,
    frame:           false,   // OS titlebar completely removed
    backgroundColor: '#111b21',
    icon: path.join(__dirname, '..', 'assets', 'icons', '256x256.png'),
    show: false,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      nodeIntegration:  false,
      contextIsolation: true,
      webviewTag:       true,   // enable <webview> in shell.html
      sandbox:          true,
    },
  });

  mainWindow.webContents.on('will-attach-webview', (event, prefs, params) => {
    if (params.src !== 'https://web.whatsapp.com/' && params.src !== 'https://web.whatsapp.com') { event.preventDefault(); return; }
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
    // If hidden at start, tray icon is still created — user can click it to open
  });

  // ── Minimize behaviour: taskbar by default, tray only if setting is ON ──
  // This does NOT intercept the custom btn-min click — that always goes to taskbar.
  // Only applies to OS-level minimize (keyboard shortcuts, taskbar button, etc.)
  mainWindow.on('minimize', e => {
    if (settings.minimizeToTray) {
      e.preventDefault();
      hideWindow();
      showTrayBalloon();
    }
    // If minimizeToTray is OFF → default OS minimize to taskbar (no preventDefault)
  });

  // ── Close behaviour: hide to tray if closeToTray ON, else quit ──
  // The custom btn-close sends 'win-close' IPC which calls mainWindow.close(),
  // triggering this event — so the setting still applies if the user wants it.
  mainWindow.on('close', e => {
    if (!isQuitting && settings.closeToTray) {
      e.preventDefault();
      hideWindow();
      showTrayBalloon();
    }
    // If closeToTray is OFF → window actually closes / app quits
  });

  // Forward maximize state for button icon
  mainWindow.on('maximize',   () => mainWindow.webContents.send('win-state', { maximized: true }));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('win-state', { maximized: false }));

  // ── Webview keyboard shortcuts + right-click context menu ─────────────────
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
      if (crashes.length >= 2) { showWindow(); dialog.showErrorBox('WhatsApp stopped responding', 'Please restart WhatsApp. Repeated automatic reloads have been stopped.'); return; }
      crashes.push(Date.now());
      setTimeout(() => { if (!wc.isDestroyed()) wc.reload(); }, 2000);
    });
    wc.on('did-start-navigation', (_, url, inPlace, isMainFrame) => { if (isMainFrame && !inPlace) callNotifications.close(); });


    // Keyboard shortcuts (Chrome-like)
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const ctrl  = input.control || input.meta;
      const shift = input.shift;
      const key   = input.key;

      if (ctrl && key === 'r' && !shift)  { event.preventDefault(); wc.reload(); }
      if (ctrl && key === 'R' &&  shift)  { event.preventDefault(); wc.reloadIgnoringCache(); }
      if (key === 'F5')                   { event.preventDefault(); wc.reload(); }
      if (input.alt && key === 'ArrowLeft')  { event.preventDefault(); if (wc.canGoBack())    wc.goBack(); }
      if (input.alt && key === 'ArrowRight') { event.preventDefault(); if (wc.canGoForward()) wc.goForward(); }
      if (ctrl && key === '=' )           { event.preventDefault(); wc.setZoomLevel(wc.getZoomLevel() + 0.5); }
      if (ctrl && key === '-' )           { event.preventDefault(); wc.setZoomLevel(wc.getZoomLevel() - 0.5); }
      if (ctrl && key === '0' )           { event.preventDefault(); wc.setZoomLevel(0); }
      if (ctrl && shift && key === 'I')   { event.preventDefault(); wc.openDevTools(); }
      if (ctrl && key === 'a' || ctrl && key === 'A') { /* allow select-all through */ }
    });

    // Right-click context menu
    wc.on('context-menu', (_, params) => {
      const items = [];

      // ── Navigation ─────────────────────────────────────────────────────
      items.push(
        { label: 'Back',    enabled: wc.canGoBack(),    click: () => wc.goBack()    },
        { label: 'Forward', enabled: wc.canGoForward(), click: () => wc.goForward() },
        { label: 'Reload',                              click: () => wc.reload()    },
        { type: 'separator' }
      );

      // ── Image options ───────────────────────────────────────────────────
      if (params.mediaType === 'image' && params.srcURL) {
        items.push(
          { label: 'Copy Image',
            click: () => wc.copyImageAt(params.x, params.y) },
          { label: 'Copy Image Address',
            click: () => clipboard.writeText(params.srcURL) },
          { label: 'Open Image in Browser',
            click: () => openExternal(params.srcURL) },
          { label: 'Save Image As…',
            click: () => wc.downloadURL(params.srcURL) },
          { type: 'separator' }
        );
      }

      // ── Link options ────────────────────────────────────────────────────
      if (params.linkURL) {
        items.push(
          { label: 'Open Link in Browser',
            click: () => openExternal(params.linkURL) },
          { label: 'Copy Link Address',
            click: () => clipboard.writeText(params.linkURL) },
          { type: 'separator' }
        );
      }

      // ── Text / edit options ─────────────────────────────────────────────
      if (params.selectionText) {
        items.push(
          { label: 'Copy',
            click: () => wc.copy() },
          { label: `Search Google for "${params.selectionText.slice(0, 30)}${params.selectionText.length > 30 ? '…' : ''}"`,
            click: () => openExternal(
              `https://www.google.com/search?q=${encodeURIComponent(params.selectionText)}`) },
          { type: 'separator' }
        );
      }

      if (params.isEditable) {
        items.push(
          { label: 'Cut',       role: 'cut',       enabled: params.editFlags.canCut   },
          { label: 'Copy',      role: 'copy',      enabled: params.editFlags.canCopy  },
          { label: 'Paste',     role: 'paste',     enabled: params.editFlags.canPaste },
          { label: 'Select All',role: 'selectAll'  },
          { type: 'separator' }
        );
      }

      // ── Dev ─────────────────────────────────────────────────────────────
      items.push({ label: 'Inspect Element',
        click: () => wc.inspectElement(params.x, params.y) });

      const menu = Menu.buildFromTemplate(items);
      menu.popup({ window: mainWindow });
    });
  });
}

// ─── IPC ──────────────────────────────────────────────────────────────────────

// Window control buttons — work independently, pass straight through to OS
ipcMain.on('win-minimize', () => {
  // Always minimize to taskbar from button — ignore minimizeToTray setting
  if (!mainWindow) return;
  mainWindow.minimize();
});

ipcMain.on('win-maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});

ipcMain.on('win-close', () => {
  // Triggers the 'close' event above — closeToTray setting applies there
  if (!mainWindow) return;
  mainWindow.close();
});

ipcMain.handle('win-is-maximized', () => mainWindow?.isMaximized() ?? false);

// Notifications relayed from webview → shell preload → main
ipcMain.on('wa-notification', (event, data) => {
  if (event.sender !== mainWindow?.webContents || !data || typeof data.title !== 'string') return;
  const { title, body, type } = data;
  if (!settings.enableNotifications) return;
  const n = new Notification({
    title: title || 'WhatsApp', body: body || '',
    icon: path.join(__dirname, '..', 'assets', 'icons', '256x256.png'),
    silent: !settings.notificationSound,
    urgency:     type === 'call' ? 'critical' : 'normal',
    timeoutType: type === 'call' ? 'never'    : 'default',
  });
  n.on('click', showWindow); n.show();
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

ipcMain.handle('get-settings',  ()     => settings);
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
ipcMain.handle('clear-cache', event => event.sender === mainWindow?.webContents ? clearCache() : { error: 'Unauthorized' });
ipcMain.on('open-external', (event, url) => { if (event.sender === mainWindow?.webContents) openExternal(url); });
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
  const trusted = url => { try { return new URL(url).origin === 'https://web.whatsapp.com'; } catch (_) { return false; } };
  waSession.setPermissionRequestHandler((wc, permission, callback, details) => callback(allowed.has(permission) && trusted(details.requestingUrl || wc.getURL())));
  waSession.setPermissionCheckHandler((wc, permission, origin) => allowed.has(permission) && trusted(origin));
  app.on('second-instance', showWindow);
  createMainWindow();
  try { createTray(); setupTrayWatcher(); } catch (error) { console.error(error); settings.closeToTray = false; showWindow(); }
  try { setAutostart(settings.autoStart); } catch (error) { console.error(error); }
});

app.on('window-all-closed', () => app.quit());
app.on('activate',          () => mainWindow ? showWindow() : createMainWindow());
app.on('before-quit', () => { isQuitting = true; callNotifications.close(); tray?.destroy(); tray = null; });
