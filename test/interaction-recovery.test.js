'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'renderer', 'renderer.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');

test('pointer loss and window disappearance are wired to drag recovery', () => {
  assert.match(renderer, /addEventListener\('lostpointercapture'/);
  assert.match(renderer, /window\.addEventListener\('blur'/);
  assert.match(renderer, /addEventListener\('visibilitychange'/);
  assert.match(renderer, /dragState\.fromDockEdge[\s\S]*void pointerUp\(\{[\s\S]*type: 'pointercancel'/);
  assert.match(renderer, /recoverAbandonedPointerDrag\('pointer capture lost'/);
});

test('drag watchdog preserves a legitimate captured long press', () => {
  assert.match(renderer, /pet\.hasPointerCapture\(dragState\.pointerId\)/);
  assert.match(renderer, /armTransientStateWatchdog\(state, revision\)/);
});

test('moving a free drag cancels the long-press lift animation', () => {
  assert.match(
    renderer,
    /dragState\.moved = true;\s*window\.clearTimeout\(dragState\.longPressTimer\);\s*dragState\.longPressTimer = 0;/
  );
  assert.match(
    renderer,
    /function activateLift\(pointerId\)[\s\S]*dragState\.fromDockEdge[\s\S]*dragState\.moved[\s\S]*interactionLocked/
  );
});

test('abandoned dock drags cancel delayed startup and keep visual ownership until settled', () => {
  assert.match(renderer, /let activeDockDrag = null;/);
  assert.match(renderer, /Boolean\(activeDockDrag && !activeDockDrag\.cancelled\)/);
  assert.match(
    renderer,
    /const isLiveDockDrag = \(\) => \([\s\S]*!currentDrag\.cancelled[\s\S]*activeDockDrag === currentDrag[\s\S]*currentDrag\.released/
  );
  assert.match(renderer, /if \(!dragSize \|\| !isLiveDockDrag\(\)\) return false;/);
  assert.match(renderer, /if \(abandonedDockDrag\) abandonedDockDrag\.cancelled = true;/);
});

test('renderer and main expose a bounded full-state reset path', () => {
  assert.match(renderer, /withTimeout\(window\.roxy\.resetDock\(\), 5000/);
  assert.match(preload, /resetDock: \(\) => ipcRenderer\.invoke\('pet:dock-reset-request'\)/);
  assert.match(main, /ipcMain\.handle\('pet:dock-reset-request', \(\) => forceNormalDockReset\(\)\)/);
  assert.match(main, /if \(dockState \|\| dragOffset \|\| actionMode !== 'normal' \|\| actionRestoreBounds\)/);
});

test('desktop timing stays active while the transparent pet window is unfocused', () => {
  assert.match(main, /backgroundThrottling:\s*false/);
});

test('renderer has no automatic blink state or timer', () => {
  assert.doesNotMatch(renderer, /blinkFrames|scheduleBlink|activeBlinkPose|cancelBlink/);
});

test('dock animations are loaded on demand instead of all at startup', () => {
  assert.doesNotMatch(renderer, /preloadDockAnimations|requestIdleCallback\(preloadDock/);
  assert.match(renderer, /await preloadClip\(clipName\)/);
});

test('legacy PNG actions are also loaded only when their sequence is used', () => {
  assert.doesNotMatch(renderer, /Object\.values\(frames\).*new Image/s);
  assert.doesNotMatch(renderer, /framesReady/);
  assert.match(renderer, /await preloadFrameSteps\(steps\)/);
});

test('edge docking uses the configured two-second quiet period', () => {
  assert.match(
    renderer,
    /scheduleAutoRedock\(pendingDockEdge,\s*\{\s*minDelay:\s*2000,\s*maxDelay:\s*2000\s*\}\)/
  );
});

test('edge interaction can be persistently disabled from the shared context menu', () => {
  assert.match(main, /edgeInteractionDisabled:\s*false/);
  assert.match(
    main,
    /settings\.edgeInteractionDisabled = settings\.edgeInteractionDisabled === true;/
  );
  assert.match(
    main,
    /label:\s*'禁用边缘交互',[\s\S]*checked:\s*settings\.edgeInteractionDisabled,[\s\S]*setEdgeInteractionDisabled\(checked\)/
  );

  const setter = main.slice(
    main.indexOf('function setEdgeInteractionDisabled'),
    main.indexOf('function sendToPet')
  );
  assert.match(setter, /notifyPetInteraction\(\)/);
  assert.match(setter, /settings\.edgeInteractionDisabled && dockState/);
  assert.match(setter, /resetDockState\(\{ restore: true, notify: true \}\)/);
  assert.match(setter, /saveSettings\(\)/);
});

test('disabled edge interaction gates both fresh drags and delayed redocking', () => {
  const prepare = main.slice(
    main.indexOf('function prepareDock'),
    main.indexOf('function startDockEnterAnimation')
  );
  const dragEnd = main.slice(
    main.indexOf("ipcMain.handle('pet:drag-end'"),
    main.indexOf("ipcMain.handle('pet:dock-exit-complete'")
  );
  const redock = main.slice(
    main.indexOf("ipcMain.handle('pet:dock-redock'"),
    main.indexOf("ipcMain.handle('pet:dock-cancel-prepared'")
  );

  assert.match(prepare, /settings\.edgeInteractionDisabled/);
  assert.match(dragEnd, /!settings\.edgeInteractionDisabled/);
  assert.match(redock, /settings\.edgeInteractionDisabled/);
});

test('dock transitions retain exclusive ownership of the visible sprite', () => {
  assert.match(renderer, /function dockVisualOwnsSprite\(\)/);
  assert.match(
    renderer,
    /if \(name === 'front' && dockVisualOwnsSprite\(\)\) return false/
  );
  assert.match(
    renderer,
    /const settleAfterEnd = holdLast \? 34 : -45/
  );
  const playNewClip = renderer.slice(
    renderer.indexOf('async function playNewClip'),
    renderer.indexOf('function applyNormalGeometry')
  );
  assert.match(playNewClip, /if \(holdLast\) \{\s*await waitForCompositorPaint\(\)/);
  assert.doesNotMatch(playNewClip, /clip\.lastFrame/);
});

test('dock geometry IPC is bracketed by painted media surfaces', () => {
  const enter = renderer.slice(renderer.indexOf('async function enterDock'), renderer.indexOf('function scheduleAutoRedock'));
  const leave = renderer.slice(renderer.indexOf('async function leaveDock'), renderer.indexOf('async function settleDragResult'));
  const dockDrag = renderer.slice(renderer.indexOf('function startDockWindowDrag'), renderer.indexOf('function recoverAbandonedPointerDrag'));

  assert.match(enter, /startDockEnter[\s\S]*await waitForCompositorPaint\(\)[\s\S]*playNewClip/);
  assert.match(enter, /finishDockEnter[\s\S]*await waitForCompositorPaint\(\)/);
  assert.match(leave, /startDockExit[\s\S]*await waitForCompositorPaint\(\)[\s\S]*playNewClip/);
  assert.match(leave, /finishDockExit[\s\S]*await waitForCompositorPaint\(\)/);
  assert.match(dockDrag, /waitForSpritePaint[\s\S]*startDockDrag[\s\S]*waitForCompositorPaint[\s\S]*playNewClip/);
});

test('dock entry paints its decoded poster before acquiring transition layout', () => {
  const enter = renderer.slice(
    renderer.indexOf('async function enterDock'),
    renderer.indexOf('function scheduleAutoRedock')
  );
  const preloadAt = enter.indexOf('await preloadClip(clipName)');
  const posterAt = enter.indexOf('await waitForSpritePaint(firstPoster)');
  const enteringStateAt = enter.indexOf('setPetState(`entering-${edge}`');
  const nativeMoveAt = enter.indexOf('window.roxy.startDockEnter');

  assert.ok(preloadAt >= 0 && preloadAt < posterAt);
  assert.ok(posterAt < enteringStateAt);
  assert.ok(enteringStateAt < nativeMoveAt);
  assert.match(
    renderer,
    /return sprite\.currentSrc === new URL\(source, document\.baseURI\)\.href/
  );
});

test('dock entry crops before playback and never resizes at its endpoint', () => {
  const start = main.slice(
    main.indexOf('function startDockWindowAnimation'),
    main.indexOf('function prepareDock')
  );
  const finish = main.slice(
    main.indexOf('function finishDockEnter'),
    main.indexOf('function startDockExitAnimation')
  );
  assert.match(start, /phase === 'entering-dock'\s*\? \{ \.\.\.targetPosition \}/);
  assert.doesNotMatch(finish, /petWindow\.setBounds/);
  assert.match(finish, /cancelDockWindowAnimation\(\)/);
});

test('transparent Windows window disables native resize and frame effects', () => {
  assert.match(main, /frame:\s*false,\s*resizable:\s*false,/);
  assert.match(main, /thickFrame:\s*false,/);
  assert.match(main, /roundedCorners:\s*false,/);
  assert.match(main, /backgroundMaterial:\s*'none',/);
});
