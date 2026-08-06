const pet = document.querySelector('#pet');
const bubble = document.querySelector('#bubble');
const sprite = document.querySelector('#sprite');
const waterTrail = document.querySelector('#waterTrail');
const rain = document.querySelector('#rain');

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
  stretch: 30,
  braid: 30,
  coquettish: 107,
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
  'stretch',
  'braid',
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
  stretch: bridgedPingPong('stretch', 320),
  braid: [
    ...bridgeRange('braid', 1, 10, 34),
    ...frameRange('braid', 2, 30, 34),
    ['braid-30', 260],
    ...bridgeRange('braid', 9, 1, 34)
  ],
  coquettish: frameRange('coquettish', 1, 107, 34),
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

const framesReady = Promise.all(Object.values(frames).map((source) => new Promise((resolve) => {
  const image = new Image();
  image.addEventListener('load', resolve, { once: true });
  image.addEventListener('error', resolve, { once: true });
  image.src = source;
})));

let dragState = null;
let bubbleTimer;
let waterEffectTimer;
let stormEffectTimer;
let lastTap = 0;
let frameSequence = 0;
let interactionLocked = false;
let spellTimers = [];
let swayFrame = 0;
let swayAngle = 0;
let swayAngularVelocity = 0;
let dragVelocity = 0;
let swayLastTime = performance.now();
let currentLiftIndex = 1;
let currentLiftBridgeIndex = 1;

function say(text, duration = 3600) {
  window.clearTimeout(bubbleTimer);
  bubble.textContent = text;
  bubble.classList.add('is-visible');
  bubbleTimer = window.setTimeout(() => bubble.classList.remove('is-visible'), duration);
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function setFrame(name) {
  if (frames[name]) sprite.src = frames[name];
}

async function playFrames(steps, onFrame, { reset = true } = {}) {
  const sequence = ++frameSequence;
  await framesReady;
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
  if (interactionLocked || !actionSequences[name]) return;
  interactionLocked = true;
  await playFrames(actionSequences[name]);
  interactionLocked = false;
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
  if (interactionLocked) return;
  interactionLocked = true;
  clearSpellTimers();
  frameSequence += 1;
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

  pet.classList.remove('is-water-effect');
  await applyActionMode('normal');
  interactionLocked = false;
}

async function castCumulonimbus() {
  if (interactionLocked) return;
  interactionLocked = true;
  clearSpellTimers();
  frameSequence += 1;
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

  clearSpellTimers();
  pet.classList.remove('is-storm-effect');
  await applyActionMode('normal');
  interactionLocked = false;
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

async function runLiftFrames(pointerId) {
  const sequence = ++frameSequence;
  await framesReady;
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
  if (!dragState || dragState.pointerId !== pointerId || interactionLocked) return;
  dragState.lifted = true;
  document.body.classList.add('is-lifted');
  window.roxy.setDragLift(true, dragState.screenX, dragState.screenY);
  startSway();
  runLiftFrames(pointerId);
}

async function pointerDown(event) {
  if (event.button !== 0 || interactionLocked) return;
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
    longPressTimer: 0
  };
  frameSequence += 1;
  setFrame('front');
  pet.setPointerCapture(event.pointerId);
  document.body.classList.add('is-dragging');
  dragState.longPressTimer = window.setTimeout(() => activateLift(event.pointerId), 280);
  const dragSize = await window.roxy.startDrag(event.screenX, event.screenY);
  if (dragState?.pointerId === event.pointerId) {
    dragState.ready = Boolean(dragSize);
    if (dragState.lifted) {
      window.roxy.setDragLift(true, dragState.screenX, dragState.screenY);
    }
  }
}

function pointerMove(event) {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  const now = performance.now();
  const elapsed = Math.max(1, now - dragState.lastTime);
  const velocity = ((event.screenX - dragState.lastX) / elapsed) * 1000;
  dragVelocity = dragVelocity * 0.4 + velocity * 0.6;
  dragState.lastX = event.screenX;
  dragState.lastTime = now;
  dragState.screenX = event.screenX;
  dragState.screenY = event.screenY;

  const distance = Math.hypot(event.screenX - dragState.startX, event.screenY - dragState.startY);
  if (distance > 4) dragState.moved = true;
  if (dragState.moved && dragState.ready) window.roxy.moveDrag(event.screenX, event.screenY);
}

function pointerUp(event) {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  window.clearTimeout(dragState.longPressTimer);
  const wasMoved = dragState.moved;
  const wasLifted = dragState.lifted;
  const wasCancelled = event.type === 'pointercancel';
  dragState = null;
  document.body.classList.remove('is-dragging');
  window.roxy.setDragLift(false, event.screenX, event.screenY);
  window.roxy.endDrag();

  if (wasLifted) {
    frameSequence += 1;
    const releaseSteps = currentLiftBridgeIndex < 10
      ? bridgeRange('lift', currentLiftBridgeIndex, 1, 28)
      : [
          ...frameRange('lift', currentLiftIndex, 1, 28),
          ...bridgeRange('lift', 9, 1, 28)
        ];
    playFrames(releaseSteps).finally(() => {
      document.body.classList.remove('is-lifted');
    });
    return;
  }

  if (wasMoved || wasCancelled) return;
  const now = Date.now();
  if (now - lastTap < 320) {
    lastTap = 0;
    castWaterBall();
  } else {
    lastTap = now;
    window.setTimeout(() => {
      if (lastTap === now) {
        const actions = ['hat', 'stretch', 'wave', 'braid', 'coquettish'];
        performAction(actions[Math.floor(Math.random() * actions.length)]);
        lastTap = 0;
      }
    }, 330);
  }
}

pet.addEventListener('pointerdown', pointerDown);
pet.addEventListener('pointermove', pointerMove);
pet.addEventListener('pointerup', pointerUp);
pet.addEventListener('pointercancel', pointerUp);
pet.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  if (!interactionLocked) window.roxy.showMenu();
});

window.roxy.onSpeak(() => {
  if (!interactionLocked) say(lines[Math.floor(Math.random() * lines.length)]);
});
window.roxy.onCast(castWaterBall);
window.roxy.onStorm(castCumulonimbus);
window.roxy.onAction(performAction);

window.setTimeout(() => say('我叫洛琪希，请多指教。', 4200), 900);

function scheduleIdleLine() {
  const delay = 42000 + Math.random() * 38000;
  window.setTimeout(() => {
    if (!document.hidden && !dragState && !interactionLocked) {
      const actions = ['stretch', 'wave', 'braid', 'coquettish'];
      performAction(actions[Math.floor(Math.random() * actions.length)]);
    }
    scheduleIdleLine();
  }, delay);
}

scheduleIdleLine();
