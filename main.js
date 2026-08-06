const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const WINDOW_SIZES = {
  small: { width: 135, height: 215 },
  medium: { width: 170, height: 270 },
  large: { width: 210, height: 335 }
};

const WATER_FRAME_RATIO = 875 / 750;
const WATER_CHARACTER_ANCHOR = 650 / 896;
const STAGE_HEIGHT_RATIO = 0.945;

let petWindow;
let tray;
let quitting = false;
let dragOffset = null;
let dragSize = null;
let actionMode = 'normal';
let actionRestoreBounds = null;
let settings = {
  size: 'medium',
  alwaysOnTop: true,
  position: null
};

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) };
  } catch {
    // First launch uses the quiet defaults above.
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error('Could not save settings:', error);
  }
}

function isVisibleOnAnyDisplay(bounds) {
  return screen.getAllDisplays().some(({ workArea }) => {
    const horizontal = bounds.x < workArea.x + workArea.width && bounds.x + bounds.width > workArea.x;
    const vertical = bounds.y < workArea.y + workArea.height && bounds.y + bounds.height > workArea.y;
    return horizontal && vertical;
  });
}

function defaultPosition(width, height) {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - width - 24,
    y: workArea.y + workArea.height - height - 18
  };
}

function keepInsideWorkArea(x, y, width, height) {
  const { workArea } = screen.getDisplayNearestPoint({ x, y });
  return {
    x: Math.min(Math.max(x, workArea.x - width + 80), workArea.x + workArea.width - 80),
    y: Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - 80)
  };
}

function fitInsideWorkArea(x, y, width, height) {
  const { workArea } = screen.getDisplayNearestPoint({
    x: x + Math.round(width / 2),
    y: y + Math.round(height / 2)
  });
  return {
    x: Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - width),
    y: Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - height)
  };
}

function createPetWindow() {
  const size = WINDOW_SIZES[settings.size] || WINDOW_SIZES.medium;
  const savedBounds = settings.position
    ? { ...settings.position, ...size }
    : { ...defaultPosition(size.width, size.height), ...size };
  const position = isVisibleOnAnyDisplay(savedBounds)
    ? { x: savedBounds.x, y: savedBounds.y }
    : defaultPosition(size.width, size.height);

  petWindow = new BrowserWindow({
    ...size,
    ...position,
    title: '洛琪希桌宠',
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: settings.alwaysOnTop,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  petWindow.setAlwaysOnTop(settings.alwaysOnTop, 'screen-saver');
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  petWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  petWindow.once('ready-to-show', () => {
    const fixedSize = WINDOW_SIZES[settings.size] || WINDOW_SIZES.medium;
    const { x, y } = petWindow.getBounds();
    petWindow.setBounds({ x, y, ...fixedSize }, false);
    petWindow.showInactive();
    if (settings.alwaysOnTop) {
      petWindow.setAlwaysOnTop(true, 'screen-saver');
      petWindow.moveTop();
    }
  });
  petWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      petWindow.hide();
    }
  });
}

function setPetSize(name) {
  const size = WINDOW_SIZES[name];
  if (!size || !petWindow) return;

  if (actionRestoreBounds) {
    petWindow.setBounds(actionRestoreBounds, false);
    actionRestoreBounds = null;
    actionMode = 'normal';
  }

  const old = petWindow.getBounds();
  const target = keepInsideWorkArea(
    old.x + old.width - size.width,
    old.y + old.height - size.height,
    size.width,
    size.height
  );
  petWindow.setBounds({ ...target, ...size }, true);
  settings.size = name;
  settings.position = target;
  saveSettings();
}

function setActionMode(mode) {
  if (!petWindow) return null;
  if (mode === 'normal') {
    if (actionRestoreBounds) petWindow.setBounds(actionRestoreBounds, false);
    actionRestoreBounds = null;
    actionMode = 'normal';
    const bounds = petWindow.getBounds();
    return {
      mode,
      width: bounds.width,
      height: bounds.height,
      normalWidth: bounds.width,
      normalHeight: bounds.height,
      characterOffsetX: 0,
      characterOffsetY: 0
    };
  }

  if (!['water', 'storm'].includes(mode)) return null;
  if (!actionRestoreBounds) actionRestoreBounds = petWindow.getBounds();
  const normal = actionRestoreBounds;
  let width;
  let height;
  let x;
  let y;

  if (mode === 'water') {
    width = Math.ceil(normal.height * WATER_FRAME_RATIO);
    height = normal.height;
    const contentHeight = normal.height * STAGE_HEIGHT_RATIO;
    const contentWidth = contentHeight * WATER_FRAME_RATIO;
    const contentLeft = (width - contentWidth) / 2;
    const waterAnchor = contentLeft + contentWidth * WATER_CHARACTER_ANCHOR;
    x = Math.round(normal.x + normal.width / 2 - waterAnchor);
    y = normal.y;
  } else {
    width = Math.round(normal.width + normal.height * 0.9);
    height = Math.round(normal.height * 1.68);
    x = Math.round(normal.x - (width - normal.width) / 2);
    y = normal.y - (height - normal.height);
  }

  const fitted = fitInsideWorkArea(x, y, width, height);
  petWindow.setBounds({ ...fitted, width, height }, false);
  actionMode = mode;
  return {
    mode,
    width,
    height,
    normalWidth: normal.width,
    normalHeight: normal.height,
    characterOffsetX: normal.x - fitted.x,
    characterOffsetY: normal.y - fitted.y
  };
}

function moveToCorner() {
  if (!petWindow) return;
  const { width, height } = petWindow.getBounds();
  const position = defaultPosition(width, height);
  petWindow.setPosition(position.x, position.y, true);
  settings.position = position;
  saveSettings();
}

function toggleWindow() {
  if (!petWindow) return;
  if (petWindow.isVisible()) {
    petWindow.hide();
  } else {
    petWindow.showInactive();
  }
}

function sendToPet(channel, ...args) {
  if (!petWindow) return;
  if (!petWindow.isVisible()) petWindow.showInactive();
  petWindow.webContents.send(channel, ...args);
}

function createContextMenu() {
  const startup = app.getLoginItemSettings().openAtLogin;
  return Menu.buildFromTemplate([
    { label: '和洛琪希说话', click: () => sendToPet('pet:speak') },
    { label: '施展水弹', click: () => sendToPet('pet:cast') },
    { label: '施展豪雷积雨云', click: () => sendToPet('pet:storm') },
    {
      label: '动作',
      submenu: [
        { label: '扶帽致意', click: () => sendToPet('pet:action', 'hat') },
        { label: '伸展身体', click: () => sendToPet('pet:action', 'stretch') },
        { label: '挥手', click: () => sendToPet('pet:action', 'wave') },
        { label: '轻抚发辫', click: () => sendToPet('pet:action', 'braid') },
        { label: '撒个娇', click: () => sendToPet('pet:action', 'coquettish') },
        { type: 'separator' },
        { label: '看向一旁', click: () => sendToPet('pet:action', 'look') },
        { label: '转身看看', click: () => sendToPet('pet:action', 'turn') }
      ]
    },
    { type: 'separator' },
    {
      label: '大小',
      submenu: Object.keys(WINDOW_SIZES).map((name) => ({
        label: { small: '小', medium: '中', large: '大' }[name],
        type: 'radio',
        checked: settings.size === name,
        click: () => setPetSize(name)
      }))
    },
    {
      label: '保持在最前面',
      type: 'checkbox',
      checked: settings.alwaysOnTop,
      click: ({ checked }) => {
        settings.alwaysOnTop = checked;
        petWindow.setAlwaysOnTop(checked, 'screen-saver');
        saveSettings();
      }
    },
    {
      label: '开机时出现',
      type: 'checkbox',
      checked: startup,
      click: ({ checked }) => {
        app.setLoginItemSettings({
          openAtLogin: checked,
          path: app.getPath('exe'),
          args: app.isPackaged ? [] : [app.getAppPath()]
        });
      }
    },
    { label: '回到右下角', click: moveToCorner },
    { type: 'separator' },
    { label: '暂时隐藏', click: () => petWindow.hide() },
    {
      label: '退出',
      click: () => {
        quitting = true;
        app.quit();
      }
    }
  ]);
}

function createTray() {
  const sprite = nativeImage.createFromPath(path.join(__dirname, 'assets', 'roxy-reference.png'));
  tray = new Tray(sprite.resize({ width: 24, height: 24 }));
  tray.setToolTip('洛琪希桌宠');
  tray.on('click', toggleWindow);
  tray.on('right-click', () => tray.popUpContextMenu(createContextMenu()));
}

function registerIpc() {
  ipcMain.handle('pet:drag-start', (_event, point) => {
    if (!petWindow || actionMode !== 'normal') return null;
    const cursor = Number.isFinite(point?.x) && Number.isFinite(point?.y)
      ? point
      : screen.getCursorScreenPoint();
    const bounds = petWindow.getBounds();
    const configuredSize = WINDOW_SIZES[settings.size] || WINDOW_SIZES.medium;
    dragSize = { ...configuredSize };
    dragOffset = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
    if (bounds.width !== dragSize.width || bounds.height !== dragSize.height) {
      petWindow.setBounds({ x: bounds.x, y: bounds.y, ...dragSize }, false);
    }
    return dragSize;
  });

  ipcMain.on('pet:drag-move', (_event, point) => {
    if (!petWindow || !dragOffset) return;
    const cursor = Number.isFinite(point?.x) && Number.isFinite(point?.y)
      ? point
      : screen.getCursorScreenPoint();
    const fixedSize = dragSize || WINDOW_SIZES[settings.size] || WINDOW_SIZES.medium;
    const next = keepInsideWorkArea(
      cursor.x - dragOffset.x,
      cursor.y - dragOffset.y,
      fixedSize.width,
      fixedSize.height
    );
    petWindow.setBounds({ ...next, ...fixedSize }, false);
  });

  ipcMain.on('pet:drag-lift', (_event, enabled, point) => {
    if (!petWindow || !dragOffset || actionMode !== 'normal') return;
    const cursor = Number.isFinite(point?.x) && Number.isFinite(point?.y)
      ? point
      : screen.getCursorScreenPoint();
    const fixedSize = dragSize || WINDOW_SIZES[settings.size] || WINDOW_SIZES.medium;
    const bounds = petWindow.getBounds();
    dragOffset = enabled
      ? {
          x: Math.round(fixedSize.width * 0.52),
          y: Math.round(fixedSize.height * 0.29)
        }
      : { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
    if (enabled) {
      const next = keepInsideWorkArea(
        cursor.x - dragOffset.x,
        cursor.y - dragOffset.y,
        fixedSize.width,
        fixedSize.height
      );
      petWindow.setBounds({ ...next, ...fixedSize }, false);
    }
  });

  ipcMain.on('pet:drag-end', () => {
    if (!petWindow) return;
    dragOffset = null;
    dragSize = null;
    const { x, y } = petWindow.getBounds();
    settings.position = { x, y };
    saveSettings();
  });

  ipcMain.on('pet:show-menu', () => {
    if (petWindow) createContextMenu().popup({ window: petWindow });
  });

  ipcMain.handle('pet:set-action-mode', (_event, mode) => setActionMode(mode));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (petWindow) petWindow.showInactive();
  });

  app.whenReady().then(() => {
    loadSettings();
    registerIpc();
    createPetWindow();
    createTray();
  });

  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    quitting = true;
  });
}
