'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  chooseDockEdge,
  computeDockLayout,
  computeFreeReturnBounds,
  clampFreeBounds
} = require('../dock-geometry');

const PRIMARY_WORK_AREA = { x: 0, y: 0, width: 1920, height: 1040 };
const LEFT_WORK_AREA = { x: -1920, y: 0, width: 1920, height: 1040 };
const SIZES = [
  { width: 135, height: 215 },
  { width: 170, height: 270 },
  { width: 210, height: 335 },
  { width: 315, height: 503 }
];

test('clampFreeBounds handles negative-coordinate displays and both call forms', () => {
  const bounds = { x: -2025, y: 920, width: 170, height: 270 };
  const expected = { x: -1920, y: 770, width: 170, height: 270 };

  assert.deepEqual(clampFreeBounds(bounds, LEFT_WORK_AREA), expected);
  assert.deepEqual(clampFreeBounds({ bounds, workArea: LEFT_WORK_AREA }), expected);
});

test('chooseDockEdge only selects the right or bottom threshold strips', () => {
  assert.equal(chooseDockEdge({
    bounds: { x: 1500, y: 500, width: 170, height: 270 },
    workArea: PRIMARY_WORK_AREA,
    movement: { x: 20, y: 0 },
    threshold: 40
  }), null);

  assert.equal(chooseDockEdge({
    bounds: { x: 1715, y: 500, width: 170, height: 270 },
    workArea: PRIMARY_WORK_AREA,
    movement: { x: 20, y: 0 },
    threshold: 40
  }), 'right');

  assert.equal(chooseDockEdge({
    bounds: { x: 900, y: 735, width: 170, height: 270 },
    workArea: PRIMARY_WORK_AREA,
    movement: { x: 0, y: 20 },
    threshold: 40
  }), 'bottom');
});

test('chooseDockEdge honors the size-scaled threshold for all four pet sizes', () => {
  const cases = [
    { name: 'small', width: 135, height: 215, threshold: 6 },
    { name: 'medium', width: 170, height: 270, threshold: 8 },
    { name: 'large', width: 210, height: 335, threshold: 10 },
    { name: 'xlarge', width: 315, height: 503, threshold: 15 }
  ];
  const workRight = PRIMARY_WORK_AREA.x + PRIMARY_WORK_AREA.width;
  const workBottom = PRIMARY_WORK_AREA.y + PRIMARY_WORK_AREA.height;

  for (const { name, width, height, threshold } of cases) {
    const rightBoundary = {
      x: workRight - width - threshold,
      y: 100,
      width,
      height
    };
    assert.equal(chooseDockEdge({
      bounds: rightBoundary,
      workArea: PRIMARY_WORK_AREA,
      movement: { dx: 1, dy: 0 },
      threshold
    }), 'right', `${name} should dock at its right threshold`);
    assert.equal(chooseDockEdge({
      bounds: { ...rightBoundary, x: rightBoundary.x - 1 },
      workArea: PRIMARY_WORK_AREA,
      movement: { dx: 1, dy: 0 },
      threshold
    }), null, `${name} should stay free one pixel before its right threshold`);

    const bottomBoundary = {
      x: 100,
      y: workBottom - height - threshold,
      width,
      height
    };
    assert.equal(chooseDockEdge({
      bounds: bottomBoundary,
      workArea: PRIMARY_WORK_AREA,
      movement: { dx: 0, dy: 1 },
      threshold
    }), 'bottom', `${name} should dock at its bottom threshold`);
    assert.equal(chooseDockEdge({
      bounds: { ...bottomBoundary, y: bottomBoundary.y - 1 },
      workArea: PRIMARY_WORK_AREA,
      movement: { dx: 0, dy: 1 },
      threshold
    }), null, `${name} should stay free one pixel before its bottom threshold`);
  }
});

test('chooseDockEdge uses the selected display workArea, including taskbar and negative coordinates', () => {
  assert.equal(chooseDockEdge({
    bounds: { x: -190, y: 300, width: 170, height: 270 },
    workArea: LEFT_WORK_AREA,
    movement: { dx: 12, dy: 0 },
    threshold: 24
  }), 'right');

  // Physical display height could be 1080; workArea stops at the taskbar's
  // upper edge (1040), and that is the only bottom boundary that matters.
  assert.equal(chooseDockEdge({
    bounds: { x: 700, y: 750, width: 170, height: 270 },
    workArea: PRIMARY_WORK_AREA,
    movement: { dx: 0, dy: 12 },
    threshold: 24
  }), 'bottom');
});

test('bottom-right ambiguity prefers final movement direction', () => {
  const bounds = { x: 1720, y: 740, width: 170, height: 270 };

  assert.equal(chooseDockEdge({
    bounds,
    workArea: PRIMARY_WORK_AREA,
    movement: { dx: 11, dy: 3 },
    threshold: 40
  }), 'right');
  assert.equal(chooseDockEdge({
    bounds,
    workArea: PRIMARY_WORK_AREA,
    movement: { dx: 2, dy: 9 },
    threshold: 40
  }), 'bottom');
});

test('bottom-right ambiguity falls back to normalized penetration', () => {
  // Right is 15 px through a 170 px-wide window; bottom is 20 px through a
  // 270 px-high window. The smaller raw right penetration is proportionally
  // deeper, so right wins when the final movement is tied.
  const bounds = { x: 1765, y: 790, width: 170, height: 270 };
  assert.equal(chooseDockEdge({
    bounds,
    workArea: PRIMARY_WORK_AREA,
    movement: { dx: 4, dy: 4 },
    threshold: 40
  }), 'right');

  assert.equal(chooseDockEdge({
    bounds: { x: 1730, y: 755, width: 170, height: 270 },
    workArea: PRIMARY_WORK_AREA,
    movement: { dx: 0, dy: 0 },
    threshold: 40
  }), 'bottom');
});

test('right dock uses contain layout and crops just after the vertical line for all four sizes', () => {
  for (const size of SIZES) {
    const freeBounds = { x: 1200, y: 900, ...size };
    const layout = computeDockLayout({
      edge: 'right',
      freeBounds,
      workArea: PRIMARY_WORK_AREA,
      mediaWidth: 360,
      mediaHeight: 640,
      lineRatio: 305 / 360,
      overlap: 5
    });
    const expectedScale = Math.min(size.width / 360, size.height / 640);
    const renderedWidth = 360 * expectedScale;
    const expectedOffsetX = (size.width - renderedWidth) / 2;
    const expectedLine = expectedOffsetX + renderedWidth * (305 / 360);

    assert.equal(layout.normalWidth, size.width);
    assert.equal(layout.normalHeight, size.height);
    assert.equal(layout.mediaScale, expectedScale);
    assert.equal(layout.mediaOffsetX, expectedOffsetX);
    assert.equal(layout.mediaOffsetY, (size.height - 640 * expectedScale) / 2);
    assert.ok(Math.abs(layout.lineOffset - expectedLine) < 1e-9);
    assert.equal(layout.dockBounds.width, Math.ceil(expectedLine + 5));
    assert.equal(layout.dockBounds.height, size.height);
    assert.equal(layout.dockBounds.x + layout.dockBounds.width, 1920);
    assert.equal(layout.dockBounds.y + layout.dockBounds.height, 1040);
    assert.ok(layout.dockBounds.width - layout.lineOffset >= 5);
    assert.ok(layout.dockBounds.width - layout.lineOffset < 6);
  }
});

test('bottom dock aligns to taskbar workArea for all four sizes', () => {
  for (const size of SIZES) {
    const layout = computeDockLayout({
      edge: 'bottom',
      freeBounds: { x: -550, y: 790, ...size },
      workArea: LEFT_WORK_AREA,
      mediaWidth: 366,
      mediaHeight: 640,
      lineRatio: 509 / 640,
      overlap: 5
    });
    const scale = Math.min(size.width / 366, size.height / 640);
    const renderedHeight = 640 * scale;
    const offsetY = (size.height - renderedHeight) / 2;
    const lineOffset = offsetY + renderedHeight * (509 / 640);

    assert.equal(layout.normalWidth, size.width);
    assert.equal(layout.normalHeight, size.height);
    assert.equal(layout.mediaScale, scale);
    assert.equal(layout.mediaOffsetY, offsetY);
    assert.equal(layout.lineOffset, lineOffset);
    assert.deepEqual(layout.dockBounds, {
      x: -550,
      y: 1040 - Math.ceil(lineOffset + 5),
      width: size.width,
      height: Math.ceil(lineOffset + 5)
    });
    assert.equal(layout.dockBounds.y + layout.dockBounds.height, 1040);
    assert.ok(layout.dockBounds.height - layout.lineOffset >= 5);
    assert.ok(layout.dockBounds.height - layout.lineOffset < 6);
  }
});

test('canonical media uses the same center-bottom alignment as the renderer', () => {
  for (const size of SIZES) {
    const overlap = Math.max(8, Math.ceil(size.width * 0.032 + 2));
    const layout = computeDockLayout({
      edge: 'bottom',
      freeBounds: { x: 400, y: 500, ...size },
      workArea: PRIMARY_WORK_AREA,
      mediaWidth: 500,
      mediaHeight: 750,
      lineRatio: 702 / 750,
      overlap,
      mediaAlignX: 0.5,
      mediaAlignY: 1
    });
    const scale = Math.min(size.width / 500, size.height / 750);
    const expectedOffsetY = size.height - 750 * scale;
    const expectedLine = expectedOffsetY + 702 * scale;

    assert.equal(layout.mediaOffsetY, expectedOffsetY);
    assert.ok(Math.abs(layout.lineOffset - expectedLine) < 1e-9);
    assert.equal(layout.dockBounds.height, Math.ceil(expectedLine + overlap));
    assert.equal(layout.dockBounds.y + layout.dockBounds.height, 1040);
  }
});

test('computeFreeReturnBounds restores normal size, leaves a margin, and stays inside workArea', () => {
  assert.deepEqual(computeFreeReturnBounds({
    bounds: { x: 1800, y: 900, width: 142, height: 270, normalWidth: 170, normalHeight: 270 },
    workArea: PRIMARY_WORK_AREA,
    edge: 'right',
    margin: 24
  }), { x: 1726, y: 770, width: 170, height: 270 });

  assert.deepEqual(computeFreeReturnBounds({
    bounds: { x: -550, y: 820, width: 170, height: 220, normalWidth: 170, normalHeight: 270 },
    workArea: LEFT_WORK_AREA,
    edge: 'bottom',
    margin: 24
  }), { x: -550, y: 746, width: 170, height: 270 });
});
