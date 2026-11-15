'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { viewport } = require('./load.js');

const closeTo = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, message ?? `${actual} is not ${expected}`);

test('fit shrinks a large image to the view and centers it', () => {
  const view = viewport.fit(1200, 800, 1176, 838);
  closeTo(view.zoom, (1176 - 128) / 1200);
  closeTo(view.panX + (1200 * view.zoom) / 2, 1176 / 2);
  closeTo(view.panY + (800 * view.zoom) / 2, 838 / 2);
});

test('fit magnifies small images by whole multiples only', () => {
  assert.equal(viewport.fit(256, 128, 1176, 838).zoom, 4);
  assert.equal(viewport.fit(16, 16, 1176, 838).zoom, 44);
  assert.equal(viewport.fit(1000, 1000, 1200, 1200).zoom, 1);
});

test('fit stays within the zoom limits', () => {
  assert.equal(viewport.fit(1, 1, 4000, 4000).zoom, viewport.MAX_ZOOM);
  assert.equal(viewport.fit(1000000, 10, 800, 600).zoom, viewport.MIN_ZOOM);
});

test('fit uses proportionally less padding in a small view', () => {
  // 8% of 300 px is 24 px a side, less than the 64 px used in a roomy view.
  closeTo(viewport.fit(1000, 10, 300, 300).zoom, (300 - 48) / 1000);
});

test('screenToImage inverts the pan and zoom', () => {
  const view = { zoom: 2, panX: 100, panY: 50 };
  assert.deepEqual(viewport.screenToImage(view, 100, 50), { x: 0, y: 0 });
  assert.deepEqual(viewport.screenToImage(view, 140, 70), { x: 20, y: 10 });
});

test('zoomTo keeps the image point under the anchor where it is', () => {
  const view = { zoom: 1, panX: 30, panY: -20 };
  const anchor = { x: 400, y: 300 };
  const before = viewport.screenToImage(view, anchor.x, anchor.y);
  const zoomed = viewport.zoomTo(view, 3.5, anchor.x, anchor.y);
  const after = viewport.screenToImage(zoomed, anchor.x, anchor.y);

  assert.equal(zoomed.zoom, 3.5);
  closeTo(after.x, before.x);
  closeTo(after.y, before.y);
});

test('zoomTo clamps to the zoom limits', () => {
  const view = { zoom: 1, panX: 0, panY: 0 };
  assert.equal(viewport.zoomTo(view, 1000, 0, 0).zoom, viewport.MAX_ZOOM);
  assert.equal(viewport.zoomTo(view, 0, 0, 0).zoom, viewport.MIN_ZOOM);
});

test('panBy moves the view without touching the zoom or its argument', () => {
  const view = Object.freeze({ zoom: 2, panX: 10, panY: 20 });
  assert.deepEqual(viewport.panBy(view, 5, -5), { zoom: 2, panX: 15, panY: 15 });
});

test('nextZoomStop moves to the neighboring stop in either direction', () => {
  assert.equal(viewport.nextZoomStop(1, 1), 1.5);
  assert.equal(viewport.nextZoomStop(1, -1), 0.6667);
  assert.equal(viewport.nextZoomStop(0.8733, 1), 1);
  assert.equal(viewport.nextZoomStop(0.8733, -1), 0.6667);
});

test('nextZoomStop does not get stuck on a stop it is already at', () => {
  assert.equal(viewport.nextZoomStop(0.3333, 1), 0.5);
  assert.equal(viewport.nextZoomStop(1.0000001, 1), 1.5);
  assert.equal(viewport.nextZoomStop(0.9999999, -1), 0.6667);
});

test('nextZoomStop ends at the zoom limits', () => {
  assert.equal(viewport.nextZoomStop(viewport.MAX_ZOOM, 1), viewport.MAX_ZOOM);
  assert.equal(viewport.nextZoomStop(viewport.MIN_ZOOM, -1), viewport.MIN_ZOOM);
});

test('constrain keeps part of the image on screen', () => {
  const far = { zoom: 1, panX: 5000, panY: -5000 };
  // A 400 x 300 image in an 800 x 600 view keeps a 48 px strip visible.
  assert.deepEqual(viewport.constrain(far, 400, 300, 800, 600), { zoom: 1, panX: 752, panY: -252 });
});

test('constrain leaves a viewport that is already in range untouched', () => {
  const view = { zoom: 2, panX: 10, panY: 20 };
  assert.deepEqual(viewport.constrain(view, 400, 300, 800, 600), view);
});

test('constrain keeps an image smaller than the margin entirely visible', () => {
  const view = { zoom: 1, panX: -500, panY: 900 };
  assert.deepEqual(viewport.constrain(view, 16, 16, 800, 600), { zoom: 1, panX: 0, panY: 584 });
});

test('visibleImageRect returns the on-screen part in whole source pixels', () => {
  const view = { zoom: 2, panX: -101, panY: -50 };
  assert.deepEqual(viewport.visibleImageRect(view, 1000, 1000, 200, 100), {
    x: 50, y: 25, width: 101, height: 50,
  });
});

test('visibleImageRect is the whole image when it fits, and null when it is off screen', () => {
  const inside = { zoom: 1, panX: 10, panY: 10 };
  assert.deepEqual(viewport.visibleImageRect(inside, 100, 50, 800, 600), {
    x: 0, y: 0, width: 100, height: 50,
  });
  const outside = { zoom: 1, panX: 900, panY: 0 };
  assert.equal(viewport.visibleImageRect(outside, 100, 50, 800, 600), null);
});
