const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage, shell } = require('electron');
const fs = require('fs');
const path = require('path');

let mainWindow = null;
let tray = null;
let quitting = false;
let reminderTimers = new Map();

const DEFAULT_DATA = {
  tasks: [],
  lists: [
    { id: 'inbox', name: '收集箱', color: '#5b7cfa', icon: '📥', archived: false },
    { id: 'work', name: '工作', color: '#ef5350', icon: '💼', archived: false },
    { id: 'life', name: '生活', color: '#26a69a', icon: '🌿', archived: false },
    { id: 'study', name: '学习', color: '#8e67d5', icon: '📚', archived: false },
    { id: 'shopping', name: '购物', color: '#f5a623', icon: '🛒', archived: false }
  ],
  settings: {
    theme: 'system', fontSize: 14, defaultList: 'inbox', defaultPriority: 'medium',
    autoArchive: false, overdueHighlight: true, quietStart: '22:00', quietEnd: '07:00',
    notifications: true
  },
  trash: [], habits: [], version: 1
};

function dataPath() {
  return path.join(app.getPath('userData'), 'todo-data.json');
}

function backupPath() {
  return path.join(app.getPath('userData'), 'todo-data.backup.json');
}

function normalizeData(parsed = {}) {
  return {
    ...structuredClone(DEFAULT_DATA),
    ...parsed,
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
    lists: Array.isArray(parsed.lists) && parsed.lists.length ? parsed.lists : structuredClone(DEFAULT_DATA.lists),
    trash: Array.isArray(parsed.trash) ? parsed.trash : [],
    habits: Array.isArray(parsed.habits) ? parsed.habits : [],
    settings: { ...DEFAULT_DATA.settings, ...(parsed.settings || {}) }
  };
}

function loadData() {
  const candidates = [dataPath(), backupPath()];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
      return normalizeData(parsed);
    } catch (error) {
      console.error(`Failed to load data from ${p}:`, error);
    }
  }
  return structuredClone(DEFAULT_DATA);
}

function saveData(todoData) {
  const normalized = normalizeData(todoData);
  const p = dataPath();
  const backup = backupPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;

  // Preserve the last valid database before replacing it.
  if (fs.existsSync(p)) {
    try { fs.copyFileSync(p, backup); } catch (error) { console.warn('Backup copy failed:', error); }
  }

  fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2), 'utf8');
  try {
    fs.renameSync(tmp, p);
  } catch (error) {
    // Windows may reject replacement when the destination exists.
    if (fs.existsSync(p)) fs.unlinkSync(p);
    fs.renameSync(tmp, p);
  }

  // Ensure a first backup also exists after the initial successful save.
  if (!fs.existsSync(backup)) {
    try { fs.copyFileSync(p, backup); } catch (error) { console.warn('Initial backup failed:', error); }
  }

  rebuildReminders(normalized);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('storage-changed', normalized);
  }
}

function isQuiet(settings = {}) {
  if (!settings.quietStart || !settings.quietEnd) return false;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = settings.quietStart.split(':').map(Number);
  const [eh, em] = settings.quietEnd.split(':').map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  return start < end ? cur >= start && cur < end : cur >= start || cur < end;
}

function showNotification(title, body) {
  if (!Notification.isSupported()) return;
  const notification = new Notification({
    title: title || 'FocusTodo Pro',
    body: body || '你有一项待办需要处理',
    icon: path.join(__dirname, 'src', 'icons', 'icon128.png')
  });
  notification.on('click', () => showMainWindow());
  notification.show();
}

function clearReminderTimers() {
  for (const timer of reminderTimers.values()) clearTimeout(timer);
  reminderTimers.clear();
}

function rebuildReminders(todoData = loadData()) {
  clearReminderTimers();
  const now = Date.now();
  for (const task of todoData.tasks || []) {
    if (task.completed || task.archived || !task.dueAt) continue;
    const offsets = task.reminders?.length ? task.reminders : [0];
    for (const offset of offsets) {
      const fireAt = new Date(task.dueAt).getTime() - Number(offset) * 60_000;
      const delay = fireAt - now;
      if (delay <= 0 || delay > 2_147_483_647) continue;
      const key = `${task.id}:${offset}`;
      const timer = setTimeout(() => {
        const latest = loadData();
        const current = (latest.tasks || []).find(t => t.id === task.id);
        if (!current || current.completed || current.archived || latest.settings?.notifications === false || isQuiet(latest.settings)) return;
        showNotification(current.title, current.notes || '待办时间到了');
        reminderTimers.delete(key);
      }, delay);
      reminderTimers.set(key, timer);
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    show: false,
    icon: path.join(__dirname, 'src', 'icons', 'icon.ico'),
    title: 'FocusTodo Pro',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html')).catch(error => console.error('Failed to load UI:', error));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => console.error('Preload error:', preloadPath, error));
  mainWindow.webContents.on('render-process-gone', (_event, details) => console.error('Renderer process gone:', details));
  mainWindow.on('close', event => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function showMainWindow(focusQuickAdd = false) {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  mainWindow.show();
  mainWindow.focus();
  if (focusQuickAdd) {
    setTimeout(() => mainWindow?.webContents.send('focus-quick-add'), 250);
  }
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'src', 'icons', 'icon128.png')).resize({ width: 20, height: 20 });
  tray = new Tray(icon);
  tray.setToolTip('FocusTodo Pro');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 FocusTodo', click: () => showMainWindow() },
    { label: '快速新建待办', click: () => showMainWindow(true) },
    { type: 'separator' },
    {
      label: '开机自动启动',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: item => app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true })
    },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('double-click', () => showMainWindow());
}

ipcMain.handle('storage-get', () => ({ todoData: loadData() }));
ipcMain.handle('storage-set', (_event, payload) => {
  if (!payload || typeof payload.todoData !== 'object') throw new Error('Invalid todo data');
  saveData(payload.todoData);
  return { ok: true };
});
ipcMain.handle('notify', (_event, payload) => {
  showNotification(payload?.title, payload?.message);
  return { ok: true };
});
ipcMain.handle('rebuild-reminders', () => {
  rebuildReminders();
  return { ok: true };
});
ipcMain.handle('get-active-page', () => ({ title: '', url: '' }));
ipcMain.handle('get-data-path', () => dataPath());

app.whenReady().then(() => {
  createWindow();
  createTray();
  rebuildReminders();

  app.on('activate', () => showMainWindow());
});

app.on('before-quit', () => { quitting = true; clearReminderTimers(); });
app.on('window-all-closed', () => {
  // Keep the background process alive for tray reminders on Windows.
});
