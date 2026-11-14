/**
 * Viewport math: the zoom/pan transform between image pixels and on-screen CSS pixels.
 *
 *   screenX = panX + imageX * zoom
 *   screenY = panY + imageY * zoom
 *
 * Viewports are plain immutable values; every function returns a new one.
 * Pure and DOM-free; unit-tested under Node.
 */
(function (app) {
  'use strict';

  /** @typedef {{ zoom: number, panX: number, panY: number }} Viewport */

  const MIN_ZOOM = 0.02;
  const MAX_ZOOM = 64;

  /** Breathing room around a fitted image, capped so small screens are not mostly margin. */
  const FIT_PADDING = 64;
  const FIT_PADDING_RATIO = 0.08;

  /** How much of the image must stay on screen, so it cannot be panned out of reach. */
  const MIN_VISIBLE = 48;

  /** Stops used by the zoom buttons and keys; the wheel zooms continuously instead. */
  const ZOOM_STOPS = [
    0.02, 0.03, 0.05, 0.0625, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667,
    1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64,
  ];

  const { clamp } = app.util;

  /**
   * Largest zoom at which the whole image is visible, centered in the view. Small images are
   * magnified, but only by whole multiples so that source pixels stay square and evenly sized.
   * @returns {Viewport}
   */
  function fit(imageWidth, imageHeight, viewWidth, viewHeight) {
    const paddingX = Math.min(FIT_PADDING, viewWidth * FIT_PADDING_RATIO);
    const paddingY = Math.min(FIT_PADDING, viewHeight * FIT_PADDING_RATIO);
    const availableWidth = Math.max(viewWidth - paddingX * 2, 1);
    const availableHeight = Math.max(viewHeight - paddingY * 2, 1);

    let zoom = Math.min(availableWidth / imageWidth, availableHeight / imageHeight);
    if (zoom > 1) zoom = Math.floor(zoom);
    zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);

    return {
      zoom,
      panX: (viewWidth - imageWidth * zoom) / 2,
      panY: (viewHeight - imageHeight * zoom) / 2,
    };
  }

  function screenToImage(viewport, screenX, screenY) {
    return {
      x: (screenX - viewport.panX) / viewport.zoom,
      y: (screenY - viewport.panY) / viewport.zoom,
    };
  }

  /**
   * Sets the zoom level while keeping the image point under (anchorX, anchorY) stationary.
   * @returns {Viewport}
   */
  function zoomTo(viewport, zoom, anchorX, anchorY) {
    const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    const scale = next / viewport.zoom;
    return {
      zoom: next,
      panX: anchorX - (anchorX - viewport.panX) * scale,
      panY: anchorY - (anchorY - viewport.panY) * scale,
    };
  }

  /** @returns {Viewport} */
  function panBy(viewport, dx, dy) {
    return { zoom: viewport.zoom, panX: viewport.panX + dx, panY: viewport.panY + dy };
  }

  /**
   * Next stop above (direction > 0) or below the current zoom. The small tolerance keeps a
   * zoom that is already on a stop from "stepping" to itself because of rounding.
   */
  function nextZoomStop(zoom, direction) {
    if (direction > 0) {
      return ZOOM_STOPS.find((stop) => stop > zoom * 1.001) ?? MAX_ZOOM;
    }
    return ZOOM_STOPS.findLast((stop) => stop < zoom * 0.999) ?? MIN_ZOOM;
  }

  /**
   * Limits panning so that at least MIN_VISIBLE pixels of the image (or all of it, if it is
   * smaller than that) remain inside the view.
   * @returns {Viewport}
   */
  function constrain(viewport, imageWidth, imageHeight, viewWidth, viewHeight) {
    const width = imageWidth * viewport.zoom;
    const height = imageHeight * viewport.zoom;
    const keepX = Math.min(MIN_VISIBLE, width, viewWidth);
    const keepY = Math.min(MIN_VISIBLE, height, viewHeight);
    return {
      zoom: viewport.zoom,
      panX: clamp(viewport.panX, keepX - width, viewWidth - keepX),
      panY: clamp(viewport.panY, keepY - height, viewHeight - keepY),
    };
  }

  /**
   * The part of the image that is on screen, widened to whole source pixels.
   * @returns {{ x: number, y: number, width: number, height: number } | null}
   *   Null when the image is entirely outside the view.
   */
  function visibleImageRect(viewport, imageWidth, imageHeight, viewWidth, viewHeight) {
    const topLeft = screenToImage(viewport, 0, 0);
    const bottomRight = screenToImage(viewport, viewWidth, viewHeight);
    const left = Math.max(Math.floor(topLeft.x), 0);
    const top = Math.max(Math.floor(topLeft.y), 0);
    const right = Math.min(Math.ceil(bottomRight.x), imageWidth);
    const bottom = Math.min(Math.ceil(bottomRight.y), imageHeight);
    if (right <= left || bottom <= top) return null;
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  app.viewport = {
    MIN_ZOOM,
    MAX_ZOOM,
    fit,
    screenToImage,
    zoomTo,
    panBy,
    nextZoomStop,
    constrain,
    visibleImageRect,
  };
})((globalThis.SliceStudio = globalThis.SliceStudio || {}));
