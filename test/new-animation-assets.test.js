'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const assetRoot = path.join(root, 'assets', 'animations', 'new');
const manifest = require('../assets/animations/new/manifest.json');
const blinkRoot = path.join(root, 'assets', 'animations', 'blink');

const EXPECTED_CLIPS = [
  'dock-right-enter',
  'dock-right-wave',
  'dock-right-exit',
  'dock-bottom-enter',
  'dock-bottom-wave',
  'dock-bottom-exit',
  'braid',
  'coquettish',
  'stretch'
];

function animationLoopCount(file) {
  const buffer = fs.readFileSync(file);
  const chunk = buffer.indexOf(Buffer.from('ANIM'));
  assert.notEqual(chunk, -1, `${path.basename(file)} is not an animated WebP`);
  return buffer.readUInt16LE(chunk + 12);
}

test('new animation manifest contains the complete canonical asset set', () => {
  assert.deepEqual(Object.keys(manifest.clips), EXPECTED_CLIPS);
  for (const [name, clip] of Object.entries(manifest.clips)) {
    assert.equal(clip.width, 500, `${name} width`);
    assert.equal(clip.height, 750, `${name} height`);
    assert.equal(clip.fps, 24, `${name} fps`);
    assert.ok(clip.frameCount > 0, `${name} has frames`);
    for (const relative of [clip.asset, clip.firstFrame, clip.lastFrame]) {
      assert.ok(fs.existsSync(path.join(assetRoot, relative)), `${name}: ${relative}`);
    }
    assert.equal(animationLoopCount(path.join(assetRoot, clip.asset)), 1, `${name} loop count`);
  }
});

test('dock metadata shares one canvas and removes the guide lines', () => {
  for (const edge of ['right', 'bottom']) {
    const clips = ['enter', 'wave', 'exit'].map(
      (phase) => manifest.clips[`dock-${edge}-${phase}`]
    );
    const pixels = new Set(clips.map((clip) => clip.referenceLine.pixel));
    assert.equal(pixels.size, 1, `${edge} reference coordinate`);
    for (const clip of clips) {
      assert.equal(clip.dockEdge, edge);
      assert.equal(clip.referenceLine.removedFromFinal, true);
      assert.equal(clip.referenceLine.crossingForegroundPreserved, true);
    }
  }
});

test('the corrected silent green-screen braid is the packaged replacement', () => {
  const braid = manifest.clips.braid;
  assert.equal(braid.sourceName, '洛琪希轻抚发辫-修正版-静音.mp4');
  assert.equal(braid.background, 'green');
  assert.deepEqual(braid.qa.alphaCornerFailures, []);
  assert.equal(braid.qa.maxResidualKeyPixels, 0);
});

test('automatic blink assets are not packaged', () => {
  assert.equal(fs.existsSync(blinkRoot), false);
});

test('portable packaging keeps 1.0 resources in the repository but excludes them from 2.0', () => {
  const packageJson = require(path.join(root, 'package.json'));
  assert.equal(packageJson.build.asar, true);
  assert.equal(packageJson.build.compression, 'maximum');
  assert.deepEqual(packageJson.build.electronLanguages, ['zh-CN', 'en-US']);
  for (const name of ['braid', 'coquettish', 'stretch']) {
    assert.equal(fs.existsSync(path.join(root, 'assets', 'animations', name)), true);
    assert.ok(
      packageJson.build.files.includes(`!assets/animations/${name}/**/*`),
      `${name} 1.0 PNGs are excluded from the 2.0 portable build`
    );
  }
  for (const name of ['braid', 'stretch']) {
    assert.equal(fs.existsSync(path.join(root, 'assets', 'animations', 'bridges', name)), true);
    assert.ok(
      packageJson.build.files.includes(`!assets/animations/bridges/${name}/**/*`),
      `${name} 1.0 bridge PNGs are excluded from the 2.0 portable build`
    );
  }
  assert.ok(packageJson.build.files.includes('!assets/animations/new/_assembly-validation.json'));
});
