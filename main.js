const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {
  chooseDockEdge,
  computeDockLayout,
  computeFreeReturnBounds,
  clampFreeBounds
} = require('./dock-geometry');
const animationManifest = require('./assets/animations/new/manifest.json');

const WINDOW_SIZES = {
  small: { width: 135, height: 215 },
  medium: { width: 170, height: 270 },
  large: { width: 210, height: 335 },
  xlarge: { width: 315, height: 503 }
};

const WATER_FRAME_RATIO = 875 / 750;
const WATER_CHARACTER_ANCHOR = 650 / 896;
const STAGE_HEIGHT_RATIO = 0.945;
const DOCK_EDGE_REFERENCE_THRESHOLD = 8;
const DOCK_EDGE_MIN_THRESHOLD = 6;
const DOCK_RETURN_MARGIN = 28;
const DOCK_FOREGROUND_BEYOND_RATIO = {
  right: 0.025,
  bottom: 0.032
};
const DOCKED_SHAPE_PADDING = 4;
// Canonical-source alpha unions for each held dock pose plus every idle-wave
// frame. These are deliberately asset-space rectangles: computeDockLayout maps
// them through the same contain transform as the renderer and adds DIP padding.
const DOCKED_MEDIA_BOUNDS = {
  right: { x: 205, y: 141, width: 202, height: 441 },
  bottom: { x: 98, y: 523, width: 273, height: 196 }
};

function dockMediaFromManifest(edge) {
  const clip = animationManifest.clips?.[`dock-${edge}-enter`];
  if (!clip?.width || !clip?.height || !clip?.referenceLine?.ratio) {
    throw new Error(`Missing dock geometry metadata for ${edge}`);
  }
  return {
    width: clip.width,
    height: clip.height,
    lineRatio: clip.referenceLine.ratio,
    dockedMediaBounds: DOCKED_MEDIA_BOUNDS[edge]
  };
}

const DOCK_MEDIA = {
  right: dockMediaFromManifest('right'),
  bottom: dockMediaFromManifest('bottom')
};

function dockOverlap(edge, normalWidth) {
  return Math.max(
    8,
    Math.ceil(normalWidth * DOCK_FOREGROUND_BEYOND_RATIO[edge] + 2)
  );
}

function dockEdgeThreshold(normalWidth) {
  return Math.max(
    DOCK_EDGE_MIN_THRESHOLD,
    Math.round(
      DOCK_EDGE_REFERENCE_THRESHOLD * normalWidth / WINDOW_SIZES.medium.width
    )
  );
}

let petWindow;
let tray;
let quitting = false;
let dragOffset = null;
let dragSize = null;
let dragStartPoint = null;
let dragPreviousPoint = null;
let dragLastPoint = null;
let actionMode = 'normal';
let actionRestoreBounds = null;
let dockState = null;
let dockWindowAnimation = null;
let settings = {
  size: 'medium',
  alwaysOnTop: true,
  edgeInteractionDisabled: false,
  position: null
};

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) };
  } catch {
    // First launch uses the quiet defaults above.
  }
  // Only the literal JSON boolean true disables docking. This keeps older
  // settings files compatible and prevents malformed string values such as
  // "false" from unexpectedly turning the feature off.
  settings.edgeInteractionDisabled = settings.edgeInteractionDisabled === true;
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
  const { workArea } = screen.getDisplayNearestPoint({
    x: x + Math.round(width / 2),
    y: y + Math.round(height / 2)
  });
  return {
    x: Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - width),
    y: Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - height)
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

function displayForBounds(bounds) {
  return screen.getDisplayMatching(bounds);
}

function dockGeometryResult(layout, edge) {
  return {
    dockEdge: edge,
    normalWidth: layout.normalWidth,
    normalHeight: layout.normalHeight,
    dockWidth: layout.dockBounds.width,
    dockHeight: layout.dockBounds.height,
    lineOffset: layout.lineOffset
  };
}

function setPetWindowShape(rects) {
  if (!petWindow || petWindow.isDestroyed()) return;
  if (typeof petWindow.setShape === 'function') petWindow.setShape(rects);
}

function movePetWindowTo(bounds) {
  if (!petWindow || petWindow.isDestroyed() || !bounds) return;
  // PointerEvent.screenX/screenY can be fractional at non-integer Windows DPI
  // scales (for example 125%). Normalize the complete canonical rectangle at
  // the single native boundary. Electron 43.2 can grow a frameless window on
  // every setPosition() call at 125%, so position-only movement deliberately
  // uses setBounds with width/height from WINDOW_SIZES (never getBounds()).
  const x = Math.round(bounds.x);
  const y = Math.round(bounds.y);
  const width = Math.round(bounds.width);
  const height = Math.round(bounds.height);
  if (!Number.isFinite(x) || !Number.isFinite(y)
    || !Number.isFinite(width) || !Number.isFinite(height)
    || width <= 0 || height <= 0) return;
  const current = petWindow.getBounds();
  const sizeDrifted = Math.abs(current.width - width) > 2
    || Math.abs(current.height - height) > 2;
  if (current.x !== x || current.y !== y || sizeDrifted) {
    petWindow.setBounds({ x, y, width, height }, false);
  }
}

function matchesPetWindowSize(bounds, size) {
  // Fractional Windows scaling can round the native DIP rectangle by one or
  // occasionally two units after a move. Treat that as the same surface size;
  // forcing it back with setBounds would recreate the resize flash we avoid.
  return Math.abs(bounds.width - size.width) <= 2
    && Math.abs(bounds.height - size.height) <= 2;
}

function placeDockCanvas(layout, { docked = false } = {}) {
  const shape = docked ? layout?.dockedShape : layout?.dockShape;
  if (!layout?.dockCanvasBounds || !shape) return false;

  // Entry needs the complete transition crop. Once held, a padded alpha-union
  // crop removes the otherwise clickable transparent area without resizing the
  // fixed native canvas or changing media registration.
  setPetWindowShape([shape]);
  movePetWindowTo(layout.dockCanvasBounds);
  return true;
}

function placeNormalCanvas(bounds, { allowResize = false } = {}) {
  if (!petWindow || petWindow.isDestroyed() || !bounds) return false;
  const current = petWindow.getBounds();
  if (!matchesPetWindowSize(current, bounds)) {
    if (allowResize) {
      petWindow.setBounds(bounds, false);
    } else {
      // Dock transitions deliberately preserve the configured native surface.
      // The fixed-size move is performed behind the already-painted poster or
      // handoff, so a previously drifted process can recover without exposing
      // a standing frame.
      movePetWindowTo(bounds);
    }
  } else {
    // A canonical same-size setBounds is a move, not a semantic resize.
    movePetWindowTo(bounds);
  }
  // Position first: while these two synchronous native calls settle, the old
  // crop cannot expose the hidden side of the wall at the screen edge.
  setPetWindowShape([]);
  return true;
}

function cancelDockWindowAnimation() {
  if (!dockWindowAnimation) return;
  clearInterval(dockWindowAnimation.timer);
  dockWindowAnimation = null;
}

function dockExitBounds(edge, sourceBounds = petWindow?.getBounds()) {
  if (!petWindow || !dockState || dockState.edge !== edge || !sourceBounds) return null;
  const configuredSize = WINDOW_SIZES[settings.size] || WINDOW_SIZES.medium;
  const expandedBounds = { ...sourceBounds, ...configuredSize };
  const { workArea } = displayForBounds(expandedBounds);
  const workRight = workArea.x + workArea.width;
  const workBottom = workArea.y + workArea.height;
  const targetBounds = { ...expandedBounds };

  // Choose the final free origin before playback. A transparent BrowserWindow
  // must not be resized or nudged after the final decoded animation frame: on
  // Windows that can expose an older backing surface for a single frame.
  if (edge === 'right') {
    const characterRight = targetBounds.x + configuredSize.width * (430 / 500);
    const overflow = Math.ceil(characterRight - (workRight - 2));
    if (overflow > 0) targetBounds.x -= overflow;
    targetBounds.y = Math.min(
      Math.max(targetBounds.y, workArea.y),
      workBottom - configuredSize.height
    );
  } else {
    const characterBottom = targetBounds.y
      + configuredSize.height
      - configuredSize.width * (20 / 500);
    const overflow = Math.ceil(characterBottom - (workBottom - 2));
    if (overflow > 0) targetBounds.y -= overflow;
    targetBounds.x = Math.min(
      Math.max(targetBounds.x, workArea.x),
      workRight - configuredSize.width
    );
  }
  return targetBounds;
}

function startDockWindowAnimation(edge, phase, targetPosition, requestedDuration) {
  if (!petWindow || !dockState || dockState.edge !== edge) return null;
  cancelDockWindowAnimation();
  const configuredSize = WINDOW_SIZES[settings.size] || WINDOW_SIZES.medium;
  // The clips already contain the complete travel. Keep the normal native
  // canvas size and reproduce the former cropped window with a native shape;
  // this preserves the video's stabilized wall coordinate without a resize.
  const targetBounds = { ...targetPosition, ...configuredSize };
  const placed = phase === 'entering-dock'
    ? placeDockCanvas(dockState.layout)
    : placeNormalCanvas(targetBounds);
  if (!placed) return null;
  dockWindowAnimation = {
    edge,
    phase,
    targetBounds,
    timer: null,
    requestedDuration: Math.min(10000, Math.max(180, Number(requestedDuration) || 300))
  };
  return {
    mode: phase,
    normalWidth: configuredSize.width,
    normalHeight: configuredSize.height
  };
}

function prepareDock(edge, sourceBounds = petWindow?.getBounds()) {
  if (
    settings.edgeInteractionDisabled
    || !petWindow
    || !sourceBounds
    || !DOCK_MEDIA[edge]
  ) return null;
  cancelDockWindowAnimation();
  const { workArea, id: displayId } = displayForBounds(sourceBounds);
  const configuredSize = WINDOW_SIZES[settings.size] || WINDOW_SIZES.medium;
  const normalBounds = { ...sourceBounds, ...configuredSize };
  const freeBounds = computeFreeReturnBounds({
    bounds: normalBounds,
    workArea,
    edge,
    margin: DOCK_RETURN_MARGIN,
    normalWidth: configuredSize.width,
    normalHeight: configuredSize.height
  });
  const media = DOCK_MEDIA[edge];
  const layout = computeDockLayout({
    edge,
    freeBounds,
    workArea,
    mediaWidth: media.width,
    mediaHeight: media.height,
    lineRatio: media.lineRatio,
    overlap: dockOverlap(edge, configuredSize.width),
    mediaAlignX: 0.5,
    mediaAlignY: 1,
    dockedMediaBounds: media.dockedMediaBounds,
    dockedShapePadding: DOCKED_SHAPE_PADDING
  });

  dockState = { edge, freeBounds, displayId, layout, phase: 'prepared' };
  actionMode = 'dock';
  actionRestoreBounds = null;
  settings.position = { x: freeBounds.x, y: freeBounds.y };
  saveSettings();
  return dockGeometryResult(layout, edge);
}

function startDockEnterAnimation(edge, requestedDuration) {
  if (!petWindow || !dockState || dockState.edge !== edge) return null;
  if (dockState.phase !== 'prepared') return null;
  const { dockCanvasBounds } = dockState.layout;
  dockState.phase = 'entering';
  const started = startDockWindowAnimation(
    edge,
    'entering-dock',
    dockCanvasBounds,
    requestedDuration
  );
  if (!started) dockState.phase = 'prepared';
  return started;
}

function finishDockEnter(edge) {
  if (!petWindow || !dockState || dockState.edge !== edge) return null;
  if (dockState.phase !== 'entering') return null;
  // Shrink only the native shape to the padded held/wave alpha union. This does
  // not move or resize the BrowserWindow, and the pixels being removed are
  // transparent in both the held frame and every idle-wave frame.
  cancelDockWindowAnimation();
  dockState.phase = 'docked';
  setPetWindowShape([dockState.layout.dockedShape]);
  return dockGeometryResult(dockState.layout, edge);
}

function startDockExitAnimation(edge, requestedDuration) {
  if (!petWindow || !dockState || dockState.edge !== edge) return null;
  if (dockState.phase !== 'docked') return null;
  const targetBounds = dockExitBounds(edge);
  if (!targetBounds) return null;
  dockState.phase = 'leaving';
  const started = startDockWindowAnimation(edge, 'leaving-dock', targetBounds, requestedDuration);
  if (!started) dockState.phase = 'docked';
  return started;
}

function finishDockExit(edge) {
  if (!petWindow || !dockState || dockState.edge !== edge) return null;
  const configuredSize = WINDOW_SIZES[settings.size] || WINDOW_SIZES.medium;
  const freeBounds = dockExitBounds(edge);
  if (!freeBounds) return null;
  const completedPlayback = dockState.phase === 'leaving';
  cancelDockWindowAnimation();
  dockState = null;
  actionMode = 'normal';
  const currentBounds = petWindow.getBounds();
  if (
    !completedPlayback && (
      currentBounds.x !== freeBounds.x || currentBounds.y !== freeBounds.y
      || currentBounds.width !== freeBounds.width || currentBounds.height !== freeBounds.height
    )
  ) {
    placeNormalCanvas(freeBounds, { allowResize: true });
  } else {
    setPetWindowShape([]);
  }
  const settledBounds = petWindow.getBounds();
  settings.position = { x: settledBounds.x, y: settledBounds.y };
  saveSettings();
  return {
    mode: 'normal',
    normalWidth: configuredSize.width,
    normalHeight: configuredSize.height
  };
}

function resetDockState({ restore = true, notify = true } = {}) {
  if (!petWindow || !dockState) return false;
  const edge = dockState.edge;
  let geometry = null;
  if (restore) geometry = finishDockExit(edge);
  else {
    cancelDockWindowAnimation();
    dockState = null;
    actionMode = 'normal';
    setPetWindowShape([]);
  }
  if (notify && !petWindow.webContents.isDestroyed()) {
    petWindow.webContents.send('pet:dock-reset', geometry);
  }
  return true;
}

function forceNormalDockReset() {
  if (!petWindow || petWindow.isDestroyed()) return null;
  cancelDockWindowAnimation();
  dragOffset = null;
  dragSize = null;
  dragStartPoint = null;
  dragPreviousPoint = null;
  dragLastPoint = null;

  if (dockState) return finishDockExit(dockState.edge);

  const configuredSize = WINDOW_SIZES[settings.size] || WINDOW_SIZES.medium;
  const current = { ...petWindow.getBounds(), ...configuredSize };
  const { workArea } = displayForBounds(current);
  const freeBounds = clampFreeBounds(current, workArea);
  actionMode = 'normal';
  actionRestoreBounds = null;
  placeNormalCanvas(freeBounds, { allowResize: true });
  settings.position = { x: freeBounds.x, y: freeBounds.y };
  saveSettings();
  return {
    mode: 'normal',
    normalWidth: configuredSize.width,
    normalHeight: configuredSize.height
  };
}

function recomputeDockBounds() {
  if (!petWindow || !dockState) return;
  cancelDockWindowAnimation();
  const edge = dockState.edge;
  const configuredSize = WINDOW_SIZES[settings.size] || WINDOW_SIZES.medium;
  const display = screen.getDisplayNearestPoint({
    x: dockState.freeBounds.x + Math.round(configuredSize.width / 2),
    y: dockState.freeBounds.y + Math.round(configuredSize.height / 2)
  });
  const media = DOCK_MEDIA[edge];
  const freeBounds = computeFreeReturnBounds({
    bounds: { ...dockState.freeBounds, ...configuredSize },
    workArea: display.workArea,
    edge,
    margin: DOCK_RETURN_MARGIN,
    normalWidth: configuredSize.width,
    normalHeight: configuredSize.height
  });
  const layout = computeDockLayout({
    edge,
    freeBounds,
    workArea: display.workArea,
    mediaWidth: media.width,
    mediaHeight: media.height,
    lineRatio: media.lineRatio,
    overlap: dockOverlap(edge, configuredSize.width),
    mediaAlignX: 0.5,
    mediaAlignY: 1,
    dockedMediaBounds: media.dockedMediaBounds,
    dockedShapePadding: DOCKED_SHAPE_PADDING
  });
  const phase = dockState.phase;
  dockState = { edge, freeBounds, displayId: display.id, layout, phase };
  if (phase === 'docked') {
    placeDockCanvas(layout, { docked: true });
  } else if (phase === 'entering') {
    placeDockCanvas(layout);
  } else if (phase === 'leaving') {
    placeNormalCanvas({ ...freeBounds, ...configuredSize }, { allowResize: true });
  }
  settings.position = { x: freeBounds.x, y: freeBounds.y };
  saveSettings();
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
    icon: path.join(__dirname, 'assets', 'roxy-icon.ico'),
    frame: false,
    resizable: false,
    thickFrame: false,
    roundedCorners: false,
    backgroundMaterial: 'none',
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
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
      sandbox: true,
      backgroundThrottling: false
    }
  });

  petWindow.setAlwaysOnTop(settings.alwaysOnTop, 'screen-saver');
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  petWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  petWindow.webContents.on('did-finish-load', () => {
    // A manual renderer reload starts from its free-state state machine. Keep
    // the main process in sync instead of leaving an undraggable cropped window
    // or a stale drag offset whose pointer disappeared with the old renderer.
    if (dockState || dragOffset || actionMode !== 'normal' || actionRestoreBounds) {
      forceNormalDockReset();
    }
  });
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

  if (dockState) resetDockState({ restore: true, notify: true });

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
  if (dockState) resetDockState({ restore: true, notify: true });
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
  if (dockState) resetDockState({ restore: true, notify: true });
  const current = petWindow.getBounds();
  const normalSize = WINDOW_SIZES[settings.size] || WINDOW_SIZES.medium;
  // Large spell canvases are intentional and only move once here. Every
  // ordinary pet move must use the configured size instead of feeding a
  // fractional-DPI getBounds() result back into the next native operation.
  const { width, height } = actionMode === 'normal' ? normalSize : current;
  const position = defaultPosition(width, height);
  if (actionMode === 'normal') {
    movePetWindowTo({ ...position, width, height });
  } else {
    petWindow.setBounds({ ...position, width, height }, false);
  }
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

function notifyPetInteraction() {
  if (petWindow && !petWindow.webContents.isDestroyed()) {
    petWindow.webContents.send('pet:interaction');
  }
}

function setEdgeInteractionDisabled(disabled) {
  settings.edgeInteractionDisabled = Boolean(disabled);
  // Cancel renderer-side quiet-delay/automatic-return timers immediately.
  notifyPetInteraction();
  if (settings.edgeInteractionDisabled && dockState) {
    resetDockState({ restore: true, notify: true });
  }
  saveSettings();
}

function sendToPet(channel, ...args) {
  if (!petWindow) return;
  if (dockState) resetDockState({ restore: true, notify: true });
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
        label: { small: '小', medium: '中', large: '大', xlarge: '超大' }[name],
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
      label: '禁用边缘交互',
      type: 'checkbox',
      checked: settings.edgeInteractionDisabled,
      click: ({ checked }) => setEdgeInteractionDisabled(checked)
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
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'roxy-icon.ico'));
  tray = new Tray(icon.resize({ width: 24, height: 24 }));
  tray.setToolTip('洛琪希桌宠');
  tray.on('click', () => {
    notifyPetInteraction();
    toggleWindow();
  });
  tray.on('right-click', () => {
    notifyPetInteraction();
    tray.popUpContextMenu(createContextMenu());
  });
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
    dragStartPoint = { ...cursor };
    dragPreviousPoint = { ...cursor };
    dragLastPoint = { ...cursor };
    // A normal drag must never repair fractional-DPI rounding with a native
    // resize. Its pointer animation is renderer-only; the surface stays fixed.
    setPetWindowShape([]);
    return dragSize;
  });

  ipcMain.handle('pet:dock-drag-start', (_event, edge, point) => {
    if (!petWindow || !dockState || dockState.edge !== edge) return null;
    if (dockState.phase !== 'docked') return null;
    cancelDockWindowAnimation();
    const cursor = Number.isFinite(point?.x) && Number.isFinite(point?.y)
      ? point
      : screen.getCursorScreenPoint();
    const configuredSize = WINDOW_SIZES[settings.size] || WINDOW_SIZES.medium;
    const offset = {
      x: Math.round(configuredSize.width * 0.52),
      y: Math.round(configuredSize.height * 0.29)
    };
    const next = keepInsideWorkArea(
      cursor.x - offset.x,
      cursor.y - offset.y,
      configuredSize.width,
      configuredSize.height
    );

    dockState = null;
    actionMode = 'normal';
    actionRestoreBounds = null;
    dragSize = { ...configuredSize };
    dragOffset = offset;
    dragStartPoint = { ...cursor };
    dragPreviousPoint = { ...cursor };
    dragLastPoint = { ...cursor };
    placeNormalCanvas({ ...next, ...configuredSize });
    return {
      mode: 'normal',
      normalWidth: configuredSize.width,
      normalHeight: configuredSize.height
    };
  });

  ipcMain.on('pet:drag-move', (_event, point) => {
    if (!petWindow || !dragOffset) return;
    const cursor = Number.isFinite(point?.x) && Number.isFinite(point?.y)
      ? point
      : screen.getCursorScreenPoint();
    dragPreviousPoint = dragLastPoint ? { ...dragLastPoint } : { ...cursor };
    dragLastPoint = { ...cursor };
    const fixedSize = dragSize || WINDOW_SIZES[settings.size] || WINDOW_SIZES.medium;
    const next = keepInsideWorkArea(
      cursor.x - dragOffset.x,
      cursor.y - dragOffset.y,
      fixedSize.width,
      fixedSize.height
    );
    movePetWindowTo({ ...next, ...fixedSize });
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
      movePetWindowTo({ ...next, ...fixedSize });
    }
  });

  ipcMain.handle('pet:drag-end', (_event, point, options = {}) => {
    if (!petWindow) return null;
    const cursor = Number.isFinite(point?.x) && Number.isFinite(point?.y)
      ? point
      : screen.getCursorScreenPoint();
    if (!dragLastPoint
      || dragLastPoint.x !== cursor.x
      || dragLastPoint.y !== cursor.y) {
      dragPreviousPoint = dragLastPoint ? { ...dragLastPoint } : { ...cursor };
      dragLastPoint = { ...cursor };
    }
    const movement = {
      from: dragPreviousPoint || dragStartPoint || cursor,
      to: dragLastPoint || cursor
    };
    const bounds = petWindow.getBounds();
    dragOffset = null;
    dragSize = null;
    dragStartPoint = null;
    dragPreviousPoint = null;
    dragLastPoint = null;

    if (
      !settings.edgeInteractionDisabled
      && options?.moved
      && options?.allowDock !== false
      && actionMode === 'normal'
    ) {
      const { workArea } = displayForBounds(bounds);
      const configuredSize = WINDOW_SIZES[settings.size] || WINDOW_SIZES.medium;
      const edge = chooseDockEdge({
        bounds,
        workArea,
        movement,
        threshold: dockEdgeThreshold(configuredSize.width)
      });
      if (edge) {
        settings.position = { x: bounds.x, y: bounds.y };
        saveSettings();
        return {
          pendingDockEdge: edge,
          normalWidth: configuredSize.width,
          normalHeight: configuredSize.height
        };
      }
    }

    settings.position = { x: bounds.x, y: bounds.y };
    saveSettings();
    return null;
  });

  ipcMain.handle('pet:dock-exit-complete', (_event, edge) => {
    if (!dockState || dockState.edge !== edge || dockState.phase !== 'leaving') return null;
    return finishDockExit(edge);
  });
  ipcMain.handle('pet:dock-exit-start', (_event, edge, duration) => (
    startDockExitAnimation(edge, duration)
  ));
  ipcMain.handle('pet:dock-enter-start', (_event, edge, duration) => (
    startDockEnterAnimation(edge, duration)
  ));
  ipcMain.handle('pet:dock-enter-complete', (_event, edge) => finishDockEnter(edge));

  ipcMain.handle('pet:dock-redock', (_event, edge) => {
    if (
      settings.edgeInteractionDisabled
      || !petWindow
      || dockState
      || actionMode !== 'normal'
      || dragOffset
    ) return null;
    if (edge !== 'right' && edge !== 'bottom') return null;
    return prepareDock(edge, petWindow.getBounds());
  });

  ipcMain.handle('pet:dock-cancel-prepared', (_event, edge) => {
    if (!petWindow || !dockState || dockState.edge !== edge) return null;
    if (dockState.phase !== 'prepared') return null;
    return finishDockExit(edge);
  });

  ipcMain.handle('pet:dock-reset-request', () => forceNormalDockReset());

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
    screen.on('display-added', recomputeDockBounds);
    screen.on('display-removed', recomputeDockBounds);
    screen.on('display-metrics-changed', recomputeDockBounds);
  });

  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    quitting = true;
  });
}
