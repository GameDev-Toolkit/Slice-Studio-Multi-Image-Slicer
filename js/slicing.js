/**
 * Slicing model: guides, tile boundaries and portable guide layouts.
 *
 * A guide is an integer pixel offset into the source image. Each axis keeps its guides sorted,
 * unique and strictly inside the image (0 < guide < size), so the line drawn on screen is always
 * the exact cut that gets exported, whatever the zoom level.
 *
 * Everything in this file is pure and DOM-free, which is what lets it be unit-tested under Node.
 */
(function (app) {
  'use strict';

  /**
   * @typedef {{ v: number[], h: number[] }} Guides
   *   Vertical guides (x offsets) and horizontal guides (y offsets).
   * @typedef {{ row: number, col: number, index: number,
   *             x: number, y: number, width: number, height: number }} Tile
   *   Zero-based grid position plus the source rectangle, in image pixels.
   */

  /** Upper bound on slices per axis; keeps guide counts and export sizes within reason. */
  const MAX_SLICES_PER_AXIS = 256;

  const LAYOUT_TYPE = 'slice-studio/layout';
  const LAYOUT_VERSION = 1;
  /** Far more than the largest valid layout needs; anything longer is not worth parsing. */
  const MAX_LAYOUT_TEXT_LENGTH = 16 * 1024;

  const ascending = (a, b) => a - b;

  /**
   * Returns guides as sorted, unique integers strictly inside (0, size).
   * Out-of-range values are dropped rather than clamped: a guide sitting on the image edge
   * would not cut anything.
   */
  function normalizeGuides(values, size) {
    const inside = new Set();
    for (const value of values) {
      const px = Math.round(value);
      // NaN fails both comparisons, so non-finite input is discarded here as well.
      if (px > 0 && px < size) inside.add(px);
    }
    return [...inside].sort(ascending);
  }

  /** Cut positions along one axis including both image edges: [0, ...guides, size]. */
  function boundaries(guides, size) {
    return [0, ...normalizeGuides(guides, size), size];
  }

  /** @returns {Guides} */
  function cloneGuides(guides) {
    return { v: [...guides.v], h: [...guides.h] };
  }

  function sameList(a, b) {
    return a.length === b.length && a.every((value, i) => value === b[i]);
  }

  function guidesEqual(a, b) {
    return sameList(a.v, b.v) && sameList(a.h, b.h);
  }

  /**
   * Guides that divide `size` pixels into `count` parts of (as near as possible) equal size.
   * An image with fewer pixels than that gets one part per pixel.
   */
  function splitByCount(size, count) {
    const guides = [];
    // The fraction is formed first on purpose. Where a cut falls exactly on half a pixel, the
    // order of the operations decides which way it rounds, and this order keeps every cut on
    // the pixel where earlier versions of the app put it.
    for (let i = 1; i < count; i++) guides.push(Math.round((i / count) * size));
    return normalizeGuides(guides, size);
  }

  /** Number of slices produced by cutting `size` pixels every `cell` pixels. */
  function sliceCountForCell(size, cell) {
    return Math.ceil(size / cell);
  }

  /** Guides every `cell` pixels. The last slice is narrower when `size` is not a multiple. */
  function splitByCell(size, cell) {
    const step = Math.floor(cell);
    const guides = [];
    // Also rejects NaN; a step below one pixel would never reach the far edge.
    if (!(step >= 1)) return guides;
    for (let px = step; px < size; px += step) guides.push(px);
    return guides;
  }

  /** Middle of the widest gap between cuts, or null when no gap has room for another guide. */
  function midpointOfLargestGap(guides, size) {
    const cuts = boundaries(guides, size);
    let widest = 1;
    let midpoint = null;
    for (let i = 1; i < cuts.length; i++) {
      const gap = cuts[i] - cuts[i - 1];
      if (gap > widest) {
        widest = gap;
        midpoint = Math.round((cuts[i - 1] + cuts[i]) / 2);
      }
    }
    return midpoint;
  }

  /**
   * Replaces the guide at `index` with `px` and re-normalizes.
   * @returns {{ guides: number[], index: number }} The new list and the guide's new index, or
   *   -1 when it left the image. Moving onto another guide merges the two.
   */
  function moveGuide(guides, index, px, size) {
    const next = guides.slice();
    next[index] = px;
    const normalized = normalizeGuides(next, size);
    return { guides: normalized, index: normalized.indexOf(Math.round(px)) };
  }

  /**
   * Moves the guide at `index` by `delta` pixels without ever merging it into a neighbor:
   * occupied positions are stepped over in the direction of travel.
   * @returns {{ guides: number[], index: number } | null} Null when the guide cannot move.
   */
  function nudgeGuide(guides, index, delta, size) {
    const current = guides[index];
    const occupied = new Set(guides);
    occupied.delete(current);

    const step = delta < 0 ? -1 : 1;
    const target = Math.min(Math.max(current + delta, 1), size - 1);

    let px = target;
    while (occupied.has(px)) px += step;
    if (px < 1 || px > size - 1) {
      // Ran off the image; settle for the nearest free position short of the target instead.
      px = target;
      while (occupied.has(px)) px -= step;
    }
    return px === current ? null : moveGuide(guides, index, px, size);
  }

  /** Maps guides proportionally from one axis length to another. */
  function scaleGuides(guides, fromSize, toSize) {
    const scaled = fromSize === toSize ? guides : guides.map((px) => (px * toSize) / fromSize);
    return normalizeGuides(scaled, toSize);
  }

  /**
   * Enumerates the tiles of an image in row-major order.
   * @param {Guides} guides
   * @returns {{ columns: number, rows: number, tiles: Tile[] }}
   */
  function tileGrid(guides, width, height) {
    const xs = boundaries(guides.v, width);
    const ys = boundaries(guides.h, height);
    const tiles = [];
    for (let row = 0; row < ys.length - 1; row++) {
      for (let col = 0; col < xs.length - 1; col++) {
        tiles.push({
          row,
          col,
          index: tiles.length,
          x: xs[col],
          y: ys[row],
          width: xs[col + 1] - xs[col],
          height: ys[row + 1] - ys[row],
        });
      }
    }
    return { columns: xs.length - 1, rows: ys.length - 1, tiles };
  }

  /**
   * Offset that centers `inner` within `outer`. Negative when the content is larger than its
   * container, which is how fixed-size export crops.
   */
  function centerOffset(outer, inner) {
    return Math.round((outer - inner) / 2);
  }

  /** Serializes an image's guides so they can travel through the clipboard. */
  function serializeLayout({ width, height, guides }) {
    return JSON.stringify({
      type: LAYOUT_TYPE,
      version: LAYOUT_VERSION,
      width,
      height,
      vertical: guides.v,
      horizontal: guides.h,
    });
  }

  const isDimension = (value) => Number.isSafeInteger(value) && value > 0;
  const isGuideList = (value) =>
    Array.isArray(value) && value.length < MAX_SLICES_PER_AXIS && value.every(Number.isFinite);

  /**
   * Parses text produced by serializeLayout. Clipboard content is untrusted input, so anything
   * that does not have exactly the expected shape yields null.
   * @returns {{ width: number, height: number, guides: Guides } | null}
   */
  function parseLayout(text) {
    if (typeof text !== 'string' || text.length > MAX_LAYOUT_TEXT_LENGTH) return null;

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return null;
    }
    if (data === null || typeof data !== 'object') return null;
    if (data.type !== LAYOUT_TYPE || data.version !== LAYOUT_VERSION) return null;

    const { width, height, vertical, horizontal } = data;
    if (!isDimension(width) || !isDimension(height)) return null;
    if (!isGuideList(vertical) || !isGuideList(horizontal)) return null;

    return {
      width,
      height,
      guides: { v: normalizeGuides(vertical, width), h: normalizeGuides(horizontal, height) },
    };
  }

  /**
   * Fits a layout to an image of any size, keeping the guides' relative positions.
   * @returns {Guides}
   */
  function fitLayout(layout, width, height) {
    return {
      v: scaleGuides(layout.guides.v, layout.width, width),
      h: scaleGuides(layout.guides.h, layout.height, height),
    };
  }

  app.slicing = {
    MAX_SLICES_PER_AXIS,
    normalizeGuides,
    boundaries,
    cloneGuides,
    guidesEqual,
    splitByCount,
    sliceCountForCell,
    splitByCell,
    midpointOfLargestGap,
    moveGuide,
    nudgeGuide,
    tileGrid,
    centerOffset,
    serializeLayout,
    parseLayout,
    fitLayout,
  };
})((globalThis.SliceStudio = globalThis.SliceStudio || {}));
