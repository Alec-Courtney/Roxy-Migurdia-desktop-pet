const pet = document.querySelector('#pet');
const bubble = document.querySelector('#bubble');
const sprite = document.querySelector('#sprite');
const dockPoster = document.querySelector('#dockPoster');
const frontHandoff = document.querySelector('#frontHandoff');
const waterTrail = document.querySelector('#waterTrail');
const rain = document.querySelector('#rain');
const animationManifest = globalThis.ROXY_ANIMATION_MANIFEST || { clips: {} };
const newAnimationRoot = '../assets/animations/new/';
const EDGE_REDOCK_QUIET_MS = 4000;

const petStates = new Set([
  'free',
  'entering-right',
  'entering-bottom',
  'docked-right',
  'docked-bottom',
  'leaving-right',
  'leaving-bottom',
  'dragging'
]);

// All dialogue and incantations below are verbatim from the supplied volume 1 translation.
const lines = [
  '我叫洛琪希，请多指教。',
  '你觉得如何？',
  '不，只要好好训练，每个人都能达到这种程度。',
  '好了，你试试看吧。',
  '就是会这样。',
  '恭喜，你成为水圣级了。'
];

const waterBallIncantation =
  '愿伟大的水之加护降临汝所求之处，清凉之浅流在此显现──『Water Ball』。';

const cumulonimbusIncantation = [
  '雄伟的水之精灵，登上天空的雷帝之王子啊！',
  '实现我的愿望，带来凶暴的恩惠，让矮小的存在见识您的力量！',
  '以神之铁锤敲击铁砧，显现您的可畏，让洪水淹没整片大地！',
  '啊，雨啊！冲垮一切，驱逐所有事物吧！',
  '『Cumulonimbus』！'
];

const frames = {
  front: '../assets/frames-unified/turn-front.png',
  side: '../assets/frames-unified/turn-side.png',
  back: '../assets/frames-unified/turn-back.png'
};

const animationFrameCounts = {
  wave: 30,
  hat: 30,
  water: 30,
  lift: 30
};

for (const [animation, count] of Object.entries(animationFrameCounts)) {
  for (let index = 1; index <= count; index += 1) {
    const number = String(index).padStart(2, '0');
    frames[`${animation}-${number}`] = `../assets/animations/${animation}/${animation}-${number}.png`;
  }
}

for (let index = 1; index <= 12; index += 1) {
  const number = String(index).padStart(2, '0');
  frames[`storm-${number}`] = `../assets/animations/storm-simple/storm-${number}.png`;
}

for (let index = 1; index <= 31; index += 1) {
  const number = String(index).padStart(2, '0');
  frames[`storm-raise-${number}`] =
    `../assets/animations/storm-raise/storm-raise-${number}.png`;
}

const bridgeNames = [
  'wave',
  'hat',
  'water',
  'lift',
  'storm',
  'front-side',
  'side-back'
];

for (const bridge of bridgeNames) {
  for (let index = 1; index <= 10; index += 1) {
    const number = String(index).padStart(2, '0');
    frames[`bridge-${bridge}-${number}`] =
      `../assets/animations/bridges/${bridge}/${bridge}-${number}.png`;
  }
}

function frameRange(name, start, end, duration = 34) {
  const direction = start <= end ? 1 : -1;
  const steps = [];
  for (let index = start; index !== end + direction; index += direction) {
    steps.push([`${name}-${String(index).padStart(2, '0')}`, duration]);
  }
  return steps;
}

function bridgeRange(name, start, end, duration = 34) {
  const direction = start <= end ? 1 : -1;
  const steps = [];
  for (let index = start; index !== end + direction; index += direction) {
    steps.push([`bridge-${name}-${String(index).padStart(2, '0')}`, duration]);
  }
  return steps;
}

function bridgedPingPong(name, hold = 0) {
  return [
    ...bridgeRange(name, 1, 10, 34),
    ...frameRange(name, 2, 30, 34),
    ...(hold ? [[`${name}-30`, hold]] : []),
    ...frameRange(name, 29, 1, 31),
    ...bridgeRange(name, 9, 1, 34)
  ];
}

const actionSequences = {
  wave: bridgedPingPong('wave', 150),
  hat: bridgedPingPong('hat', 280),
  look: [
    ...bridgeRange('front-side', 1, 10, 34),
    ['bridge-front-side-10', 620],
    ...bridgeRange('front-side', 9, 1, 34)
  ],
  turn: [
    ...bridgeRange('front-side', 1, 10, 34),
    ...bridgeRange('side-back', 2, 10, 34),
    ['bridge-side-back-10', 620],
    ...bridgeRange('side-back', 9, 1, 34),
    ...bridgeRange('front-side', 9, 1, 34)
  ]
};

const newActionNames = new Set(['braid', 'coquettish', 'stretch']);
const mediaToneFamilies = Object.freeze({
  'dock-right-enter': 'right',
  'dock-right-wave': 'right',
  'dock-right-exit': 'right',
  'dock-bottom-enter': 'bottom',
  'dock-bottom-wave': 'bottom',
  'dock-bottom-exit': 'bottom',
  braid: 'braid',
  coquettish: 'coquettish',
  stretch: 'stretch'
});
const loadedClips = new Map();
const loadedFrameSources = new Map();

let dragState = null;
let bubbleTimer;
let waterEffectTimer;
let stormEffectTimer;
let lastTap = 0;
let pendingTapTimer = 0;
let frameSequence = 0;
let interactionLocked = false;
let interactionLease = 0;
let interactionWatchdogTimer = 0;
let petState = 'free';
let stateRevision = 0;
let transientStateWatchdogTimer = 0;
let dockRecoveryPromise = null;
let activeDockEdge = null;
let activeDockDrag = null;
let dockWaveTimer = 0;
let activeDockWaveLease = 0;
let dockMotionLease = 0;
let dockPosterLease = 0;
let activeDockPosterLease = 0;
let standingHandoffLease = 0;
let autoRedockTimer = 0;
let autoRedockEdge = null;
let autoRedockLease = 0;
let autoRedockDelayRange = null;
let spellTimers = [];
let swayFrame = 0;
let swayAngle = 0;
let swayAngularVelocity = 0;
let dragVelocity = 0;
let swayLastTime = performance.now();
let currentLiftIndex = 1;
let currentLiftBridgeIndex = 1;
let imageSourceRequestId = 0;
const imageSourceRequests = new WeakMap();

pet.dataset.state = petState;

function say(text, duration = 3600) {
  window.clearTimeout(bubbleTimer);
  bubble.textContent = text;
  bubble.classList.add('is-visible');
  bubbleTimer = window.setTimeout(() => bubble.classList.remove('is-visible'), duration);
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function withTimeout(promise, milliseconds, label) {
  let timeout = 0;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timeout = window.setTimeout(
        () => reject(new Error(`${label} timed out after ${milliseconds}ms`)),
        milliseconds
      );
    })
  ]).finally(() => window.clearTimeout(timeout));
}

function dockVisualOwnsSprite() {
  return petState.startsWith('entering-')
    || petState.startsWith('docked-')
    || petState.startsWith('leaving-')
    || Boolean(activeDockDrag && !activeDockDrag.cancelled);
}

function absoluteImageSource(source) {
  return new URL(source, document.baseURI).href;
}

function cancelImageSourceRequest(image) {
  const request = imageSourceRequests.get(image);
  if (request?.cancel) request.cancel();
}

function setImageSource(image, source) {
  cancelImageSourceRequest(image);
  const id = ++imageSourceRequestId;
  imageSourceRequests.set(image, {
    id,
    expected: absoluteImageSource(source),
    cancel: null
  });
  image.src = source;
  return id;
}

function clearImageSource(image) {
  cancelImageSourceRequest(image);
  imageSourceRequests.set(image, {
    id: ++imageSourceRequestId,
    expected: '',
    cancel: null
  });
  image.removeAttribute('src');
}

function setFrame(name) {
  // A cached standing image must never take over a dock transition. This also
  // guards against a stale async action/finally callback that settles after a
  // dock transaction has already acquired the sprite.
  if (name === 'front' && dockVisualOwnsSprite()) return false;
  if (!frames[name]) return false;
  setImageSource(sprite, frames[name]);
  return true;
}

function getNewClip(name) {
  const clip = animationManifest.clips?.[name];
  if (!clip?.asset || !clip?.firstFrame || !clip?.lastFrame) {
    throw new Error(`Missing new animation clip: ${name}`);
  }
  return clip;
}

function clipSource(path) {
  return `${newAnimationRoot}${path}`;
}

function loadImage(source, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (loaded) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      image.removeEventListener('load', onLoad);
      image.removeEventListener('error', onError);
      resolve(loaded);
    };
    const onLoad = () => finish(true);
    const onError = () => finish(false);
    const timeout = window.setTimeout(() => finish(false), timeoutMs);
    image.addEventListener('load', onLoad, { once: true });
    image.addEventListener('error', onError, { once: true });
    image.src = source;
  });
}

function preloadClip(name) {
  if (!loadedClips.has(name)) {
    const clip = getNewClip(name);
    loadedClips.set(name, Promise.all([
      loadImage(clipSource(clip.asset)),
      loadImage(clipSource(clip.firstFrame)),
      loadImage(clipSource(clip.lastFrame))
    ]));
  }
  return loadedClips.get(name);
}

function preloadFrameSteps(steps) {
  const sources = new Set();
  for (const [name] of steps) {
    if (frames[name]) sources.add(frames[name]);
  }
  return Promise.all([...sources].map((source) => {
    if (!loadedFrameSources.has(source)) {
      loadedFrameSources.set(source, loadImage(source));
    }
    return loadedFrameSources.get(source);
  }));
}

function waitForImageSource(image, source, timeoutMs = 2400) {
  cancelImageSourceRequest(image);
  const id = ++imageSourceRequestId;
  const expected = absoluteImageSource(source);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (loaded) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      image.removeEventListener('load', onLoad);
      image.removeEventListener('error', onError);
      const active = imageSourceRequests.get(image);
      if (active?.id === id) {
        imageSourceRequests.set(image, { id, expected, cancel: null });
      }
      resolve(loaded);
    };
    const isCurrent = () => imageSourceRequests.get(image)?.id === id;
    const matchesExpected = () => image.currentSrc === expected;
    const onLoad = () => {
      if (!isCurrent()) {
        finish(false);
        return;
      }
      // An older cached request can still dispatch after a new src assignment.
      // Ignore it until the element reports the exact URL owned by this request.
      if (!matchesExpected()) return;
      finish(image.complete && image.naturalWidth > 0);
    };
    const onError = () => {
      if (!isCurrent() || matchesExpected()) finish(false);
    };
    const timeout = window.setTimeout(() => finish(false), timeoutMs);
    imageSourceRequests.set(image, { id, expected, cancel: () => finish(false) });
    image.addEventListener('load', onLoad);
    image.addEventListener('error', onError);
    image.src = source;
    if (image.complete) {
      queueMicrotask(() => {
        if (!isCurrent() || !matchesExpected()) return;
        finish(image.naturalWidth > 0);
      });
    }
  });
}

function waitForSpriteSource(source) {
  return waitForImageSource(sprite, source);
}

async function waitForSpritePaint(source) {
  const loaded = await waitForSpriteSource(source);
  if (!loaded) return false;
  try {
    await sprite.decode();
  } catch {
    // The load event is still a valid fallback for older/edge-case decoders.
  }
  await waitForCompositorPaint();
  // Setting img.src is synchronous, but Chromium may keep compositing the
  // previous decoded bitmap until the replacement is ready. Callers that move
  // or crop the native window must not proceed while currentSrc is still that
  // stale image.
  return sprite.currentSrc === absoluteImageSource(source);
}

async function waitForCompositorPaint() {
  const painted = new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
  });
  // requestAnimationFrame pauses for a hidden window; do not deadlock recovery.
  await Promise.race([painted, wait(100)]);
}

function dockPosterIsCurrent(lease) {
  return lease > 0 && activeDockPosterLease === lease;
}

function releaseDockPoster(lease) {
  if (!dockPosterIsCurrent(lease)) return false;
  activeDockPosterLease = 0;
  document.body.classList.remove('is-dock-poster');
  clearImageSource(dockPoster);
  return true;
}

function retainDockPoster(lease) {
  if (!dockPosterIsCurrent(lease)) return false;
  dockPosterLease += 1;
  activeDockPosterLease = 0;
  cancelImageSourceRequest(dockPoster);
  // Keep the last decoded poster and its class visible. A following motion can
  // replace this same element without ever exposing the sprite underneath.
  return true;
}

function takeOverDockPoster() {
  const wasVisible = document.body.classList.contains('is-dock-poster');
  dockPosterLease += 1;
  activeDockPosterLease = 0;
  cancelImageSourceRequest(dockPoster);
  return wasVisible;
}

function cancelDockPoster() {
  takeOverDockPoster();
  document.body.classList.remove('is-dock-poster');
  clearImageSource(dockPoster);
}

async function stageDockPoster(name, isCurrent = () => true) {
  const clip = getNewClip(name);
  const inheritedCover = document.body.classList.contains('is-dock-poster');
  const lease = ++dockPosterLease;
  activeDockPosterLease = lease;
  const abandon = () => (
    inheritedCover ? retainDockPoster(lease) : releaseDockPoster(lease)
  );
  const loaded = await waitForImageSource(
    dockPoster,
    clipSource(clip.firstFrame),
    10000
  );
  if (!loaded || !dockPosterIsCurrent(lease) || !isCurrent()) {
    abandon();
    return 0;
  }
  try {
    await dockPoster.decode();
  } catch {
    if (!dockPoster.complete || dockPoster.naturalWidth <= 0) {
      abandon();
      return 0;
    }
  }
  if (!dockPosterIsCurrent(lease) || !isCurrent()) {
    abandon();
    return 0;
  }
  document.body.classList.add('is-dock-poster');
  await waitForCompositorPaint();
  if (!dockPosterIsCurrent(lease) || !isCurrent()) {
    abandon();
    return 0;
  }
  return lease;
}

async function stageStandingHandoff(isCurrent = () => true) {
  const lease = ++standingHandoffLease;
  try {
    await frontHandoff.decode();
  } catch {
    if (!frontHandoff.complete || frontHandoff.naturalWidth <= 0) return 0;
  }
  if (lease !== standingHandoffLease) return 0;
  if (!isCurrent()) {
    cancelStandingHandoff(lease);
    return 0;
  }
  document.body.classList.add('is-front-handoff');
  await waitForCompositorPaint();
  if (lease !== standingHandoffLease) return 0;
  if (!isCurrent()) {
    cancelStandingHandoff(lease);
    return 0;
  }
  // The standing layer is above the dock poster and now owns a presented
  // frame, so the clip cover can be retired without exposing the sprite below.
  cancelDockPoster();
  const painted = await waitForSpritePaint(frames.front);
  if (lease !== standingHandoffLease) return 0;
  if (!painted || !isCurrent()) {
    cancelStandingHandoff(lease);
    return 0;
  }
  return lease;
}

async function commitStandingHandoff(geometry, lease) {
  if (
    lease !== standingHandoffLease
    || !document.body.classList.contains('is-front-handoff')
  ) return false;
  setPetState('free', geometry);
  setMediaMode(false);
  await waitForCompositorPaint();
  if (lease !== standingHandoffLease) return false;
  return cancelStandingHandoff(lease);
}

function cancelStandingHandoff(expectedLease) {
  if (expectedLease !== undefined && expectedLease !== standingHandoffLease) return false;
  standingHandoffLease += 1;
  document.body.classList.remove('is-front-handoff');
  return true;
}

function takeOverStandingHandoff() {
  const wasActive = document.body.classList.contains('is-front-handoff');
  // Invalidate a stage task that may still be decoding or waiting for paint,
  // while keeping an already visible cover in place for the recovery owner.
  standingHandoffLease += 1;
  return { wasActive, lease: standingHandoffLease };
}

async function recoverStandingVisual(geometry, isCurrent = () => true) {
  const lease = await stageStandingHandoff(isCurrent);
  if (lease) return commitStandingHandoff(geometry, lease);
  if (!isCurrent()) return false;

  // Decoder fallback: prepare the ordinary sprite while the last dock poster
  // remains above it, then switch layout and covers in the same JS task.
  const painted = await waitForSpritePaint(frames.front);
  if (!painted || !isCurrent()) return false;
  setPetState('free', geometry);
  setMediaMode(false);
  cancelDockPoster();
  const handoff = takeOverStandingHandoff();
  cancelStandingHandoff(handoff.lease);
  return true;
}

async function playNewClip(
  name,
  { holdLast = false, reset = true, dockPosterToken = 0 } = {}
) {
  const clip = getNewClip(name);
  setMediaTone(name);
  const sequence = ++frameSequence;
  const isDockClip = name.startsWith('dock-');
  let posterToken = dockPosterToken;
  try {
    if (!isDockClip) setImageSource(sprite, clipSource(clip.firstFrame));
    const preloadResult = await preloadClip(name);
    if (sequence !== frameSequence) return false;
    if (!preloadResult.some(Boolean)) throw new Error(`Could not load animation clip: ${name}`);

    if (isDockClip && !posterToken) {
      posterToken = await stageDockPoster(name, () => sequence === frameSequence);
      if (!posterToken) return false;
    } else if (isDockClip && !dockPosterIsCurrent(posterToken)) {
      return false;
    }

    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    if (sequence !== frameSequence) return false;
    const startedAt = performance.now();
    const animatedSource = `${clipSource(clip.asset)}#roxy-play-${sequence}-${Date.now()}`;
    const loaded = await waitForSpriteSource(animatedSource);
    if (sequence !== frameSequence) return false;
    if (!loaded) throw new Error(`Could not display animation clip: ${name}`);
    if (isDockClip) {
      // Keep the decoded poster above the animated image until Chromium has
      // committed the latter at the exact same geometry.
      await waitForCompositorPaint();
      if (sequence !== frameSequence) return false;
      releaseDockPoster(posterToken);
      posterToken = 0;
    }

    // Every packaged WebP is loop=1. Let a held clip finish naturally and keep
    // its final decoded canvas instead of swapping img.src at the endpoint.
    const settleAfterEnd = holdLast ? 34 : -45;
    const remaining = Math.max(
      0,
      Number(clip.durationMs || 0) + settleAfterEnd - (performance.now() - startedAt)
    );
    await wait(remaining);
    if (sequence !== frameSequence) return false;
    if (holdLast) {
      await waitForCompositorPaint();
      if (sequence !== frameSequence) return false;
    } else if (reset) {
      setFrame('front');
    }
    return true;
  } finally {
    // A dock poster may only be removed after the animated image has been
    // confirmed on the compositor path above. On cancellation or load failure,
    // the caller/recovery owner keeps it as the last known-good visual cover.
    if (posterToken && !isDockClip) releaseDockPoster(posterToken);
  }
}

function applyNormalGeometry(geometry) {
  if (!geometry) return;
  const normalWidth = geometry.normalWidth ?? geometry.width;
  const normalHeight = geometry.normalHeight ?? geometry.height;
  if (Number.isFinite(normalWidth)) {
    document.body.style.setProperty('--normal-width', `${normalWidth}px`);
  }
  if (Number.isFinite(normalHeight)) {
    document.body.style.setProperty('--normal-height', `${normalHeight}px`);
  }
}

function setMediaMode(enabled) {
  if (enabled && petState === 'free') {
    document.body.style.setProperty('--normal-width', `${window.innerWidth}px`);
    document.body.style.setProperty('--normal-height', `${window.innerHeight}px`);
  }
  document.body.classList.toggle('mode-media', enabled);
  if (!enabled) delete document.body.dataset.mediaTone;
}

function setMediaTone(clipName) {
  const family = mediaToneFamilies[clipName];
  if (family) document.body.dataset.mediaTone = family;
}

function edgeFromState(state = petState) {
  if (state.endsWith('-right')) return 'right';
  if (state.endsWith('-bottom')) return 'bottom';
  return null;
}

function clearTransientStateWatchdog() {
  window.clearTimeout(transientStateWatchdogTimer);
  transientStateWatchdogTimer = 0;
}

function armTransientStateWatchdog(state, revision = stateRevision) {
  clearTransientStateWatchdog();
  const timeoutMs = state === 'dragging'
    ? 5000
    : (state.startsWith('entering-') || state.startsWith('leaving-') ? 25000 : 0);
  if (!timeoutMs) return;
  transientStateWatchdogTimer = window.setTimeout(() => {
    transientStateWatchdogTimer = 0;
    if (petState !== state || stateRevision !== revision) return;
    const isCapturedPointerDrag = state === 'dragging'
      || (state.startsWith('leaving-') && Boolean(dragState?.fromDockEdge));
    if (isCapturedPointerDrag && dragState) {
      try {
        // Free drags and dock-exit drags may both stay pressed indefinitely.
        // As long as Chromium owns capture, keep observing instead of aborting.
        if (pet.hasPointerCapture(dragState.pointerId)) {
          armTransientStateWatchdog(state, revision);
          return;
        }
      } catch {
        // A failed capture query is treated as abandoned input below.
      }
    }
    console.error(`Recovering an unresponsive pet state: ${state}`);
    void recoverDockToFree(`${state} watchdog`);
  }, timeoutMs);
}

function setPetState(nextState, geometry) {
  if (!petStates.has(nextState)) throw new Error(`Unknown pet state: ${nextState}`);
  applyNormalGeometry(geometry);
  petState = nextState;
  stateRevision += 1;
  pet.dataset.state = nextState;
  const edge = edgeFromState(nextState);
  const dockMode = nextState.startsWith('entering-') || nextState.startsWith('docked-');
  document.body.classList.toggle('mode-dock', dockMode);
  document.body.classList.toggle('dock-right', dockMode && edge === 'right');
  document.body.classList.toggle('dock-bottom', dockMode && edge === 'bottom');
  if (dockMode) {
    setMediaMode(true);
    bubble.classList.remove('is-visible');
    pet.classList.remove('is-water-effect', 'is-storm-effect');
  }
  armTransientStateWatchdog(nextState, stateRevision);
}

function clearInteractionWatchdog() {
  window.clearTimeout(interactionWatchdogTimer);
  interactionWatchdogTimer = 0;
}

function acquireInteractionLock() {
  const lease = ++interactionLease;
  interactionLocked = true;
  clearInteractionWatchdog();
  interactionWatchdogTimer = window.setTimeout(() => {
    interactionWatchdogTimer = 0;
    if (!interactionLocked || lease !== interactionLease) return;
    console.error(`Recovering an expired interaction lock: ${lease}`);
    void recoverDockToFree(`interaction lock ${lease} watchdog`);
  }, 25000);
  return lease;
}

function releaseInteractionLock(lease) {
  if (lease !== interactionLease) return false;
  clearInteractionWatchdog();
  interactionLocked = false;
  return true;
}

function cancelInteractionLock() {
  clearInteractionWatchdog();
  interactionLease += 1;
  interactionLocked = false;
}

function clearPendingTap({ clearTimestamp = false } = {}) {
  window.clearTimeout(pendingTapTimer);
  pendingTapTimer = 0;
  if (clearTimestamp) lastTap = 0;
}

function cancelAutoRedock() {
  window.clearTimeout(autoRedockTimer);
  autoRedockTimer = 0;
  autoRedockEdge = null;
  autoRedockDelayRange = null;
  autoRedockLease += 1;
}

function deferAutoRedockForActivity() {
  const edge = autoRedockEdge;
  const delayRange = autoRedockDelayRange;
  if (!edge || !delayRange) return;
  scheduleAutoRedock(edge, delayRange);
}

function notePointerActivity({ clearTapTimestamp = false } = {}) {
  clearPendingTap({ clearTimestamp: clearTapTimestamp });
  // A tap without movement still leaves Roxy at the same candidate edge. Start
  // that edge's quiet period again; actual dragging cancels it in pointerMove.
  deferAutoRedockForActivity();
}

function cancelDockMotion() {
  window.clearTimeout(dockWaveTimer);
  dockWaveTimer = 0;
  activeDockWaveLease = 0;
  dockMotionLease += 1;
  frameSequence += 1;
  takeOverDockPoster();
}

function showDockPose(edge) {
  try {
    setMediaTone(`dock-${edge}-enter`);
    const clip = getNewClip(`dock-${edge}-enter`);
    setImageSource(sprite, clipSource(clip.lastFrame));
    cancelDockPoster();
  } catch (error) {
    console.error(error);
    setFrame('front');
  }
}

async function playFrames(steps, onFrame, { reset = true } = {}) {
  const sequence = ++frameSequence;
  await preloadFrameSteps(steps);
  if (sequence !== frameSequence) return false;
  for (let index = 0; index < steps.length; index += 1) {
    if (sequence !== frameSequence) return false;
    const [name, duration] = steps[index];
    setFrame(name);
    if (onFrame) onFrame(name, index);
    await wait(duration);
  }
  if (sequence === frameSequence && reset) setFrame('front');
  return sequence === frameSequence;
}

async function performAction(name) {
  const isNewAction = newActionNames.has(name);
  if (
    interactionLocked ||
    petState !== 'free' ||
    (!isNewAction && !actionSequences[name])
  ) {
    return;
  }

  const lease = acquireInteractionLock();
  try {
    if (isNewAction) {
      setMediaMode(true);
      await playNewClip(name);
    } else {
      await playFrames(actionSequences[name]);
    }
  } catch (error) {
    console.error(`Action ${name} failed:`, error);
  } finally {
    if (releaseInteractionLock(lease) && petState === 'free') {
      if (isNewAction) setMediaMode(false);
      setFrame('front');
    }
  }
}

function clearSpellTimers() {
  for (const timer of spellTimers) window.clearTimeout(timer);
  spellTimers = [];
}

async function applyActionMode(mode) {
  const geometry = await window.roxy.setActionMode(mode);
  document.body.classList.toggle('mode-water', mode === 'water');
  document.body.classList.toggle('mode-storm', mode === 'storm');
  if (geometry) {
    document.body.style.setProperty('--normal-width', `${geometry.normalWidth}px`);
    document.body.style.setProperty('--normal-height', `${geometry.normalHeight}px`);
    document.body.style.setProperty(
      '--action-character-left',
      `${geometry.characterOffsetX ?? 0}px`
    );
    document.body.style.setProperty(
      '--action-character-top',
      `${geometry.characterOffsetY ?? 0}px`
    );
  }
}

function fillWaterTrail() {
  waterTrail.replaceChildren();
  for (let index = 0; index < 20; index += 1) {
    const drop = document.createElement('i');
    drop.style.setProperty('--size', `${3 + Math.random() * 5}px`);
    drop.style.setProperty('--delay', `${390 + Math.random() * 360}ms`);
    drop.style.setProperty('--travel', `${50 + Math.random() * 135}px`);
    drop.style.setProperty('--fall', `${-16 + Math.random() * 44}px`);
    waterTrail.append(drop);
  }
}

function startWaterEffect() {
  fillWaterTrail();
  pet.classList.remove('is-water-effect');
  void pet.offsetWidth;
  pet.classList.add('is-water-effect');
  window.clearTimeout(waterEffectTimer);
  waterEffectTimer = window.setTimeout(() => pet.classList.remove('is-water-effect'), 1400);
}

function fillRain() {
  rain.replaceChildren();
  const stormWidth = Math.max(window.innerWidth, 320);
  for (let index = 0; index < 116; index += 1) {
    const drop = document.createElement('i');
    drop.style.setProperty('--x', `${2 + Math.random() * 98}%`);
    drop.style.setProperty('--length', `${20 + Math.random() * 31}px`);
    drop.style.setProperty('--duration', `${430 + Math.random() * 260}ms`);
    drop.style.setProperty('--delay', `${-Math.random() * 1200}ms`);
    drop.style.setProperty('--wind-shift', `${-Math.round(stormWidth * (0.52 + Math.random() * 0.16))}px`);
    drop.style.setProperty('--rain-lean', `${22 + Math.random() * 5}deg`);
    rain.append(drop);
  }
}

function startStormEffect() {
  fillRain();
  pet.classList.remove('is-storm-effect');
  void pet.offsetWidth;
  pet.classList.add('is-storm-effect');
  window.clearTimeout(stormEffectTimer);
  stormEffectTimer = window.setTimeout(() => pet.classList.remove('is-storm-effect'), 3100);
}

async function castWaterBall() {
  if (interactionLocked || petState !== 'free') return;
  const lease = acquireInteractionLock();
  clearSpellTimers();
  frameSequence += 1;
  try {
    await applyActionMode('water');
    say(waterBallIncantation, 5200);

    const steps = [
      ...bridgeRange('water', 1, 10, 34),
      ...frameRange('water', 2, 30, 34),
      ['water-30', 180],
      ...frameRange('water', 29, 1, 30),
      ...bridgeRange('water', 9, 1, 34)
    ];
    let effectStarted = false;
    await playFrames(steps, (name) => {
      if (!effectStarted && name === 'water-17') {
        effectStarted = true;
        startWaterEffect();
      }
    });
  } catch (error) {
    console.error('Water Ball animation failed:', error);
  } finally {
    if (lease === interactionLease) {
      pet.classList.remove('is-water-effect');
      try {
        await applyActionMode('normal');
      } catch (error) {
        console.error('Could not restore the normal window after Water Ball:', error);
      }
      if (releaseInteractionLock(lease)) {
        setFrame('front');
      }
    }
  }
}

async function castCumulonimbus() {
  if (interactionLocked || petState !== 'free') return;
  const lease = acquireInteractionLock();
  clearSpellTimers();
  frameSequence += 1;
  try {
    await applyActionMode('storm');

    // The short desktop action keeps the authentic spell name without inventing
    // an abridged chant. The full supplied incantation remains above as source text.
    say(cumulonimbusIncantation.at(-1), 2900);
    const steps = [
      ...bridgeRange('storm', 1, 10, 34),
      ...frameRange('storm', 2, 12, 34),
      ...frameRange('storm-raise', 2, 31, 34),
      ['storm-raise-31', 520],
      ...frameRange('storm-raise', 30, 1, 31),
      ...frameRange('storm', 11, 1, 34),
      ...bridgeRange('storm', 9, 1, 34)
    ];
    let effectStarted = false;
    await playFrames(steps, (name) => {
      if (!effectStarted && name === 'storm-raise-19') {
        effectStarted = true;
        startStormEffect();
      }
    });
  } catch (error) {
    console.error('Cumulonimbus animation failed:', error);
  } finally {
    if (lease === interactionLease) {
      clearSpellTimers();
      pet.classList.remove('is-storm-effect');
      try {
        await applyActionMode('normal');
      } catch (error) {
        console.error('Could not restore the normal window after Cumulonimbus:', error);
      }
      if (releaseInteractionLock(lease)) {
        setFrame('front');
      }
    }
  }
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function getSwayTargetAngle(horizontalVelocity) {
  // CSS positive rotation moves the body below the neck pivot to the left.
  // That makes the character lag opposite the cursor's horizontal velocity.
  return clamp(horizontalVelocity * 0.016, -13, 13);
}

function updateSway(now) {
  const delta = Math.min((now - swayLastTime) / 1000, 0.05);
  swayLastTime = now;
  dragVelocity *= Math.exp(-delta * 5.8);
  const desiredAngle = dragState?.lifted ? getSwayTargetAngle(dragVelocity) : 0;
  const acceleration = (desiredAngle - swayAngle) * 68 - swayAngularVelocity * 11.5;
  swayAngularVelocity += acceleration * delta;
  swayAngle = clamp(swayAngle + swayAngularVelocity * delta, -14.5, 14.5);
  document.body.style.setProperty('--drag-angle', `${swayAngle.toFixed(3)}deg`);
  document.body.style.setProperty('--drag-bob', `${(Math.abs(swayAngle) * 0.12).toFixed(2)}px`);

  if (document.body.classList.contains('is-lifted')) {
    swayFrame = window.requestAnimationFrame(updateSway);
  } else {
    swayAngle = 0;
    swayAngularVelocity = 0;
    dragVelocity = 0;
    document.body.style.setProperty('--drag-angle', '0deg');
    document.body.style.setProperty('--drag-bob', '0px');
    swayFrame = 0;
  }
}

function startSway() {
  if (swayFrame) return;
  swayLastTime = performance.now();
  swayFrame = window.requestAnimationFrame(updateSway);
}

function scheduleDockWave(edge) {
  window.clearTimeout(dockWaveTimer);
  if (petState !== `docked-${edge}`) return;
  const delay = 12000 + Math.random() * 14000;
  dockWaveTimer = window.setTimeout(async () => {
    dockWaveTimer = 0;
    if (petState !== `docked-${edge}`) return;
    if (dragState || interactionLocked) {
      scheduleDockWave(edge);
      return;
    }
    const motionLease = ++dockMotionLease;
    activeDockWaveLease = motionLease;
    try {
      await playNewClip(`dock-${edge}-wave`, { holdLast: true });
    } catch (error) {
      console.error(`Dock ${edge} wave failed:`, error);
    } finally {
      if (activeDockWaveLease === motionLease) activeDockWaveLease = 0;
      if (motionLease === dockMotionLease && petState === `docked-${edge}`) {
        scheduleDockWave(edge);
      }
    }
  }, delay);
}

function recoverDockToFree(context) {
  if (dockRecoveryPromise) return dockRecoveryPromise;
  takeOverStandingHandoff();
  const abandonedDrag = dragState;
  const abandonedDockDrag = activeDockDrag;
  if (abandonedDrag) abandonedDrag.cancelled = true;
  if (abandonedDockDrag) abandonedDockDrag.cancelled = true;
  clearPendingTap({ clearTimestamp: true });
  cancelAutoRedock();
  cancelDockMotion();
  cancelInteractionLock();
  const recoveryLockLease = acquireInteractionLock();
  if (abandonedDrag?.longPressTimer) window.clearTimeout(abandonedDrag.longPressTimer);
  dragState = null;
  activeDockDrag = null;
  document.body.classList.remove('is-dragging', 'is-lifted', 'mode-water', 'mode-storm');
  if (abandonedDrag) {
    try {
      window.roxy.setDragLift(false, abandonedDrag.screenX, abandonedDrag.screenY);
    } catch {
      // Continue local recovery even if the preload bridge is being torn down.
    }
    try {
      if (pet.hasPointerCapture(abandonedDrag.pointerId)) {
        pet.releasePointerCapture(abandonedDrag.pointerId);
      }
    } catch {
      // Pointer capture may already have been released by the browser or OS.
    }
  }
  dockRecoveryPromise = (async () => {
    let geometry = null;
    try {
      geometry = await withTimeout(window.roxy.resetDock(), 5000, 'dock reset IPC');
      applyNormalGeometry(geometry);
    } catch (error) {
      console.error(`Could not recover the dock state (${context}):`, error);
    }
    if (recoveryLockLease !== interactionLease) return false;
    const settled = await recoverStandingVisual(
      geometry,
      () => recoveryLockLease === interactionLease
    );
    if (settled) activeDockEdge = null;
    return Boolean(geometry && settled);
  })().finally(() => {
    releaseInteractionLock(recoveryLockLease);
    dockRecoveryPromise = null;
  });
  return dockRecoveryPromise;
}

async function enterDock(edge, geometry) {
  if (!['right', 'bottom'].includes(edge)) return false;
  cancelAutoRedock();
  cancelDockMotion();
  activeDockEdge = edge;
  const clipName = `dock-${edge}-enter`;
  const clip = getNewClip(clipName);
  // `is-dock-poster` atomically applies the same full-canvas layout as
  // mode-media. Seed its dimensions before the decoded poster becomes visible;
  // the free-state sprite remains untouched and hidden underneath the poster.
  applyNormalGeometry(geometry);
  setMediaTone(clipName);
  const motionLease = ++dockMotionLease;
  const lockLease = acquireInteractionLock();
  let revision = stateRevision;
  let rendererEnterStarted = false;
  let dockedGeometry = null;
  let mainEnterStarted = false;
  let clipPosterToken = 0;
  try {
    // Keep the normal layout in place while the complete clip is cached. Its
    // first frame is presented on an independent layer, never by replacing the
    // currently visible sprite before the native shape/position transaction.
    const preloadResult = await preloadClip(clipName);
    if (!preloadResult[1]) throw new Error(`Could not preload ${edge} dock entry poster`);
    clipPosterToken = await stageDockPoster(clipName, () => (
      revision === stateRevision
      && motionLease === dockMotionLease
      && petState === 'free'
      && lockLease === interactionLease
    ));
    if (!clipPosterToken) throw new Error(`Could not present ${edge} dock entry poster`);
    if (
      revision !== stateRevision ||
      motionLease !== dockMotionLease ||
      petState !== 'free' ||
      lockLease !== interactionLease
    ) {
      releaseDockPoster(clipPosterToken);
      releaseInteractionLock(lockLease);
      return false;
    }

    setPetState(`entering-${edge}`, geometry);
    rendererEnterStarted = true;
    revision = stateRevision;
    armTransientStateWatchdog(`entering-${edge}`, revision);
    const started = await window.roxy.startDockEnter(
      edge,
      Math.max(180, clip.durationMs - 45)
    );
    if (!started) throw new Error(`Main process rejected ${edge} dock entry`);
    mainEnterStarted = true;
    // Keep the first poster through the native window placement. Starting the
    // WebP in the same compositor turn can expose its standing-like first frame
    // in the newly uncovered part of the window.
    await waitForCompositorPaint();
    if (
      revision !== stateRevision ||
      motionLease !== dockMotionLease ||
      petState !== `entering-${edge}` ||
      lockLease !== interactionLease
    ) {
      retainDockPoster(clipPosterToken);
      releaseInteractionLock(lockLease);
      return false;
    }
    armTransientStateWatchdog(`entering-${edge}`, revision);
    await playNewClip(`dock-${edge}-enter`, {
      holdLast: true,
      dockPosterToken: clipPosterToken
    });
    clipPosterToken = 0;
  } catch (error) {
    if (clipPosterToken) retainDockPoster(clipPosterToken);
    console.error(`Dock ${edge} entry failed:`, error);
    if (!mainEnterStarted) {
      let restoredGeometry = geometry;
      try {
        restoredGeometry = await window.roxy.cancelPreparedDock(edge) || geometry;
      } catch (restoreError) {
        console.error(`Could not cancel the ${edge} dock preparation:`, restoreError);
      }
      if (
        revision === stateRevision &&
        motionLease === dockMotionLease &&
        petState === (rendererEnterStarted ? `entering-${edge}` : 'free') &&
        lockLease === interactionLease
      ) {
        activeDockEdge = null;
        if (rendererEnterStarted) setPetState('free', restoredGeometry);
        else applyNormalGeometry(restoredGeometry);
        setMediaMode(false);
        setFrame('front');
        await waitForSpritePaint(frames.front);
        cancelDockPoster();
        releaseInteractionLock(lockLease);
      }
      return false;
    }
  }

  if (
    revision !== stateRevision ||
    motionLease !== dockMotionLease ||
    petState !== `entering-${edge}` ||
    lockLease !== interactionLease
  ) return false;

  try {
    dockedGeometry = await window.roxy.finishDockEnter(edge);
    if (dockedGeometry) await waitForCompositorPaint();
  } catch (error) {
    console.error(`Could not finish the ${edge} dock entry:`, error);
  }

  if (
    revision !== stateRevision ||
    motionLease !== dockMotionLease ||
    petState !== `entering-${edge}` ||
    !releaseInteractionLock(lockLease)
  ) return false;

  if (!dockedGeometry) {
    await recoverDockToFree(`${edge} enter completion`);
    return false;
  }

  setPetState(`docked-${edge}`, dockedGeometry);
  scheduleDockWave(edge);
  return true;
}

function scheduleAutoRedock(
  edge,
  { minDelay = EDGE_REDOCK_QUIET_MS, maxDelay = EDGE_REDOCK_QUIET_MS } = {}
) {
  const lower = Math.max(0, Number(minDelay) || 0);
  const upper = Math.max(lower, Number(maxDelay) || lower);
  cancelAutoRedock();
  autoRedockEdge = edge;
  autoRedockDelayRange = { minDelay: lower, maxDelay: upper };
  const lease = autoRedockLease;
  const attempt = async () => {
    autoRedockTimer = 0;
    if (lease !== autoRedockLease || autoRedockEdge !== edge) return;
    if (petState !== 'free' || dragState || interactionLocked) {
      autoRedockTimer = window.setTimeout(attempt, 1000);
      return;
    }

    const lockLease = acquireInteractionLock();
    try {
      const geometry = await window.roxy.redock(edge);
      if (lease !== autoRedockLease || autoRedockEdge !== edge) {
        try {
          if (geometry) await window.roxy.cancelPreparedDock(edge);
        } finally {
          releaseInteractionLock(lockLease);
        }
        return;
      }
      autoRedockEdge = null;
      autoRedockDelayRange = null;
      if (!releaseInteractionLock(lockLease)) return;
      if (geometry) await enterDock(edge, geometry);
    } catch (error) {
      if (lease === autoRedockLease) {
        autoRedockEdge = null;
        autoRedockDelayRange = null;
      }
      releaseInteractionLock(lockLease);
      console.error(`Could not return to the ${edge} dock:`, error);
    }
  };
  autoRedockTimer = window.setTimeout(attempt, lower + Math.random() * (upper - lower));
}

async function leaveDock(edge) {
  cancelDockMotion();
  const clipName = `dock-${edge}-exit`;
  setMediaTone(clipName);
  const clip = getNewClip(clipName);
  setPetState(`leaving-${edge}`);
  setMediaMode(true);
  const revision = stateRevision;
  const motionLease = ++dockMotionLease;
  const lockLease = acquireInteractionLock();
  let geometry = null;
  let clipPosterToken = 0;
  try {
    await preloadClip(clipName);
    clipPosterToken = await stageDockPoster(clipName, () => (
      revision === stateRevision
      && motionLease === dockMotionLease
      && petState === `leaving-${edge}`
      && lockLease === interactionLease
    ));
    if (!clipPosterToken) throw new Error(`Could not present ${edge} dock exit poster`);
    if (
      revision !== stateRevision ||
      motionLease !== dockMotionLease ||
      petState !== `leaving-${edge}` ||
      lockLease !== interactionLease
    ) {
      retainDockPoster(clipPosterToken);
      releaseInteractionLock(lockLease);
      return false;
    }
    armTransientStateWatchdog(`leaving-${edge}`, revision);
    const started = await window.roxy.startDockExit(
      edge,
      Math.max(180, clip.durationMs - 45)
    );
    if (!started) throw new Error(`Main process rejected ${edge} dock exit`);
    // Let the position/shape transaction commit while the exact exit poster
    // still owns the visible pixels, then begin animated playback.
    await waitForCompositorPaint();
    if (
      revision !== stateRevision ||
      motionLease !== dockMotionLease ||
      petState !== `leaving-${edge}` ||
      lockLease !== interactionLease
    ) {
      retainDockPoster(clipPosterToken);
      releaseInteractionLock(lockLease);
      return false;
    }
    armTransientStateWatchdog(`leaving-${edge}`, revision);
    await playNewClip(clipName, {
      holdLast: true,
      dockPosterToken: clipPosterToken
    });
    clipPosterToken = 0;
  } catch (error) {
    if (clipPosterToken) retainDockPoster(clipPosterToken);
    console.error(`Dock ${edge} exit failed:`, error);
  }

  if (
    revision !== stateRevision ||
    motionLease !== dockMotionLease ||
    petState !== `leaving-${edge}` ||
    lockLease !== interactionLease
  ) return false;

  try {
    geometry = await window.roxy.finishDockExit(edge);
    if (geometry) await waitForCompositorPaint();
  } catch (error) {
    console.error(`Could not finish the ${edge} dock exit:`, error);
  }

  if (
    revision !== stateRevision ||
    motionLease !== dockMotionLease ||
    petState !== `leaving-${edge}` ||
    lockLease !== interactionLease
  ) return false;

  if (!geometry) {
    await recoverDockToFree(`${edge} exit completion`);
    return false;
  }

  const standingLease = await stageStandingHandoff(() => (
    revision === stateRevision
    && motionLease === dockMotionLease
    && petState === `leaving-${edge}`
    && lockLease === interactionLease
  ));
  if (!standingLease) {
    await recoverDockToFree(`${edge} standing handoff`);
    return false;
  }
  if (
    revision !== stateRevision ||
    motionLease !== dockMotionLease ||
    petState !== `leaving-${edge}` ||
    lockLease !== interactionLease
  ) {
    cancelStandingHandoff(standingLease);
    return false;
  }

  activeDockEdge = null;
  const committed = await commitStandingHandoff(geometry, standingLease);
  if (!committed) {
    if (lockLease === interactionLease) {
      releaseInteractionLock(lockLease);
      await recoverDockToFree(`${edge} standing commit`);
    }
    return false;
  }
  if (!releaseInteractionLock(lockLease)) return false;
  scheduleAutoRedock(edge);
  return true;
}

async function settleDragResult(result) {
  activeDockEdge = null;
  setPetState('free', result);
  setMediaMode(false);
  const pendingDockEdge = result?.pendingDockEdge;
  if (pendingDockEdge === 'right' || pendingDockEdge === 'bottom') {
    scheduleAutoRedock(pendingDockEdge);
    return true;
  }
  return false;
}

async function finishDraggedDockExit(finishedDrag) {
  const edge = finishedDrag.fromDockEdge;
  if (petState !== `leaving-${edge}`) setPetState(`leaving-${edge}`);
  setMediaMode(true);
  const revision = stateRevision;
  const lockLease = acquireInteractionLock();
  let standingLease = 0;
  try {
    await finishedDrag.exitPromise;
    await waitForCompositorPaint();
    if (revision === stateRevision && petState === `leaving-${edge}`) {
      standingLease = await stageStandingHandoff(() => (
        revision === stateRevision
        && petState === `leaving-${edge}`
        && lockLease === interactionLease
      ));
    }
  } catch (error) {
    console.error(`Dock ${edge} dragged exit failed:`, error);
  } finally {
    if (activeDockDrag === finishedDrag) activeDockDrag = null;
    if (
      revision === stateRevision &&
      petState === `leaving-${edge}` &&
      standingLease &&
      lockLease === interactionLease
    ) {
      activeDockEdge = null;
      const committed = await commitStandingHandoff(undefined, standingLease);
      if (committed) {
        releaseInteractionLock(lockLease);
      } else if (lockLease === interactionLease) {
        releaseInteractionLock(lockLease);
        await recoverDockToFree(`${edge} dragged standing commit`);
      }
    } else if (
      revision === stateRevision
      && petState === `leaving-${edge}`
      && lockLease === interactionLease
    ) {
      // A reset/recovery may have taken ownership of an already visible cover
      // while this async exit was waiting. Only the original owner may clear it.
      if (standingLease) cancelStandingHandoff(standingLease);
      releaseInteractionLock(lockLease);
      await recoverDockToFree(`${edge} dragged standing handoff`);
    }
  }
}

function resetDock(geometry) {
  takeOverStandingHandoff();
  clearPendingTap({ clearTimestamp: true });
  cancelAutoRedock();
  cancelDockMotion();
  cancelInteractionLock();
  if (dragState?.longPressTimer) window.clearTimeout(dragState.longPressTimer);
  if (dragState) dragState.cancelled = true;
  if (activeDockDrag) activeDockDrag.cancelled = true;
  dragState = null;
  activeDockDrag = null;
  document.body.classList.remove('is-dragging', 'is-lifted', 'mode-water', 'mode-storm');
  const lockLease = acquireInteractionLock();
  void recoverStandingVisual(geometry, () => lockLease === interactionLease)
    .then((settled) => {
      if (settled) activeDockEdge = null;
    })
    .finally(() => releaseInteractionLock(lockLease));
}

function queueTapAction() {
  const now = Date.now();
  if (now - lastTap < 320) {
    clearPendingTap({ clearTimestamp: true });
    castWaterBall();
    return;
  }

  lastTap = now;
  pendingTapTimer = window.setTimeout(() => {
    pendingTapTimer = 0;
    if (lastTap !== now || petState !== 'free') return;
    const actions = ['hat', 'stretch', 'wave', 'braid', 'coquettish'];
    performAction(actions[Math.floor(Math.random() * actions.length)]);
    lastTap = 0;
  }, 330);
}

async function runLiftFrames(pointerId) {
  const sequence = ++frameSequence;
  const liftSteps = [
    ...bridgeRange('lift', 1, 10, 34),
    ...frameRange('lift', 1, 30, 34)
  ];
  await preloadFrameSteps(liftSteps);
  if (sequence !== frameSequence) return;

  currentLiftIndex = 1;
  currentLiftBridgeIndex = 1;
  for (const [name, duration] of bridgeRange('lift', 1, 10, 34)) {
    if (sequence !== frameSequence || !dragState?.lifted || dragState.pointerId !== pointerId) return;
    currentLiftBridgeIndex = Number(name.slice(-2));
    setFrame(name);
    await wait(duration);
  }

  for (const [name, duration] of frameRange('lift', 2, 18, 32)) {
    if (sequence !== frameSequence || !dragState?.lifted || dragState.pointerId !== pointerId) return;
    currentLiftIndex = Number(name.slice(-2));
    setFrame(name);
    await wait(duration);
  }

  const loop = [
    ...frameRange('lift', 18, 30, 34),
    ...frameRange('lift', 29, 18, 34)
  ];
  while (sequence === frameSequence && dragState?.lifted && dragState.pointerId === pointerId) {
    for (const [name, duration] of loop) {
      if (sequence !== frameSequence || !dragState?.lifted) return;
      currentLiftIndex = Number(name.slice(-2));
      setFrame(name);
      await wait(duration);
    }
  }
}

function activateLift(pointerId) {
  if (
    !dragState ||
    dragState.pointerId !== pointerId ||
    dragState.fromDockEdge ||
    dragState.moved ||
    interactionLocked
  ) return;
  dragState.lifted = true;
  document.body.classList.add('is-lifted');
  window.roxy.setDragLift(true, dragState.screenX, dragState.screenY);
  startSway();
  runLiftFrames(pointerId);
}

function startDockWindowDrag(pointerId) {
  const currentDrag = dragState;
  if (
    !currentDrag ||
    currentDrag.pointerId !== pointerId ||
    !currentDrag.fromDockEdge ||
    currentDrag.cancelled ||
    currentDrag.dockDragStarted
  ) return currentDrag?.startPromise;

  currentDrag.dockDragStarted = true;
  activeDockDrag = currentDrag;
  const edge = currentDrag.fromDockEdge;
  const isLiveDockDrag = () => (
    !currentDrag.cancelled
    && activeDockDrag === currentDrag
    && (dragState === currentDrag || currentDrag.released)
  );
  const clipName = `dock-${edge}-exit`;
  setMediaTone(clipName);
  currentDrag.dockPosterToken = 0;
  currentDrag.startPromise = preloadClip(clipName)
    .then(() => stageDockPoster(clipName, isLiveDockDrag))
    .then((posterToken) => {
      if (!posterToken) throw new Error(`Could not present ${edge} dock drag-exit poster`);
      currentDrag.dockPosterToken = posterToken;
      if (!isLiveDockDrag()) {
        retainDockPoster(posterToken);
        currentDrag.dockPosterToken = 0;
        return null;
      }
      return window.roxy.startDockDrag(edge, currentDrag.screenX, currentDrag.screenY);
    })
    .then(async (dragSize) => {
      if (!isLiveDockDrag()) {
        retainDockPoster(currentDrag.dockPosterToken);
        currentDrag.dockPosterToken = 0;
        currentDrag.startFailed = true;
        if (dragSize) await recoverDockToFree(`${edge} dock drag cancelled during startup`);
        return null;
      }
      if (!dragSize) {
        retainDockPoster(currentDrag.dockPosterToken);
        currentDrag.dockPosterToken = 0;
        currentDrag.ready = false;
        currentDrag.startFailed = true;
        return null;
      }
      currentDrag.ready = Boolean(dragSize);
      currentDrag.startFailed = !dragSize;
      if (dragState?.pointerId === pointerId) {
        applyNormalGeometry(dragSize);
        if (currentDrag.ready) {
          window.roxy.moveDrag(currentDrag.screenX, currentDrag.screenY);
        }
      }
      return dragSize;
    })
    .catch((error) => {
      retainDockPoster(currentDrag.dockPosterToken);
      currentDrag.dockPosterToken = 0;
      currentDrag.startFailed = true;
      if (!currentDrag.cancelled) {
        console.error(`Could not start dragging from the ${edge} dock:`, error);
      }
      return null;
    });
  currentDrag.exitPromise = currentDrag.startPromise
    .then(async (dragSize) => {
      if (!dragSize || !isLiveDockDrag()) {
        retainDockPoster(currentDrag.dockPosterToken);
        currentDrag.dockPosterToken = 0;
        return false;
      }
      await waitForCompositorPaint();
      if (!isLiveDockDrag()) {
        retainDockPoster(currentDrag.dockPosterToken);
        currentDrag.dockPosterToken = 0;
        return false;
      }
      const played = await playNewClip(clipName, {
        holdLast: true,
        dockPosterToken: currentDrag.dockPosterToken
      });
      currentDrag.dockPosterToken = 0;
      return played;
    })
    .catch((error) => {
      retainDockPoster(currentDrag.dockPosterToken);
      currentDrag.dockPosterToken = 0;
      if (dragState?.pointerId === pointerId) {
        console.error(`Dock ${edge} drag-exit animation failed:`, error);
      }
      return false;
    });
  return currentDrag.startPromise;
}

function recoverAbandonedPointerDrag(context, pointerId = dragState?.pointerId) {
  if (!dragState || dragState.pointerId !== pointerId) return;
  console.error(`Recovering an abandoned pointer drag: ${context}`);
  void recoverDockToFree(context);
}

async function pointerDown(event) {
  notePointerActivity({ clearTapTimestamp: event.button !== 0 });
  if (event.button !== 0 || interactionLocked || dragState || dockRecoveryPromise) return;
  const dockEdge = petState.startsWith('docked-')
    ? (activeDockEdge || edgeFromState())
    : null;
  if (petState !== 'free' && !dockEdge) return;

  if (dockEdge) {
    cancelDockMotion();
  } else {
    frameSequence += 1;
    setMediaMode(false);
    setFrame('front');
  }

  dragState = {
    pointerId: event.pointerId,
    startX: event.screenX,
    startY: event.screenY,
    screenX: event.screenX,
    screenY: event.screenY,
    lastX: event.screenX,
    lastTime: performance.now(),
    moved: false,
    lifted: false,
    ready: false,
    fromDockEdge: dockEdge,
    dockDragStarted: false,
    startFailed: false,
    startPromise: Promise.resolve(null),
    exitPromise: Promise.resolve(false),
    released: false,
    cancelled: false,
    longPressTimer: 0
  };
  activeDockDrag = dockEdge ? dragState : null;
  if (!dockEdge) setPetState('dragging');
  try {
    pet.setPointerCapture(event.pointerId);
  } catch (error) {
    console.error('Could not capture the drag pointer:', error);
    recoverAbandonedPointerDrag('pointer capture failed', event.pointerId);
    return;
  }
  document.body.classList.add('is-dragging');
  if (!dockEdge) {
    dragState.longPressTimer = window.setTimeout(() => activateLift(event.pointerId), 280);
  } else {
    return;
  }

  const startingDrag = dragState;
  try {
    const startPromise = window.roxy.startDrag(event.screenX, event.screenY);
    startingDrag.startPromise = startPromise;
    const dragSize = await startPromise;
    startingDrag.ready = Boolean(dragSize);
    startingDrag.startFailed = !dragSize;
    if (dragState?.pointerId === event.pointerId) {
      applyNormalGeometry(dragSize);
      if (dragState.lifted) {
        window.roxy.setDragLift(true, dragState.screenX, dragState.screenY);
      }
      if (dragState.ready && dragState.moved) {
        window.roxy.moveDrag(dragState.screenX, dragState.screenY);
      }
    }
  } catch (error) {
    startingDrag.startFailed = true;
    console.error('Could not start dragging:', error);
    if (dragState?.pointerId === event.pointerId) {
      recoverAbandonedPointerDrag('free drag start IPC failed', event.pointerId);
    }
  }
}

function pointerMove(event) {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  notePointerActivity();
  const now = performance.now();
  const elapsed = Math.max(1, now - dragState.lastTime);
  const velocity = ((event.screenX - dragState.lastX) / elapsed) * 1000;
  dragVelocity = dragVelocity * 0.4 + velocity * 0.6;
  dragState.lastX = event.screenX;
  dragState.lastTime = now;
  dragState.screenX = event.screenX;
  dragState.screenY = event.screenY;

  const distance = Math.hypot(event.screenX - dragState.startX, event.screenY - dragState.startY);
  if (distance > 4 && !dragState.moved) {
    dragState.moved = true;
    window.clearTimeout(dragState.longPressTimer);
    dragState.longPressTimer = 0;
    lastTap = 0;
    // Movement means the old edge/return target is no longer intentional.
    cancelAutoRedock();
    if (dragState.fromDockEdge) {
      // A docked pet has its own exit state. Never route right/bottom drags
      // through the standing-only lift/drag state or its sprite sequence.
      setPetState(`leaving-${dragState.fromDockEdge}`);
      startDockWindowDrag(event.pointerId);
    }
  }
  if (petState === 'dragging') armTransientStateWatchdog('dragging', stateRevision);
  if (dragState.moved && dragState.ready) window.roxy.moveDrag(event.screenX, event.screenY);
}

async function pointerUp(event) {
  notePointerActivity({ clearTapTimestamp: event.type === 'pointercancel' });
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  const finishedDrag = dragState;
  window.clearTimeout(finishedDrag.longPressTimer);
  const wasMoved = finishedDrag.moved;
  const wasLifted = finishedDrag.lifted;
  const wasCancelled = event.type === 'pointercancel';
  const fromDockEdge = finishedDrag.fromDockEdge;
  const expectedDragState = fromDockEdge ? `leaving-${fromDockEdge}` : 'dragging';
  const dragRevision = stateRevision;
  finishedDrag.released = true;
  dragState = null;
  document.body.classList.remove('is-dragging');
  if (!fromDockEdge) window.roxy.setDragLift(false, event.screenX, event.screenY);

  if (fromDockEdge && !wasMoved && wasCancelled) {
    finishedDrag.cancelled = true;
    if (activeDockDrag === finishedDrag) activeDockDrag = null;
    cancelDockMotion();
    activeDockEdge = fromDockEdge;
    scheduleDockWave(fromDockEdge);
    return;
  }

  if (fromDockEdge && !wasMoved && !wasCancelled) {
    finishedDrag.cancelled = true;
    if (activeDockDrag === finishedDrag) activeDockDrag = null;
    await leaveDock(fromDockEdge);
    return;
  }

  try {
    await finishedDrag.startPromise;
  } catch {
    finishedDrag.startFailed = true;
  }
  if (petState !== expectedDragState || stateRevision !== dragRevision) return;
  if (finishedDrag.startFailed) {
    if (fromDockEdge) {
      await recoverDockToFree(`${fromDockEdge} drag start`);
    } else {
      await recoverDockToFree('free drag start');
    }
    return;
  }

  if (wasMoved) window.roxy.moveDrag(event.screenX, event.screenY);

  let result = null;
  let endDragFailed = false;
  try {
    result = await window.roxy.endDrag(event.screenX, event.screenY, {
      moved: wasMoved,
      allowDock: wasMoved && !wasCancelled && !fromDockEdge
    });
  } catch (error) {
    endDragFailed = true;
    console.error('Could not finish dragging:', error);
  }
  if (petState !== expectedDragState || stateRevision !== dragRevision) return;
  if (endDragFailed) {
    await recoverDockToFree('drag end IPC failed');
    return;
  }

  if (fromDockEdge) {
    await finishDraggedDockExit(finishedDrag);
    return;
  }

  await settleDragResult(result);

  if (wasLifted) {
    const releaseSteps = currentLiftBridgeIndex < 10
      ? bridgeRange('lift', currentLiftBridgeIndex, 1, 28)
      : [
          ...frameRange('lift', currentLiftIndex, 1, 28),
          ...bridgeRange('lift', 9, 1, 28)
        ];
    const revision = stateRevision;
    const lockLease = acquireInteractionLock();
    try {
      await playFrames(releaseSteps);
    } catch (error) {
      console.error('Lift release animation failed:', error);
    } finally {
      if (
        revision === stateRevision &&
        petState === 'free' &&
        releaseInteractionLock(lockLease)
      ) {
        document.body.classList.remove('is-lifted');
        setFrame('front');
      }
    }
    return;
  }

  document.body.classList.remove('is-lifted');
  setFrame('front');
  if (wasMoved || wasCancelled) return;
  queueTapAction();
}

pet.addEventListener('pointerdown', pointerDown);
pet.addEventListener('pointermove', pointerMove);
pet.addEventListener('pointerup', pointerUp);
pet.addEventListener('pointercancel', pointerUp);
pet.addEventListener('lostpointercapture', (event) => {
  // Normal pointerup clears dragState before Chromium releases capture, so this
  // only handles an OS/window-driven loss that otherwise leaves dragging stuck.
  // A native dock position/shape change can itself make Windows/Chromium
  // release capture. Treat that as a cancelled release of the dock drag so its
  // own exit clip can finish; never use the standing lift/release sequence.
  if (
    dragState?.pointerId === event.pointerId
    && dragState.fromDockEdge
  ) {
    void pointerUp({
      type: 'pointercancel',
      pointerId: event.pointerId,
      screenX: dragState.screenX,
      screenY: dragState.screenY
    });
    return;
  }
  recoverAbandonedPointerDrag('pointer capture lost', event.pointerId);
});
pet.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  if (!interactionLocked) window.roxy.showMenu();
});
window.addEventListener('blur', () => {
  if (dragState) recoverAbandonedPointerDrag('window blurred during drag');
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && dragState) {
    recoverAbandonedPointerDrag('window hidden during drag');
  }
});

window.roxy.onSpeak(() => {
  cancelAutoRedock();
  if (!interactionLocked && petState === 'free') {
    say(lines[Math.floor(Math.random() * lines.length)]);
  }
});
window.roxy.onCast(() => {
  cancelAutoRedock();
  castWaterBall();
});
window.roxy.onStorm(() => {
  cancelAutoRedock();
  castCumulonimbus();
});
window.roxy.onAction((action) => {
  cancelAutoRedock();
  performAction(action);
});
window.roxy.onInteraction(() => {
  clearPendingTap({ clearTimestamp: true });
  cancelAutoRedock();
});
window.roxy.onDockReset(resetDock);

window.setTimeout(() => {
  if (petState === 'free') say('我叫洛琪希，请多指教。', 4200);
}, 900);

function scheduleIdleLine() {
  const delay = 42000 + Math.random() * 38000;
  window.setTimeout(() => {
    if (
      !document.hidden &&
      !dragState &&
      !interactionLocked &&
      petState === 'free' &&
      !autoRedockEdge
    ) {
      const actions = ['stretch', 'wave', 'braid', 'coquettish'];
      performAction(actions[Math.floor(Math.random() * actions.length)]);
    }
    scheduleIdleLine();
  }, delay);
}

scheduleIdleLine();
