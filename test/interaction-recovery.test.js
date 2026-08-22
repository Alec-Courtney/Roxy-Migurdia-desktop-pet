'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'renderer', 'renderer.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8');

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
  assert.match(
    renderer,
    /state\.startsWith\('leaving-'\) && Boolean\(dragState\?\.fromDockEdge\)/
  );
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
  assert.match(
    renderer,
    /if \(!dragSize \|\| !isLiveDockDrag\(\)\) \{[\s\S]*retainDockPoster\(currentDrag\.dockPosterToken\)/
  );
  assert.match(
    renderer,
    /if \(!dragSize\) \{[\s\S]*retainDockPoster\(currentDrag\.dockPosterToken\);[\s\S]*currentDrag\.ready = false;[\s\S]*currentDrag\.startFailed = true;/
  );
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

test('drag release and click exit share one configured four-second redock delay', () => {
  const scheduler = renderer.slice(
    renderer.indexOf('function scheduleAutoRedock'),
    renderer.indexOf('async function leaveDock')
  );
  const leave = renderer.slice(
    renderer.indexOf('async function leaveDock'),
    renderer.indexOf('async function settleDragResult')
  );
  const settle = renderer.slice(
    renderer.indexOf('async function settleDragResult'),
    renderer.indexOf('async function finishDraggedDockExit')
  );

  assert.match(renderer, /const EDGE_REDOCK_QUIET_MS = 4000;/);
  assert.match(
    scheduler,
    /minDelay = EDGE_REDOCK_QUIET_MS, maxDelay = EDGE_REDOCK_QUIET_MS/
  );
  assert.match(leave, /scheduleAutoRedock\(edge\);/);
  assert.match(settle, /scheduleAutoRedock\(pendingDockEdge\);/);
  assert.doesNotMatch(scheduler, /10000|16000/);
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
  assert.match(dockDrag, /stageDockPoster[\s\S]*startDockDrag[\s\S]*waitForCompositorPaint[\s\S]*playNewClip/);
});

test('a stationary dock press preserves the held pose until click exit begins', () => {
  const pointerDown = renderer.slice(
    renderer.indexOf('async function pointerDown'),
    renderer.indexOf('function pointerMove')
  );
  const pointerMove = renderer.slice(
    renderer.indexOf('function pointerMove'),
    renderer.indexOf('async function pointerUp')
  );
  const pointerUp = renderer.slice(
    renderer.indexOf('async function pointerUp'),
    renderer.indexOf("pet.addEventListener('pointerdown'")
  );

  assert.doesNotMatch(pointerDown, /if \(dockEdge\) \{[\s\S]*showDockPose\(dockEdge\)/);
  assert.match(pointerDown, /if \(!dockEdge\) setPetState\('dragging'\)/);
  assert.match(
    pointerDown,
    /if \(!dockEdge\) \{\s*dragState\.longPressTimer = window\.setTimeout\(\(\) => activateLift/
  );
  assert.match(
    pointerMove,
    /if \(dragState\.fromDockEdge\) \{[\s\S]*setPetState\(`leaving-\$\{dragState\.fromDockEdge\}`\);\s*startDockWindowDrag/
  );
  assert.match(pointerUp, /if \(!fromDockEdge\) window\.roxy\.setDragLift\(false/);
  assert.match(
    pointerUp,
    /const expectedDragState = fromDockEdge \? `leaving-\$\{fromDockEdge\}` : 'dragging'/
  );
});

test('a dragged dock exit reaches the free state only after its exit clip settles', () => {
  const finishDraggedDockExit = renderer.slice(
    renderer.indexOf('async function finishDraggedDockExit'),
    renderer.indexOf('function resetDock')
  );
  const exitSettledAt = finishDraggedDockExit.indexOf('await finishedDrag.exitPromise');
  const handoffAt = finishDraggedDockExit.indexOf('await stageStandingHandoff(');
  const freeStateAt = finishDraggedDockExit.indexOf("setPetState('free')");

  assert.ok(exitSettledAt >= 0);
  assert.ok(handoffAt > exitSettledAt);
  assert.ok(freeStateAt === -1);
  assert.match(
    finishDraggedDockExit,
    /petState === `leaving-\$\{edge\}`[\s\S]*await commitStandingHandoff\(undefined, standingLease\)/
  );
});

test('dock exit paints a decoded standing buffer before publishing the free state', () => {
  const stage = renderer.slice(
    renderer.indexOf('async function stageStandingHandoff'),
    renderer.indexOf('async function commitStandingHandoff')
  );
  const commit = renderer.slice(
    renderer.indexOf('async function commitStandingHandoff'),
    renderer.indexOf('function cancelStandingHandoff')
  );
  const leave = renderer.slice(
    renderer.indexOf('async function leaveDock'),
    renderer.indexOf('async function settleDragResult')
  );

  assert.match(stage, /frontHandoff\.decode\(\)[\s\S]*isCurrent\(\)[\s\S]*is-front-handoff[\s\S]*waitForSpritePaint\(frames\.front\)/);
  assert.match(commit, /lease !== standingHandoffLease[\s\S]*setPetState\('free', geometry\)[\s\S]*setMediaMode\(false\)[\s\S]*cancelStandingHandoff\(lease\)/);
  assert.match(leave, /standingLease = await stageStandingHandoff\(\(\) => \([\s\S]*await commitStandingHandoff\(geometry, standingLease\)/);
  assert.doesNotMatch(leave, /setMediaMode\(false\);\s*setFrame\('front'\)/);
  assert.match(
    renderer,
    /takeOverStandingHandoff\(\)[\s\S]*window\.roxy\.resetDock\(\)[\s\S]*recoverStandingVisual/
  );
  assert.match(stage, /lease !== standingHandoffLease\) return 0;[\s\S]*cancelStandingHandoff\(lease\)/);
  assert.match(
    renderer,
    /return \{ wasActive, lease: standingHandoffLease \}/
  );
});

test('dock entry presents its independent decoded poster before acquiring transition layout', () => {
  const enter = renderer.slice(
    renderer.indexOf('async function enterDock'),
    renderer.indexOf('function scheduleAutoRedock')
  );
  const preloadAt = enter.indexOf('await preloadClip(clipName)');
  const posterAt = enter.indexOf('await stageDockPoster(clipName');
  const enteringStateAt = enter.indexOf('setPetState(`entering-${edge}`');
  const nativeMoveAt = enter.indexOf('window.roxy.startDockEnter');

  assert.ok(preloadAt >= 0 && preloadAt < posterAt);
  assert.ok(posterAt < enteringStateAt);
  assert.ok(enteringStateAt < nativeMoveAt);
  assert.match(
    renderer,
    /return sprite\.currentSrc === absoluteImageSource\(source\)/
  );
});

test('dock clips use a same-geometry poster layer while the animated source commits', () => {
  const play = renderer.slice(
    renderer.indexOf('async function playNewClip'),
    renderer.indexOf('function applyNormalGeometry')
  );
  const poster = renderer.slice(
    renderer.indexOf('async function stageDockPoster'),
    renderer.indexOf('async function stageStandingHandoff')
  );

  assert.match(html, /id="sprite"[\s\S]*id="dockPoster"[\s\S]*id="frontHandoff"/);
  assert.match(styles, /\.sprite-dock-poster \{[\s\S]*z-index: 3;[\s\S]*visibility: hidden/);
  assert.match(
    styles,
    /body\.mode-media \.character-stage,\s*body\.is-dock-poster \.character-stage \{[\s\S]*width: var\(--normal-width,[\s\S]*height: var\(--normal-height,/
  );
  assert.match(styles, /body\.is-dock-poster #sprite \{\s*visibility: hidden;/);
  assert.doesNotMatch(
    styles,
    /\.sprite-dock-poster \{[^}]*\b(?:left|top|width|height|object-fit|object-position):/
  );
  assert.match(
    poster,
    /waitForImageSource\([\s\S]*dockPoster\.decode\(\)[\s\S]*is-dock-poster/
  );
  assert.match(
    play,
    /isDockClip[\s\S]*stageDockPoster[\s\S]*waitForSpriteSource\(animatedSource\)[\s\S]*waitForCompositorPaint\(\)[\s\S]*releaseDockPoster/
  );
  assert.doesNotMatch(play, /sprite\.src\s*=/);
  const enter = renderer.slice(
    renderer.indexOf('async function enterDock'),
    renderer.indexOf('function scheduleAutoRedock')
  );
  assert.match(enter, /applyNormalGeometry\(geometry\)[\s\S]*stageDockPoster/);
});

test('image load waits are bound to the exact element URL and request owner', () => {
  const sourceWait = renderer.slice(
    renderer.indexOf('function waitForImageSource'),
    renderer.indexOf('function waitForSpriteSource')
  );
  assert.match(sourceWait, /imageSourceRequests\.get\(image\)\?\.id === id/);
  assert.match(sourceWait, /image\.currentSrc === expected/);
  assert.match(sourceWait, /if \(!matchesExpected\(\)\) return/);
});

test('dock cancellation retains a valid visual cover until its successor commits', () => {
  const cancelMotion = renderer.slice(
    renderer.indexOf('function cancelDockMotion'),
    renderer.indexOf('function showDockPose')
  );
  const play = renderer.slice(
    renderer.indexOf('async function playNewClip'),
    renderer.indexOf('function applyNormalGeometry')
  );
  const recovery = renderer.slice(
    renderer.indexOf('function recoverDockToFree'),
    renderer.indexOf('async function enterDock')
  );

  assert.match(cancelMotion, /takeOverDockPoster\(\)/);
  assert.doesNotMatch(cancelMotion, /cancelDockPoster\(\)/);
  assert.match(play, /if \(posterToken && !isDockClip\) releaseDockPoster\(posterToken\)/);
  assert.match(renderer, /function retainDockPoster\(lease\)[\s\S]*Keep the last decoded poster/);
  assert.ok(recovery.indexOf('window.roxy.resetDock()') < recovery.indexOf('recoverStandingVisual('));
});

test('dock transitions preserve the normal canvas and use an equivalent native shape crop', () => {
  const start = main.slice(
    main.indexOf('function startDockWindowAnimation'),
    main.indexOf('function prepareDock')
  );
  const placement = main.slice(
    main.indexOf('function setPetWindowShape'),
    main.indexOf('function cancelDockWindowAnimation')
  );
  const finish = main.slice(
    main.indexOf('function finishDockEnter'),
    main.indexOf('function startDockExitAnimation')
  );
  assert.match(start, /const targetBounds = \{ \.\.\.targetPosition, \.\.\.configuredSize \}/);
  assert.match(start, /placeDockCanvas\(dockState\.layout\)[\s\S]*placeNormalCanvas\(targetBounds\)/);
  assert.doesNotMatch(start, /petWindow\.setBounds/);
  assert.match(placement, /const shape = docked \? layout\?\.dockedShape : layout\?\.dockShape/);
  assert.match(placement, /setPetWindowShape\(\[shape\]\)[\s\S]*movePetWindowTo\(layout\.dockCanvasBounds\)/);
  assert.match(placement, /petWindow\.setBounds\(\{ x, y, width, height \}, false\)/);
  assert.match(placement, /Math\.abs\(bounds\.width - size\.width\) <= 2/);
  assert.match(placement, /setPetWindowShape\(\[\]\)/);
  assert.doesNotMatch(finish, /petWindow\.setBounds/);
  assert.match(finish, /cancelDockWindowAnimation\(\)/);
  assert.match(finish, /setPetWindowShape\(\[dockState\.layout\.dockedShape\]\)/);
});

test('standing and dock drag startup never resize the native surface', () => {
  const dragHandlers = main.slice(
    main.indexOf("ipcMain.handle('pet:drag-start'"),
    main.indexOf("ipcMain.on('pet:drag-move'")
  );
  assert.doesNotMatch(dragHandlers, /petWindow\.setBounds/);
  assert.match(dragHandlers, /setPetWindowShape\(\[\]\)/);
  assert.match(dragHandlers, /placeNormalCanvas\(\{ \.\.\.next, \.\.\.configuredSize \}\)/);
});

test('fractional DPI movement uses one canonical fixed-size native rectangle', () => {
  const moveWindow = main.slice(
    main.indexOf('function movePetWindowTo'),
    main.indexOf('function matchesPetWindowSize')
  );
  assert.match(moveWindow, /const x = Math\.round\(bounds\.x\)/);
  assert.match(moveWindow, /const y = Math\.round\(bounds\.y\)/);
  assert.match(moveWindow, /const width = Math\.round\(bounds\.width\)/);
  assert.match(moveWindow, /const height = Math\.round\(bounds\.height\)/);
  assert.match(moveWindow, /Number\.isFinite\(x\)[\s\S]*Number\.isFinite\(height\)/);
  assert.match(moveWindow, /petWindow\.setBounds\(\{ x, y, width, height \}, false\)/);
  assert.doesNotMatch(moveWindow, /petWindow\.setPosition\(/);
});

test('every high-frequency drag move supplies the configured size', () => {
  const move = main.slice(
    main.indexOf("ipcMain.on('pet:drag-move'"),
    main.indexOf("ipcMain.handle('pet:drag-end'")
  );
  assert.match(move, /const fixedSize = dragSize \|\| WINDOW_SIZES\[settings\.size\]/);
  assert.equal((move.match(/movePetWindowTo\(\{ \.\.\.next, \.\.\.fixedSize \}\)/g) || []).length, 2);
  assert.doesNotMatch(move, /movePetWindowTo\(next\)/);
});

test('dock exit applies its final native bounds before playback and not at its endpoint', () => {
  const start = main.slice(
    main.indexOf('function startDockExitAnimation'),
    main.indexOf('function finishDockExit')
  );
  const finish = main.slice(
    main.indexOf('function finishDockExit'),
    main.indexOf('function resetDockState')
  );

  assert.match(start, /dockExitBounds\(edge\)[\s\S]*startDockWindowAnimation/);
  assert.match(finish, /cancelDockWindowAnimation\(\)/);
  assert.doesNotMatch(finish, /cancelDockWindowAnimation\(\{\s*finish:\s*true/);
  assert.match(
    finish,
    /const completedPlayback = dockState\.phase === 'leaving'[\s\S]*if \(\s*!completedPlayback && \([\s\S]*placeNormalCanvas/
  );
});

test('water and storm remain outside the fixed dock-canvas policy', () => {
  const actionMode = main.slice(
    main.indexOf('function setActionMode'),
    main.indexOf('function moveToCorner')
  );
  assert.match(actionMode, /if \(mode === 'water'\)[\s\S]*else \{[\s\S]*petWindow\.setBounds\(\{ \.\.\.fitted, width, height \}, false\)/);
});

test('transparent Windows window disables native resize and frame effects', () => {
  assert.match(main, /frame:\s*false,\s*resizable:\s*false,/);
  assert.match(main, /thickFrame:\s*false,/);
  assert.match(main, /roundedCorners:\s*false,/);
  assert.match(main, /backgroundMaterial:\s*'none',/);
  assert.doesNotMatch(main, /setResizable\(/);
  assert.doesNotMatch(main, /petWindow\.setPosition\(/);
});
