'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { slicing } = require('./load.js');

test('normalizeGuides sorts, rounds, de-duplicates and drops anything not strictly inside', () => {
  const messy = [30, 10.4, 10, 0, 100, -5, 250, NaN, Infinity];
  assert.deepEqual(slicing.normalizeGuides(messy, 100), [10, 30]);
  assert.deepEqual(slicing.normalizeGuides([0.4, 99.6], 100), []);
  assert.deepEqual(slicing.normalizeGuides([1], 1), []);
});

test('boundaries always include both image edges', () => {
  assert.deepEqual(slicing.boundaries([], 64), [0, 64]);
  assert.deepEqual(slicing.boundaries([48, 16], 64), [0, 16, 48, 64]);
});

test('splitByCount divides evenly and spreads the remainder', () => {
  assert.deepEqual(slicing.splitByCount(256, 8), [32, 64, 96, 128, 160, 192, 224]);
  assert.deepEqual(slicing.splitByCount(10, 3), [3, 7]);
  assert.deepEqual(slicing.splitByCount(100, 1), []);
});

test('splitByCount never makes a slice thinner than one pixel', () => {
  assert.deepEqual(slicing.splitByCount(4, 50), [1, 2, 3]);
  assert.deepEqual(slicing.splitByCount(10, 11), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(slicing.splitByCount(1, 2), []);
});

test('splitByCount keeps half-pixel cuts where the original app put them', () => {
  // 7 * 45 / 10 is exactly 31.5, yet the original (7 / 10) * 45 comes out just below it.
  assert.deepEqual(slicing.splitByCount(45, 10), [5, 9, 14, 18, 23, 27, 31, 36, 41]);
  assert.deepEqual(slicing.splitByCount(39, 26).slice(13, 17), [21, 22, 24, 26]);

  // The original computed Math.round((i / count) * size) when exporting.
  const original = (size, count) => {
    const cuts = new Set();
    for (let i = 1; i < count; i++) cuts.add(Math.round((i / count) * size));
    return [...cuts].filter((px) => px > 0 && px < size).sort((a, b) => a - b);
  };
  for (let size = 1; size <= 600; size++) {
    for (let count = 2; count <= 50; count++) {
      assert.deepEqual(slicing.splitByCount(size, count), original(size, count));
    }
  }
});

test('splitByCell cuts every N pixels and leaves a narrower last slice', () => {
  assert.deepEqual(slicing.splitByCell(100, 32), [32, 64, 96]);
  assert.deepEqual(slicing.splitByCell(96, 32), [32, 64]);
  assert.deepEqual(slicing.splitByCell(16, 32), []);
  assert.equal(slicing.sliceCountForCell(100, 32), 4);
  assert.equal(slicing.sliceCountForCell(96, 32), 3);
});

test('splitByCell ignores cell sizes that could never reach the far edge', () => {
  assert.deepEqual(slicing.splitByCell(100, 0), []);
  assert.deepEqual(slicing.splitByCell(100, -4), []);
  assert.deepEqual(slicing.splitByCell(100, NaN), []);
});

test('midpointOfLargestGap targets the widest gap and reports when there is no room', () => {
  assert.equal(slicing.midpointOfLargestGap([], 100), 50);
  assert.equal(slicing.midpointOfLargestGap([50], 100), 25);
  assert.equal(slicing.midpointOfLargestGap([10], 100), 55);
  assert.equal(slicing.midpointOfLargestGap([1], 2), null);
  assert.equal(slicing.midpointOfLargestGap([], 1), null);
});

test('moveGuide keeps the list sorted and reports where the guide ended up', () => {
  assert.deepEqual(slicing.moveGuide([10, 20, 30], 0, 25, 100), { guides: [20, 25, 30], index: 1 });
});

test('moveGuide merges a guide dropped onto another and drops one moved off the image', () => {
  assert.deepEqual(slicing.moveGuide([10, 20, 30], 0, 20, 100), { guides: [20, 30], index: 0 });
  assert.deepEqual(slicing.moveGuide([10, 20], 1, 100, 100), { guides: [10], index: -1 });
});

test('nudgeGuide steps over neighbors instead of merging with them', () => {
  assert.deepEqual(slicing.nudgeGuide([5, 6, 7], 0, 1, 100), { guides: [6, 7, 8], index: 2 });
  assert.deepEqual(slicing.nudgeGuide([5, 6, 7], 2, -1, 100), { guides: [4, 5, 6], index: 0 });
});

test('nudgeGuide stops at the image edge and reports when it cannot move', () => {
  assert.deepEqual(slicing.nudgeGuide([5], 0, -10, 100), { guides: [1], index: 0 });
  assert.deepEqual(slicing.nudgeGuide([5, 99], 0, 500, 100), { guides: [98, 99], index: 0 });
  assert.equal(slicing.nudgeGuide([98, 99], 0, 1, 100), null);
  assert.equal(slicing.nudgeGuide([1, 2], 1, -1, 100), null);
  assert.equal(slicing.nudgeGuide([1], 0, -1, 100), null);
});

test('tileGrid enumerates tiles row by row and covers the image exactly', () => {
  const grid = slicing.tileGrid({ v: [30, 70], h: [10] }, 100, 40);
  assert.equal(grid.columns, 3);
  assert.equal(grid.rows, 2);
  assert.deepEqual(
    grid.tiles.map(({ row, col, index }) => [row, col, index]),
    [[0, 0, 0], [0, 1, 1], [0, 2, 2], [1, 0, 3], [1, 1, 4], [1, 2, 5]],
  );
  const { x, y, width, height } = grid.tiles[4];
  assert.deepEqual([x, y, width, height], [30, 10, 40, 30]);

  const area = grid.tiles.reduce((total, tile) => total + tile.width * tile.height, 0);
  assert.equal(area, 100 * 40);
});

test('an image without guides is a single tile', () => {
  const { tiles } = slicing.tileGrid({ v: [], h: [] }, 16, 16);
  assert.deepEqual(tiles, [{ row: 0, col: 0, index: 0, x: 0, y: 0, width: 16, height: 16 }]);
});

test('centerOffset pads smaller content and crops larger content symmetrically', () => {
  assert.equal(slicing.centerOffset(100, 40), 30);
  assert.equal(slicing.centerOffset(40, 100), -30);
  assert.equal(slicing.centerOffset(40, 40), 0);
});

test('guidesEqual and cloneGuides treat guides as values', () => {
  const guides = { v: [1, 2], h: [3] };
  const copy = slicing.cloneGuides(guides);
  assert.ok(slicing.guidesEqual(guides, copy));
  copy.v.push(9);
  assert.deepEqual(guides.v, [1, 2]);
  assert.ok(!slicing.guidesEqual(guides, copy));
});

test('a layout survives a round trip through text', () => {
  const layout = { width: 256, height: 128, guides: { v: [32, 64], h: [64] } };
  assert.deepEqual(slicing.parseLayout(slicing.serializeLayout(layout)), layout);
});

test('parseLayout rejects anything that is not a well-formed layout', () => {
  const valid = JSON.parse(
    slicing.serializeLayout({ width: 10, height: 10, guides: { v: [5], h: [] } }),
  );
  const variants = [
    'not json',
    '[]',
    'null',
    '"text"',
    JSON.stringify({ ...valid, type: 'something-else' }),
    JSON.stringify({ ...valid, version: 2 }),
    JSON.stringify({ ...valid, width: 0 }),
    JSON.stringify({ ...valid, height: 1.5 }),
    JSON.stringify({ ...valid, vertical: 'x' }),
    JSON.stringify({ ...valid, horizontal: [1, 'two'] }),
    JSON.stringify({ ...valid, vertical: new Array(5000).fill(1) }),
    ' '.repeat(100000),
  ];
  for (const text of variants) assert.equal(slicing.parseLayout(text), null, text.slice(0, 60));
  assert.equal(slicing.parseLayout(undefined), null);
});

test('parseLayout normalizes guides it accepts', () => {
  const text = JSON.stringify({
    type: 'slice-studio/layout',
    version: 1,
    width: 100,
    height: 100,
    vertical: [90, 10, 10, 400, -1],
    horizontal: [],
  });
  assert.deepEqual(slicing.parseLayout(text).guides, { v: [10, 90], h: [] });
});

test('fitLayout keeps relative positions when the target image has another size', () => {
  const layout = { width: 100, height: 50, guides: { v: [25, 50], h: [10] } };
  assert.deepEqual(slicing.fitLayout(layout, 100, 50), { v: [25, 50], h: [10] });
  assert.deepEqual(slicing.fitLayout(layout, 200, 100), { v: [50, 100], h: [20] });
  // Guides that collapse onto each other or onto an edge at a smaller size disappear.
  assert.deepEqual(slicing.fitLayout(layout, 2, 2), { v: [1], h: [] });
});
