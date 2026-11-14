/**
 * Stage: the interactive canvas.
 *
 * Owns everything that happens on the canvas itself: the per-image viewport, pointer gestures
 * (dragging guides, panning, pinch and wheel zoom), hover and selection, and scheduling redraws.
 * It never changes guides itself. A drag is only previewed here; the finished edit is handed to
 * the owner through `onEdit`, which is where it becomes an undoable command.
 */
(function (app) {
  'use strict';

  const { Renderer } = app;
  const { clamp } = app.util;
  const viewports = app.viewport;
  const { moveGuide } = app.slicing;

  /** How close, in CSS pixels, a pointer has to be to grab a guide. Fingers get more slack. */
  const HIT_TOLERANCE = { mouse: 6, pen: 10, touch: 18 };

  /** How far past the image edge a guide must be dragged before releasing it deletes it. */
  const REMOVE_DISTANCE = 24;

  /** Movement below this many pixels is a click, not a drag. */
  const DRAG_THRESHOLD = 3;

  /** One notch of a typical mouse wheel (100 px) zooms by 15%. */
  const WHEEL_ZOOM_RATE = Math.log(1.15) / 100;
  /** Trackpad pinches arrive as ctrl+wheel with much smaller deltas. */
  const PINCH_ZOOM_RATE = 0.01;
  /** Largest wheel delta honored per event, so a free-spinning wheel cannot overshoot. */
  const MAX_WHEEL_DELTA = 240;
  /** Pixel equivalent of one line for wheels that report lines instead of pixels. */
  const WHEEL_LINE_HEIGHT = 100 / 3;

  /** A guide brought into view is kept at least this far from the edge of the canvas. */
  const REVEAL_MARGIN = 32;

  const TOOLTIP_OFFSET = 14;
  /** Room the tooltip needs before it flips to the other side of the pointer. */
  const TOOLTIP_CLEARANCE = { x: 190, y: 40 };

  const sameGuide = (a, b) =>
    a === b || (a !== null && b !== null && a.axis === b.axis && a.index === b.index);
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  class Stage {
    #canvas;
    #tooltip;
    #renderer;
    #handlers;

    /** @type {ImageEntry | null} See images.js. */
    #entry = null;
    #hover = null;
    #selected = null;
    #showPreview = false;
    #panMode = false;

    /** Positions of the pointers currently pressed on the canvas, keyed by pointer id. */
    #pointers = new Map();
    /** The gesture in progress: a guide drag, a pan or a pinch. */
    #gesture = null;
    /** Last known pointer position over the canvas, or null when it is elsewhere. */
    #pointer = null;
    /** Kind of device behind the latest press; double-click events do not carry it themselves. */
    #pointerType = 'mouse';
    #frame = 0;

    /**
     * @param {HTMLCanvasElement} canvas
     * @param {HTMLElement} tooltip
     * @param {Object} handlers
     * @param {(guides: object, label: string, select: object | null) => void} handlers.onEdit
     *   A gesture produced new guides for the current image.
     * @param {() => void} handlers.onSelectionChange
     * @param {() => void} handlers.onViewportChange
     * @param {() => void} handlers.onPointerMove
     */
    constructor(canvas, tooltip, handlers) {
      this.#canvas = canvas;
      this.#tooltip = tooltip;
      this.#handlers = handlers;
      this.#renderer = new Renderer(canvas);

      canvas.addEventListener('pointerdown', this.#onPointerDown);
      canvas.addEventListener('pointermove', this.#onPointerMove);
      canvas.addEventListener('pointerup', this.#onPointerEnd);
      canvas.addEventListener('pointercancel', this.#onPointerEnd);
      canvas.addEventListener('lostpointercapture', this.#onPointerEnd);
      canvas.addEventListener('pointerleave', this.#onPointerLeave);
      canvas.addEventListener('dblclick', this.#onDoubleClick);
      canvas.addEventListener('wheel', this.#onWheel, { passive: false });
      // Keeps a middle-button press from starting the browser's own autoscroll.
      canvas.addEventListener('mousedown', (event) => {
        if (event.button === 1) event.preventDefault();
      });

      this.#observeSize();
    }

    /* Public API */

    /** The selected guide of the current image as { axis, index }, or null. */
    get selection() {
      return this.#selected;
    }

    /** The guide a keyboard command acts on: the one under the pointer, else the selection. */
    get targetGuide() {
      return this.#hover ?? this.#selected;
    }

    /**
     * Pointer position in image pixels, or null when the pointer is not over the image.
     * @returns {{ x: number, y: number } | null}
     */
    get pointerOnImage() {
      const entry = this.#entry;
      if (!entry || !entry.viewport || !this.#pointer) return null;
      const { x, y } = viewports.screenToImage(entry.viewport, this.#pointer.x, this.#pointer.y);
      if (x < 0 || y < 0 || x >= entry.width || y >= entry.height) return null;
      return { x, y };
    }

    /** Switches to another image (or none), restoring the view it was last shown with. */
    setImage(entry) {
      if (entry === this.#entry) return;
      this.cancelGesture();
      this.#entry = entry;
      this.#hover = null;
      this.#selected = null;
      if (entry) this.#adaptView(entry);
      this.#updateCursor();
      this.#requestRender();
      this.#handlers.onViewportChange();
    }

    select(guide) {
      if (sameGuide(guide, this.#selected)) return;
      this.#selected = guide;
      this.#requestRender();
      this.#handlers.onSelectionChange();
    }

    /**
     * Call after the current image's guides have been replaced. Guide indices held from before
     * are meaningless now, so hover is dropped and the selection becomes whatever is passed in.
     */
    guidesReplaced(selection = null) {
      // The guide under the pointer may not even exist any more, so a drag cannot carry on.
      if (this.#gesture?.type === 'guide') this.cancelGesture();
      this.#hover = null;
      this.#selected = selection;
      this.#updateCursor();
      this.#requestRender();
      this.#handlers.onSelectionChange();
    }

    setShowPreview(enabled) {
      this.#showPreview = enabled;
      this.#requestRender();
    }

    /** While pan mode is on (Space held), dragging pans even when it starts on a guide. */
    setPanMode(enabled) {
      if (this.#panMode === enabled) return;
      this.#panMode = enabled;
      this.#updateCursor();
    }

    fit() {
      const entry = this.#entry;
      if (!entry || !entry.viewport) return;
      this.#fit(entry);
      this.#requestRender();
      this.#handlers.onViewportChange();
    }

    /** Sets an absolute zoom level, keeping the center of the view in place. */
    zoomTo(zoom) {
      const entry = this.#entry;
      if (!entry || !entry.viewport) return;
      const { width, height } = this.#renderer;
      this.#setViewport(viewports.zoomTo(entry.viewport, zoom, width / 2, height / 2));
    }

    /** Steps to the next zoom stop: in for a positive direction, out for a negative one. */
    zoomStep(direction) {
      const entry = this.#entry;
      if (!entry || !entry.viewport) return;
      this.zoomTo(viewports.nextZoomStop(entry.viewport.zoom, direction));
    }

    panBy(dx, dy) {
      const entry = this.#entry;
      if (!entry || !entry.viewport) return;
      this.#setViewport(viewports.panBy(entry.viewport, dx, dy));
    }

    /**
     * Pans just far enough to bring a guide of the current image into view. Meant for guides
     * that are picked or moved from the keyboard, where there is no pointer to show the place.
     */
    reveal(guide) {
      const entry = this.#entry;
      if (!entry || !entry.viewport) return;
      const { zoom, panX, panY } = entry.viewport;
      const vertical = guide.axis === 'v';
      const extent = vertical ? this.#renderer.width : this.#renderer.height;
      const margin = Math.min(REVEAL_MARGIN, extent / 2);
      const position = (vertical ? panX : panY) + entry.guides[guide.axis][guide.index] * zoom;
      const shift = clamp(position, margin, extent - margin) - position;
      if (shift !== 0) this.panBy(vertical ? shift : 0, vertical ? 0 : shift);
    }

    /**
     * Abandons the gesture in progress. A guide that is being dragged returns to where it was.
     * @returns {boolean} Whether there was anything to cancel.
     */
    cancelGesture() {
      const gesture = this.#gesture;
      if (!gesture) return false;
      this.#gesture = null;
      if (gesture.type === 'guide') this.#hideTooltip();
      this.#updateCursor();
      this.#requestRender();
      return true;
    }

    /* Rendering and sizing */

    /** Schedules a redraw; any number of requests within a frame result in a single draw. */
    #requestRender() {
      if (this.#frame) return;
      this.#frame = requestAnimationFrame(() => {
        this.#frame = 0;
        this.#draw();
      });
    }

    #draw() {
      const entry = this.#entry;
      if (!entry || !entry.viewport) {
        this.#renderer.draw(null);
        return;
      }
      const gesture = this.#gesture;
      const dragging = gesture?.type === 'guide';
      let { guides } = entry;
      if (dragging && gesture.moved) {
        // Show the guide where it is being dragged to; the image keeps its guides until then.
        const preview = guides[gesture.axis].slice();
        preview[gesture.index] = gesture.px;
        guides = { ...guides, [gesture.axis]: preview };
      }
      this.#renderer.draw({
        image: entry,
        viewport: entry.viewport,
        guides,
        // While a guide is being dragged, nothing else should light up under the pointer.
        hover: dragging ? null : this.#hover,
        selected: this.#selected,
        removing: dragging && gesture.removing,
        showPreview: this.#showPreview,
      });
    }

    #observeSize() {
      const observer = new ResizeObserver(([entry]) => {
        const exact = entry.devicePixelContentBoxSize?.[0];
        this.#resize(
          entry.contentRect,
          exact ? { width: exact.inlineSize, height: exact.blockSize } : null,
        );
      });
      try {
        // Exact device pixels, where supported: avoids the blur of a rounded backing store.
        observer.observe(this.#canvas, { box: 'device-pixel-content-box' });
      } catch {
        observer.observe(this.#canvas);
      }
      this.#watchPixelRatio();
    }

    /**
     * Moving the window to a screen with another pixel density changes the pixel ratio without
     * resizing anything, so not every browser reports it through the resize observer.
     */
    #watchPixelRatio() {
      const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      const onChange = () => {
        this.#resize(this.#canvas.getBoundingClientRect(), null);
        this.#watchPixelRatio();
      };
      query.addEventListener('change', onChange, { once: true });
    }

    /**
     * @param {{ width: number, height: number }} size  Size of the canvas in CSS pixels.
     * @param {{ width: number, height: number } | null} exact  The same in device pixels, as
     *   measured by the browser, when it is known.
     */
    #resize(size, exact) {
      const dpr = window.devicePixelRatio || 1;
      let deviceWidth = Math.round(size.width * dpr);
      let deviceHeight = Math.round(size.height * dpr);
      // The browser's own measurement is better than rounding, which can be a pixel off. It is
      // only usable while it agrees with the pixel ratio, though: device emulation in developer
      // tools changes the ratio but not the measurement, and drawing would come out mis-scaled.
      const agrees =
        exact &&
        Math.abs(exact.width - size.width * dpr) <= 1 &&
        Math.abs(exact.height - size.height * dpr) <= 1;
      if (agrees) {
        deviceWidth = exact.width;
        deviceHeight = exact.height;
      }

      this.#renderer.resize(deviceWidth, deviceHeight, dpr);
      if (this.#entry) {
        this.#adaptView(this.#entry);
        this.#handlers.onViewportChange();
      }

      // Resizing wiped the canvas, so repaint right away instead of waiting for the next frame.
      cancelAnimationFrame(this.#frame);
      this.#frame = 0;
      this.#draw();
    }

    #fit(entry) {
      const { width, height } = this.#renderer;
      entry.viewport = viewports.fit(entry.width, entry.height, width, height);
      entry.fitted = true;
      entry.viewSize = { width, height };
    }

    /**
     * Brings an image's view in line with the current size of the canvas. The size may have
     * changed since the view was laid out, possibly while another image was on screen.
     */
    #adaptView(entry) {
      const { width, height } = this.#renderer;
      // Before the first layout there is no size to lay a view out for; #resize comes back to it.
      if (width === 0 || height === 0) return;

      const laidOutFor = entry.viewSize;
      if (!laidOutFor || entry.fitted) {
        this.#fit(entry);
      } else if (laidOutFor.width !== width || laidOutFor.height !== height) {
        // Keep whatever was in the middle of the view in the middle.
        const dx = (width - laidOutFor.width) / 2;
        const dy = (height - laidOutFor.height) / 2;
        entry.viewport = this.#constrain(entry, viewports.panBy(entry.viewport, dx, dy));
        entry.viewSize = { width, height };
      }
    }

    #constrain(entry, viewport) {
      const { width, height } = this.#renderer;
      return viewports.constrain(viewport, entry.width, entry.height, width, height);
    }

    #setViewport(viewport) {
      const entry = this.#entry;
      entry.viewport = this.#constrain(entry, viewport);
      entry.fitted = false;
      this.#requestRender();
      this.#handlers.onViewportChange();
    }

    /* Hit testing, hover and cursor */

    /** The guide nearest to a screen point, if any lies within the grab tolerance. */
    #hitTest(point, pointerType) {
      const entry = this.#entry;
      const { zoom, panX, panY } = entry.viewport;
      let nearest = null;
      let nearestDistance = HIT_TOLERANCE[pointerType] ?? HIT_TOLERANCE.mouse;

      const consider = (axis, guides, origin, coordinate) => {
        guides.forEach((px, index) => {
          const gap = Math.abs(coordinate - (origin + px * zoom));
          if (gap <= nearestDistance) {
            nearest = { axis, index };
            nearestDistance = gap;
          }
        });
      };
      consider('v', entry.guides.v, panX, point.x);
      consider('h', entry.guides.h, panY, point.y);
      return nearest;
    }

    #setHover(guide) {
      if (sameGuide(guide, this.#hover)) return;
      this.#hover = guide;
      this.#updateCursor();
      this.#requestRender();
    }

    #updateCursor() {
      const gesture = this.#gesture;
      const guide = gesture?.type === 'guide' ? gesture : this.#hover;
      let cursor = '';
      if (gesture?.type === 'pan' && gesture.moved) cursor = 'grabbing';
      else if (this.#panMode && this.#entry) cursor = 'grab';
      else if (guide) cursor = guide.axis === 'v' ? 'col-resize' : 'row-resize';

      if (cursor) this.#canvas.dataset.cursor = cursor;
      else delete this.#canvas.dataset.cursor;
    }

    /* Pointer gestures */

    #onPointerDown = (event) => {
      const entry = this.#entry;
      if (!entry || !entry.viewport) return;
      // Only the primary and middle buttons mean anything here; the rest belong to the browser.
      if (event.button !== 0 && event.button !== 1) return;
      // Two pointers make a pinch. Further fingers are ignored.
      if (this.#pointers.size >= 2) return;

      const point = { x: event.offsetX, y: event.offsetY };
      this.#pointers.set(event.pointerId, point);
      this.#pointerType = event.pointerType;
      // Capturing keeps the gesture alive when the pointer leaves the canvas mid-drag.
      this.#canvas.setPointerCapture(event.pointerId);

      if (this.#pointers.size === 2) {
        this.#beginPinch();
        return;
      }

      if (event.button === 1 || this.#panMode) {
        this.#beginPan(event.pointerId, point, { deselectOnClick: false });
        return;
      }

      const guide = this.#hitTest(point, event.pointerType);
      if (guide) {
        this.select(guide);
        this.#beginGuideDrag(event.pointerId, point, guide);
      } else {
        // Dragging empty space pans; a plain click there clears the selection.
        this.#beginPan(event.pointerId, point, { deselectOnClick: true });
      }
    };

    #onPointerMove = (event) => {
      const point = { x: event.offsetX, y: event.offsetY };
      if (this.#pointers.has(event.pointerId)) this.#pointers.set(event.pointerId, point);
      this.#pointer = point;

      const gesture = this.#gesture;
      if (!gesture) {
        // Touch has no hover: a finger on the glass is already a press.
        if (this.#entry?.viewport && event.pointerType !== 'touch') {
          this.#setHover(this.#hitTest(point, event.pointerType));
        }
      } else if (gesture.type === 'pinch') {
        this.#pinch();
      } else if (gesture.pointerId === event.pointerId) {
        if (gesture.type === 'guide') this.#dragGuide(point);
        else this.#pan(point);
      }
      this.#handlers.onPointerMove();
    };

    /** Handles pointerup, pointercancel and lostpointercapture alike. */
    #onPointerEnd = (event) => {
      // The pointer was already released; lostpointercapture is just following pointerup.
      if (!this.#pointers.delete(event.pointerId)) return;
      if (event.pointerType === 'touch') {
        // A lifted finger is no longer pointing at anything.
        this.#pointer = null;
        this.#handlers.onPointerMove();
      }

      const gesture = this.#gesture;
      if (!gesture) return;

      if (gesture.type === 'pinch') {
        // Let the finger that stays down carry on as a pan.
        const [remaining] = this.#pointers.entries();
        this.#gesture = null;
        if (remaining) {
          this.#beginPan(remaining[0], remaining[1], { deselectOnClick: false });
          this.#gesture.moved = true;
        }
      } else if (gesture.pointerId === event.pointerId) {
        if (gesture.type === 'guide') this.#endGuideDrag(event.type !== 'pointerup');
        else this.#endPan();
      }
      this.#updateCursor();
    };

    #onPointerLeave = () => {
      // During a captured drag the pointer may leave and come back; keep tracking it.
      if (this.#gesture) return;
      this.#pointer = null;
      this.#setHover(null);
      this.#handlers.onPointerMove();
    };

    #onDoubleClick = (event) => {
      const entry = this.#entry;
      if (!entry || !entry.viewport) return;
      const guide = this.#hitTest({ x: event.offsetX, y: event.offsetY }, this.#pointerType);
      if (guide) this.#removeGuide(guide);
    };

    #onWheel = (event) => {
      const entry = this.#entry;
      if (!entry || !entry.viewport) return;
      // Also stops ctrl+wheel and trackpad pinches from zooming the whole page.
      event.preventDefault();

      let delta = event.deltaY;
      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= WHEEL_LINE_HEIGHT;
      else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) delta *= this.#renderer.height;
      delta = clamp(delta, -MAX_WHEEL_DELTA, MAX_WHEEL_DELTA);

      const rate = event.ctrlKey ? PINCH_ZOOM_RATE : WHEEL_ZOOM_RATE;
      const zoom = entry.viewport.zoom * Math.exp(-delta * rate);
      this.#setViewport(viewports.zoomTo(entry.viewport, zoom, event.offsetX, event.offsetY));
    };

    /* Guide dragging */

    #beginGuideDrag(pointerId, point, guide) {
      const entry = this.#entry;
      const { zoom, panX, panY } = entry.viewport;
      const px = entry.guides[guide.axis][guide.index];
      const onScreen = guide.axis === 'v' ? panX + px * zoom : panY + px * zoom;
      this.#gesture = {
        type: 'guide',
        pointerId,
        axis: guide.axis,
        index: guide.index,
        start: point,
        // Distance from the guide to where it was grabbed. Carrying it through the drag stops
        // the guide from jumping under the pointer on the first move.
        grabOffset: (guide.axis === 'v' ? point.x : point.y) - onScreen,
        // Where the guide would land if it were released now.
        px,
        moved: false,
        removing: false,
      };
      this.#updateCursor();
    }

    #dragGuide(point) {
      const entry = this.#entry;
      const gesture = this.#gesture;
      if (!gesture.moved) {
        // A click that merely selects a guide must not nudge it.
        if (distance(point, gesture.start) < DRAG_THRESHOLD) return;
        gesture.moved = true;
      }

      const vertical = gesture.axis === 'v';
      const size = vertical ? entry.width : entry.height;
      const { zoom, panX, panY } = entry.viewport;
      const position = vertical
        ? (point.x - gesture.grabOffset - panX) / zoom
        : (point.y - gesture.grabOffset - panY) / zoom;

      // Pulling a guide well clear of the image marks it for removal, like dragging a ruler
      // guide off the canvas in a graphics editor.
      const overshoot = Math.max(-position, position - size) * zoom;
      gesture.removing = overshoot > REMOVE_DISTANCE;

      const px = clamp(Math.round(position), 1, size - 1);
      gesture.px = px;

      const percent = ((px / size) * 100).toFixed(1);
      this.#showTooltip(
        point,
        gesture.removing ? 'Release to remove' : `${vertical ? 'X' : 'Y'} ${px} px · ${percent}%`,
      );
      this.#requestRender();
    }

    #endGuideDrag(canceled) {
      const { guides, width, height } = this.#entry;
      const { axis, index, px, removing } = this.#gesture;

      this.#gesture = null;
      this.#hideTooltip();
      this.#requestRender();
      if (canceled) return;

      if (removing) {
        this.#removeGuide({ axis, index });
        return;
      }
      if (px === guides[axis][index]) return;

      // Dropping a guide onto another one merges the two.
      const moved = moveGuide(guides[axis], index, px, axis === 'v' ? width : height);
      this.#handlers.onEdit({ ...guides, [axis]: moved.guides }, 'Move guide', {
        axis,
        index: moved.index,
      });
    }

    #removeGuide({ axis, index }) {
      const { guides } = this.#entry;
      const next = { ...guides, [axis]: guides[axis].filter((_, i) => i !== index) };
      this.#hover = null;
      this.#handlers.onEdit(next, 'Remove guide', null);
    }

    /* Panning and pinching */

    #beginPan(pointerId, point, { deselectOnClick }) {
      this.#gesture = {
        type: 'pan',
        pointerId,
        start: point,
        last: point,
        moved: false,
        deselectOnClick,
      };
    }

    #pan(point) {
      const gesture = this.#gesture;
      if (!gesture.moved) {
        if (distance(point, gesture.start) < DRAG_THRESHOLD) return;
        gesture.moved = true;
        this.#updateCursor();
      }
      const { last } = gesture;
      gesture.last = point;
      this.panBy(point.x - last.x, point.y - last.y);
    }

    #endPan() {
      const gesture = this.#gesture;
      this.#gesture = null;
      if (!gesture.moved && gesture.deselectOnClick) this.select(null);
    }

    #beginPinch() {
      // A second finger takes over from whatever the first one was doing.
      this.cancelGesture();
      const [a, b] = this.#pointers.values();
      this.#gesture = { type: 'pinch', center: midpoint(a, b), spread: distance(a, b) || 1 };
    }

    #pinch() {
      const entry = this.#entry;
      const gesture = this.#gesture;
      const [a, b] = this.#pointers.values();
      const center = midpoint(a, b);
      const spread = distance(a, b) || 1;

      // Zoom about the point between the fingers, and follow it as the fingers travel.
      const zoom = entry.viewport.zoom * (spread / gesture.spread);
      const zoomed = viewports.zoomTo(entry.viewport, zoom, center.x, center.y);
      this.#setViewport(
        viewports.panBy(zoomed, center.x - gesture.center.x, center.y - gesture.center.y),
      );
      gesture.center = center;
      gesture.spread = spread;
    }

    /* Tooltip */

    #showTooltip(point, text) {
      const tooltip = this.#tooltip;
      if (tooltip.textContent !== text) tooltip.textContent = text;
      tooltip.hidden = false;

      // Flip to the other side of the pointer rather than run off the edge of the stage.
      const { width, height } = this.#renderer;
      const flipX = point.x > width - TOOLTIP_CLEARANCE.x;
      const flipY = point.y > height - TOOLTIP_CLEARANCE.y;
      const x = point.x + (flipX ? -TOOLTIP_OFFSET : TOOLTIP_OFFSET);
      const y = point.y + (flipY ? -TOOLTIP_OFFSET : TOOLTIP_OFFSET);
      tooltip.style.transform =
        `translate(${x}px, ${y}px) translate(${flipX ? '-100%' : '0'}, ${flipY ? '-100%' : '0'})`;
    }

    #hideTooltip() {
      this.#tooltip.hidden = true;
    }
  }

  app.Stage = Stage;
})((globalThis.SliceStudio = globalThis.SliceStudio || {}));
