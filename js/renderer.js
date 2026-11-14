/**
 * Canvas renderer: paints the active image, its guides and the optional tile overlay.
 *
 * The renderer keeps no application state. The caller hands it a complete scene for every
 * frame; the only things cached here are drawing resources. Coordinates are CSS pixels, and the
 * backing store is scaled by the device pixel ratio so output stays sharp on HiDPI screens.
 */
(function (app) {
  'use strict';

  const { boundaries } = app.slicing;
  const { visibleImageRect } = app.viewport;

  /**
   * @typedef {{ axis: 'v' | 'h', index: number }} GuideRef
   *
   * @typedef {Object} Scene
   * @property {{ source: CanvasImageSource, width: number, height: number }} image
   * @property {{ zoom: number, panX: number, panY: number }} viewport
   * @property {{ v: number[], h: number[] }} guides
   *   While a guide is being dragged its list may be out of order or hold a duplicate.
   * @property {GuideRef | null} hover
   * @property {GuideRef | null} selected
   * @property {boolean} removing  The selected guide is being dragged off the image.
   * @property {boolean} showPreview
   */

  const SHADOW_OFFSET = 4;
  const CHECKER_CELL = 8;

  const LABEL_FONT_SIZE = 12;
  const LABEL_LINE_HEIGHT = 16;
  const LABEL_PADDING = 7;
  /** Clearance between a label box and the edges of its tile. */
  const LABEL_MARGIN = 3;
  const LABEL_BACKDROP = 'rgba(16, 16, 16, 0.7)';
  const LABEL_SECONDARY_TEXT = 'rgba(255, 255, 255, 0.7)';

  /** Reads the palette from the stylesheet so canvas drawing follows the CSS theme. */
  function readTheme(element) {
    const style = getComputedStyle(element);
    const color = (property, fallback) => style.getPropertyValue(property).trim() || fallback;
    return {
      guide: color('--c-cyan', '#00ffff'),
      guideSelected: color('--guide-selected', '#ffffff'),
      danger: color('--danger', '#ff3355'),
      checkerDark: color('--checker-dark', '#141414'),
      checkerLight: color('--checker-light', '#1d1d1d'),
      font: style.fontFamily || 'monospace',
    };
  }

  /** Indices [first, last] of the slices that intersect a view of `viewSize` pixels. */
  function visibleSlices(cuts, origin, zoom, viewSize) {
    let first = 0;
    let last = cuts.length - 2;
    while (first < last && origin + cuts[first + 1] * zoom <= 0) first += 1;
    while (last > first && origin + cuts[last] * zoom >= viewSize) last -= 1;
    return [first, last];
  }

  const refersTo = (ref, axis, index) => ref !== null && ref.axis === axis && ref.index === index;

  class Renderer {
    #canvas;
    #ctx;
    #theme;
    #dpr = 1;
    #width = 0;
    #height = 0;
    #checker = null;

    /** @param {HTMLCanvasElement} canvas */
    constructor(canvas) {
      this.#canvas = canvas;
      this.#ctx = canvas.getContext('2d');
      this.#theme = readTheme(canvas);
    }

    /** View width in CSS pixels. */
    get width() {
      return this.#width;
    }

    /** View height in CSS pixels. */
    get height() {
      return this.#height;
    }

    /**
     * Resizes the backing store. Changing a canvas's size clears it, so the caller is expected
     * to draw again before the browser paints.
     */
    resize(deviceWidth, deviceHeight, devicePixelRatio) {
      this.#dpr = devicePixelRatio;
      this.#width = deviceWidth / devicePixelRatio;
      this.#height = deviceHeight / devicePixelRatio;
      if (this.#canvas.width !== deviceWidth) this.#canvas.width = deviceWidth;
      if (this.#canvas.height !== deviceHeight) this.#canvas.height = deviceHeight;
    }

    /** @param {Scene | null} scene  Null clears the canvas. */
    draw(scene) {
      const ctx = this.#ctx;
      ctx.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
      ctx.clearRect(0, 0, this.#width, this.#height);
      if (!scene) return;

      // Starting the image on a device pixel keeps whole-number zoom levels perfectly sharp.
      const origin = {
        x: this.#snap(scene.viewport.panX),
        y: this.#snap(scene.viewport.panY),
      };

      this.#drawImage(scene, origin);
      if (scene.showPreview) this.#drawTileLabels(scene, origin);
      this.#drawGuides(scene, origin);
    }

    #snap(value) {
      return Math.round(value * this.#dpr) / this.#dpr;
    }

    /** Intersection of a rectangle with the view, or null when it is entirely off screen. */
    #clipToView(x, y, width, height) {
      const left = Math.max(x, 0);
      const top = Math.max(y, 0);
      const right = Math.min(x + width, this.#width);
      const bottom = Math.min(y + height, this.#height);
      if (right <= left || bottom <= top) return null;
      return { x: left, y: top, width: right - left, height: bottom - top };
    }

    #checkerPattern() {
      if (!this.#checker) {
        const tile = document.createElement('canvas');
        tile.width = CHECKER_CELL * 2;
        tile.height = CHECKER_CELL * 2;
        const ctx = tile.getContext('2d');
        ctx.fillStyle = this.#theme.checkerDark;
        ctx.fillRect(0, 0, tile.width, tile.height);
        ctx.fillStyle = this.#theme.checkerLight;
        ctx.fillRect(0, 0, CHECKER_CELL, CHECKER_CELL);
        ctx.fillRect(CHECKER_CELL, CHECKER_CELL, CHECKER_CELL, CHECKER_CELL);
        this.#checker = this.#ctx.createPattern(tile, 'repeat');
      }
      return this.#checker;
    }

    #drawImage({ image, viewport }, origin) {
      const ctx = this.#ctx;
      const { zoom } = viewport;
      const width = image.width * zoom;
      const height = image.height * zoom;

      // Hard-edged drop shadow: gives the image some depth without the cost of a blur.
      const shadow = this.#clipToView(
        origin.x + SHADOW_OFFSET,
        origin.y + SHADOW_OFFSET,
        width,
        height,
      );
      if (shadow) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(shadow.x, shadow.y, shadow.width, shadow.height);
      }

      const onScreen = this.#clipToView(origin.x, origin.y, width, height);
      if (!onScreen) return;

      // Checkerboard backdrop so transparent areas read as transparent. It is anchored to the
      // image origin, which makes it travel with the image while panning.
      ctx.save();
      ctx.translate(origin.x, origin.y);
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = this.#checkerPattern();
      ctx.fillRect(onScreen.x - origin.x, onScreen.y - origin.y, onScreen.width, onScreen.height);
      ctx.restore();

      // Only the visible part of the source is drawn. At high zoom the full destination
      // rectangle can be hundreds of thousands of pixels wide, which canvas backends handle
      // slowly or not at all.
      const source = visibleImageRect(
        { zoom, panX: origin.x, panY: origin.y },
        image.width,
        image.height,
        this.#width,
        this.#height,
      );
      if (!source) return;

      // Past 100% individual pixels must stay crisp for precise slicing.
      ctx.imageSmoothingEnabled = zoom <= 1;
      ctx.drawImage(
        image.source,
        source.x,
        source.y,
        source.width,
        source.height,
        origin.x + source.x * zoom,
        origin.y + source.y * zoom,
        source.width * zoom,
        source.height * zoom,
      );
    }

    /**
     * Overlay that labels every tile with its row/column and pixel size, i.e. what an export
     * would produce. Labels are skipped for tiles that are off screen or too small to hold
     * them, which also keeps dense grids cheap to draw.
     */
    #drawTileLabels({ image, viewport, guides }, origin) {
      const xs = boundaries(guides.v, image.width);
      const ys = boundaries(guides.h, image.height);
      if (xs.length === 2 && ys.length === 2) return;

      const ctx = this.#ctx;
      const { zoom } = viewport;
      const { guide } = this.#theme;

      ctx.save();
      ctx.font = `${LABEL_FONT_SIZE}px ${this.#theme.font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // The UI font is monospaced, so one measurement sizes every label.
      const charWidth = ctx.measureText('0').width;
      const boxWidth = (text) => text.length * charWidth + LABEL_PADDING * 2;

      const [firstRow, lastRow] = visibleSlices(ys, origin.y, zoom, this.#height);
      const [firstCol, lastCol] = visibleSlices(xs, origin.x, zoom, this.#width);

      for (let row = firstRow; row <= lastRow; row++) {
        const tileHeight = ys[row + 1] - ys[row];
        const cellHeight = tileHeight * zoom - LABEL_MARGIN * 2;
        if (cellHeight < LABEL_LINE_HEIGHT) continue;
        const centerY = origin.y + (ys[row] + tileHeight / 2) * zoom;

        for (let col = firstCol; col <= lastCol; col++) {
          const tileWidth = xs[col + 1] - xs[col];
          const cellWidth = tileWidth * zoom - LABEL_MARGIN * 2;
          const centerX = origin.x + (xs[col] + tileWidth / 2) * zoom;

          const position = `R${row + 1} · C${col + 1}`;
          const size = `${tileWidth} × ${tileHeight}`;
          const fullWidth = Math.max(boxWidth(position), boxWidth(size));

          if (cellWidth >= fullWidth && cellHeight >= LABEL_LINE_HEIGHT * 2) {
            const top = centerY - LABEL_LINE_HEIGHT;
            ctx.fillStyle = LABEL_BACKDROP;
            ctx.fillRect(centerX - fullWidth / 2, top, fullWidth, LABEL_LINE_HEIGHT * 2);
            ctx.fillStyle = guide;
            ctx.fillText(position, centerX, centerY - LABEL_LINE_HEIGHT / 2);
            ctx.fillStyle = LABEL_SECONDARY_TEXT;
            ctx.fillText(size, centerX, centerY + LABEL_LINE_HEIGHT / 2);
          } else if (cellWidth >= boxWidth(position)) {
            // Tight tile: the position alone is still useful for finding it in the export.
            const width = boxWidth(position);
            const top = centerY - LABEL_LINE_HEIGHT / 2;
            ctx.fillStyle = LABEL_BACKDROP;
            ctx.fillRect(centerX - width / 2, top, width, LABEL_LINE_HEIGHT);
            ctx.fillStyle = guide;
            ctx.fillText(position, centerX, centerY);
          }
        }
      }
      ctx.restore();
    }

    #drawGuides({ viewport, guides, hover, selected, removing }, origin) {
      const ctx = this.#ctx;
      const dpr = this.#dpr;
      const { zoom } = viewport;
      const theme = this.#theme;
      const viewWidth = this.#width;
      const viewHeight = this.#height;

      // Lines are positioned in device pixels so they stay sharp at fractional pixel ratios.
      const deviceWidth = (cssWidth) => Math.max(1, Math.round(cssWidth * dpr));
      const lineCenter = (position, width) => (Math.round(position * dpr) + (width % 2) / 2) / dpr;

      const trace = (axis, px, width) => {
        if (axis === 'v') {
          const x = lineCenter(origin.x + px * zoom, width);
          if (x < -1 || x > viewWidth + 1) return;
          ctx.moveTo(x, 0);
          ctx.lineTo(x, viewHeight);
        } else {
          const y = lineCenter(origin.y + px * zoom, width);
          if (y < -1 || y > viewHeight + 1) return;
          ctx.moveTo(0, y);
          ctx.lineTo(viewWidth, y);
        }
      };

      ctx.save();
      ctx.strokeStyle = theme.guide;
      ctx.shadowColor = theme.guide;

      // Idle guides share one path, so their glow costs a single shadow pass per frame however
      // many guides there are. Emphasized guides are collected and drawn on top afterward.
      const emphasized = [];
      const thin = deviceWidth(1);
      ctx.lineWidth = thin / dpr;
      ctx.globalAlpha = 0.82;
      ctx.shadowBlur = 3 * dpr;
      ctx.beginPath();
      for (const axis of ['v', 'h']) {
        guides[axis].forEach((px, index) => {
          if (refersTo(hover, axis, index) || refersTo(selected, axis, index)) {
            emphasized.push({ axis, index, px });
          } else {
            trace(axis, px, thin);
          }
        });
      }
      ctx.stroke();

      const thick = deviceWidth(2);
      ctx.lineWidth = thick / dpr;
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 8 * dpr;
      for (const { axis, index, px } of emphasized) {
        const isSelected = refersTo(selected, axis, index);
        const willBeRemoved = isSelected && removing;
        let color = theme.guide;
        if (willBeRemoved) color = theme.danger;
        else if (isSelected) color = theme.guideSelected;

        ctx.strokeStyle = color;
        ctx.shadowColor = willBeRemoved ? theme.danger : theme.guide;
        ctx.setLineDash(willBeRemoved ? [6, 4] : []);
        ctx.beginPath();
        trace(axis, px, thick);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  app.Renderer = Renderer;
})((globalThis.SliceStudio = globalThis.SliceStudio || {}));
