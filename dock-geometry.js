'use strict';

const DEFAULT_RETURN_MARGIN = 24;
const DIRECTION_EPSILON = 1e-6;

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function readRect(rect, name) {
  if (!rect || typeof rect !== 'object') {
    throw new TypeError(`${name} must be a rectangle`);
  }

  const values = ['x', 'y', 'width', 'height'].map((key) => rect[key]);
  if (!values.every(isFiniteNumber) || rect.width <= 0 || rect.height <= 0) {
    throw new TypeError(`${name} must have finite x/y and positive width/height`);
  }

  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height))
  };
}

function clamp(value, minimum, maximum) {
  if (maximum < minimum) return minimum;
  return Math.min(Math.max(value, minimum), maximum);
}

/**
 * Keep a normal (undocked) pet window inside a display work area.
 *
 * Both clampFreeBounds(bounds, workArea) and
 * clampFreeBounds({ bounds, workArea }) are accepted so the helper composes
 * naturally with the other object-argument functions in this module.
 */
function clampFreeBounds(boundsOrOptions, workAreaArgument) {
  const objectForm = workAreaArgument === undefined
    && boundsOrOptions
    && typeof boundsOrOptions === 'object'
    && boundsOrOptions.bounds
    && boundsOrOptions.workArea;
  const bounds = readRect(objectForm ? boundsOrOptions.bounds : boundsOrOptions, 'bounds');
  const workArea = readRect(objectForm ? boundsOrOptions.workArea : workAreaArgument, 'workArea');

  return {
    x: clamp(bounds.x, workArea.x, workArea.x + workArea.width - bounds.width),
    y: clamp(bounds.y, workArea.y, workArea.y + workArea.height - bounds.height),
    width: bounds.width,
    height: bounds.height
  };
}

function movementComponents(movement) {
  if (!movement || typeof movement !== 'object') return { x: 0, y: 0 };

  let x = movement.dx;
  let y = movement.dy;
  if (!isFiniteNumber(x)) x = movement.deltaX;
  if (!isFiniteNumber(y)) y = movement.deltaY;
  if (!isFiniteNumber(x)) x = movement.x;
  if (!isFiniteNumber(y)) y = movement.y;

  if ((!isFiniteNumber(x) || !isFiniteNumber(y)) && movement.from && movement.to) {
    if (!isFiniteNumber(x) && isFiniteNumber(movement.from.x) && isFiniteNumber(movement.to.x)) {
      x = movement.to.x - movement.from.x;
    }
    if (!isFiniteNumber(y) && isFiniteNumber(movement.from.y) && isFiniteNumber(movement.to.y)) {
      y = movement.to.y - movement.from.y;
    }
  }

  return {
    x: isFiniteNumber(x) ? x : 0,
    y: isFiniteNumber(y) ? y : 0
  };
}

function normalizedEdgeProgress(gap, threshold, span) {
  if (gap < 0) {
    // Once through the boundary, compare the fraction of the window that has
    // crossed it. This avoids biasing the corner decision toward the taller
    // dimension merely because its raw pixel penetration is larger.
    return 1 + (-gap / span);
  }
  if (threshold === 0) return gap === 0 ? 1 : 0;
  return (threshold - gap) / threshold;
}

/**
 * Pick the supported dock edge for the final bounds of a drag.
 *
 * The caller invokes this only when the drag ends. Merely being elsewhere on
 * screen never selects an edge: the right/bottom side of the window must have
 * entered the corresponding threshold strip. At the bottom-right corner the
 * outward component of the last movement wins; ties fall back to normalized
 * progress through each edge's threshold/boundary.
 */
function chooseDockEdge({ bounds: boundsInput, workArea: workAreaInput, movement, threshold }) {
  const bounds = readRect(boundsInput, 'bounds');
  const workArea = readRect(workAreaInput, 'workArea');
  if (!isFiniteNumber(threshold) || threshold < 0) {
    throw new TypeError('threshold must be a non-negative finite number');
  }

  const right = workArea.x + workArea.width;
  const bottom = workArea.y + workArea.height;
  const boundsRight = bounds.x + bounds.width;
  const boundsBottom = bounds.y + bounds.height;
  const overlapsVertically = bounds.y < bottom && boundsBottom > workArea.y;
  const overlapsHorizontally = bounds.x < right && boundsRight > workArea.x;
  const nearRight = overlapsVertically
    && bounds.x < right
    && boundsRight >= right - threshold;
  const nearBottom = overlapsHorizontally
    && bounds.y < bottom
    && boundsBottom >= bottom - threshold;

  if (!nearRight && !nearBottom) return null;
  if (nearRight && !nearBottom) return 'right';
  if (nearBottom && !nearRight) return 'bottom';

  const delta = movementComponents(movement);
  const towardRight = Math.max(0, delta.x);
  const towardBottom = Math.max(0, delta.y);
  if (towardRight > towardBottom + DIRECTION_EPSILON) return 'right';
  if (towardBottom > towardRight + DIRECTION_EPSILON) return 'bottom';

  const rightProgress = normalizedEdgeProgress(right - boundsRight, threshold, bounds.width);
  const bottomProgress = normalizedEdgeProgress(bottom - boundsBottom, threshold, bounds.height);
  return bottomProgress > rightProgress ? 'bottom' : 'right';
}

/**
 * Calculate a cropped BrowserWindow for a right/bottom dock animation.
 *
 * The media is laid out once against the fixed normal window using `contain`.
 * Cropping therefore never rescales or recentres the animation. `lineOffset`
 * is the scaled reference-line coordinate within that normal window; the dock
 * window ends `overlap` pixels after it, leaving the line slightly inboard of
 * the actual work-area edge.
 */
function computeDockLayout({
  edge,
  freeBounds: freeBoundsInput,
  workArea: workAreaInput,
  mediaWidth,
  mediaHeight,
  lineRatio,
  overlap,
  mediaAlignX = 0.5,
  mediaAlignY = 0.5,
  dockedMediaBounds: dockedMediaBoundsInput = null,
  dockedShapePadding = 0
}) {
  if (edge !== 'right' && edge !== 'bottom') {
    throw new TypeError("edge must be 'right' or 'bottom'");
  }
  const freeBounds = readRect(freeBoundsInput, 'freeBounds');
  const workArea = readRect(workAreaInput, 'workArea');
  if (!isFiniteNumber(mediaWidth) || mediaWidth <= 0
    || !isFiniteNumber(mediaHeight) || mediaHeight <= 0) {
    throw new TypeError('mediaWidth/mediaHeight must be positive finite numbers');
  }
  if (!isFiniteNumber(lineRatio) || lineRatio < 0 || lineRatio > 1) {
    throw new TypeError('lineRatio must be a finite number between 0 and 1');
  }
  if (!isFiniteNumber(overlap) || overlap < 0) {
    throw new TypeError('overlap must be a non-negative finite number');
  }
  if (!isFiniteNumber(mediaAlignX) || mediaAlignX < 0 || mediaAlignX > 1
    || !isFiniteNumber(mediaAlignY) || mediaAlignY < 0 || mediaAlignY > 1) {
    throw new TypeError('mediaAlignX/mediaAlignY must be between 0 and 1');
  }
  if (!isFiniteNumber(dockedShapePadding) || dockedShapePadding < 0) {
    throw new TypeError('dockedShapePadding must be a non-negative finite number');
  }

  const normalWidth = freeBounds.width;
  const normalHeight = freeBounds.height;
  const mediaScale = Math.min(normalWidth / mediaWidth, normalHeight / mediaHeight);
  const renderWidth = mediaWidth * mediaScale;
  const renderHeight = mediaHeight * mediaScale;
  const mediaOffsetX = (normalWidth - renderWidth) * mediaAlignX;
  const mediaOffsetY = (normalHeight - renderHeight) * mediaAlignY;
  const lineOffset = edge === 'right'
    ? mediaOffsetX + renderWidth * lineRatio
    : mediaOffsetY + renderHeight * lineRatio;

  let width = normalWidth;
  let height = normalHeight;
  if (edge === 'right') {
    width = Math.max(1, Math.min(normalWidth, Math.ceil(lineOffset + overlap)));
  } else {
    height = Math.max(1, Math.min(normalHeight, Math.ceil(lineOffset + overlap)));
  }

  // A valid desktop work area is normally much larger than every configured
  // pet size. Capping here keeps the visible crop inside even on an unusually
  // tiny virtual display without changing the logical normal media size.
  width = Math.min(width, workArea.width);
  height = Math.min(height, workArea.height);

  const workRight = workArea.x + workArea.width;
  const workBottom = workArea.y + workArea.height;
  const dockBounds = edge === 'right'
    ? {
        x: workRight - width,
        y: clamp(freeBounds.y, workArea.y, workBottom - height),
        width,
        height
      }
    : {
        x: clamp(freeBounds.x, workArea.x, workRight - width),
        y: workBottom - height,
        width,
        height
      };

  // Keep the native BrowserWindow at its normal size. `dockBounds` remains
  // the exact screen-space rectangle that the old, physically cropped window
  // occupied; `dockShape` applies that same top-left crop without changing the
  // media viewport, scale, registration, or per-frame camera correction.
  // The unused part of `dockCanvasBounds` extends past the work-area edge.
  const dockCanvasBounds = {
    x: dockBounds.x,
    y: dockBounds.y,
    width: normalWidth,
    height: normalHeight
  };
  const dockShape = {
    x: 0,
    y: 0,
    width: dockBounds.width,
    height: dockBounds.height
  };
  let dockedShape = { ...dockShape };
  if (dockedMediaBoundsInput) {
    const mediaBounds = readRect(dockedMediaBoundsInput, 'dockedMediaBounds');
    const left = Math.max(
      dockShape.x,
      Math.floor(mediaOffsetX + mediaBounds.x * mediaScale - dockedShapePadding)
    );
    const top = Math.max(
      dockShape.y,
      Math.floor(mediaOffsetY + mediaBounds.y * mediaScale - dockedShapePadding)
    );
    const right = Math.min(
      dockShape.x + dockShape.width,
      Math.ceil(
        mediaOffsetX
        + (mediaBounds.x + mediaBounds.width) * mediaScale
        + dockedShapePadding
      )
    );
    const bottom = Math.min(
      dockShape.y + dockShape.height,
      Math.ceil(
        mediaOffsetY
        + (mediaBounds.y + mediaBounds.height) * mediaScale
        + dockedShapePadding
      )
    );
    if (right <= left || bottom <= top) {
      throw new RangeError('dockedMediaBounds must intersect the dock transition shape');
    }
    dockedShape = {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top
    };
  }

  return {
    dockBounds,
    dockCanvasBounds,
    dockShape,
    dockedShape,
    normalWidth,
    normalHeight,
    mediaOffsetX,
    mediaOffsetY,
    mediaScale,
    lineOffset
  };
}

/**
 * Put a docked pet back at its normal size, just inside the edge it came from.
 */
function computeFreeReturnBounds({ bounds: boundsInput, workArea: workAreaInput, edge, margin = DEFAULT_RETURN_MARGIN }) {
  const rawBounds = boundsInput && typeof boundsInput === 'object' ? boundsInput : {};
  const normalWidth = isFiniteNumber(rawBounds.normalWidth) && rawBounds.normalWidth > 0
    ? rawBounds.normalWidth
    : rawBounds.width;
  const normalHeight = isFiniteNumber(rawBounds.normalHeight) && rawBounds.normalHeight > 0
    ? rawBounds.normalHeight
    : rawBounds.height;
  const bounds = readRect({
    x: rawBounds.x,
    y: rawBounds.y,
    width: normalWidth,
    height: normalHeight
  }, 'bounds');
  const workArea = readRect(workAreaInput, 'workArea');
  if (edge !== 'right' && edge !== 'bottom') {
    throw new TypeError("edge must be 'right' or 'bottom'");
  }
  if (!isFiniteNumber(margin) || margin < 0) {
    throw new TypeError('margin must be a non-negative finite number');
  }

  const candidate = { ...bounds };
  if (edge === 'right') {
    candidate.x = workArea.x + workArea.width - bounds.width - Math.round(margin);
  } else {
    candidate.y = workArea.y + workArea.height - bounds.height - Math.round(margin);
  }
  return clampFreeBounds(candidate, workArea);
}

module.exports = {
  chooseDockEdge,
  computeDockLayout,
  computeFreeReturnBounds,
  clampFreeBounds
};
