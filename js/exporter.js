/**
 * Export pipeline: plans the output files, encodes every tile and packs the result into a ZIP.
 *
 * Planning (planExport) is pure and unit-tested under Node. Encoding and packing need a browser:
 * tiles are rendered through a canvas and the archive is assembled by JSZip.
 */
/* global JSZip */
(function (app) {
  'use strict';

  const { naming } = app;
  const { tileGrid, centerOffset } = app.slicing;

  /**
   * @typedef {Object} ExportOptions
   * @property {'png' | 'jpeg' | 'webp'} format
   * @property {number} quality  0..1; only used by lossy formats.
   * @property {string} template  Naming template, see naming.js.
   * @property {{ width: number, height: number } | null} fixedSize
   *   When set, every tile is centered on a canvas of this size: padded if smaller, cropped if
   *   larger, never scaled.
   * @property {boolean} skipEmpty  Leave out tiles that are fully transparent.
   * @property {boolean} manifest  Add a manifest.json describing every exported tile.
   *
   * @typedef {Object} SourceImage
   * @property {string} name  Original file name.
   * @property {number} width
   * @property {number} height
   * @property {{ v: number[], h: number[] }} guides
   * @property {CanvasImageSource} source
   */

  const FORMATS = {
    png: { mime: 'image/png', extension: '.png', lossy: false, alpha: true },
    jpeg: { mime: 'image/jpeg', extension: '.jpg', lossy: true, alpha: false },
    webp: { mime: 'image/webp', extension: '.webp', lossy: true, alpha: true },
  };

  const MANIFEST_STEM = 'manifest';
  const MANIFEST_EXTENSION = '.json';

  /**
   * JSZip writes classic archives without ZIP64 extensions. Their entry count is a 16-bit field
   * and offsets are 32-bit, with the all-ones value reserved in both; exceeding either produces
   * a file that looks fine but cannot be unpacked, so both limits are enforced up front.
   */
  const MAX_ZIP_ENTRIES = 0xffff - 1;
  const MAX_ZIP_BYTES = 0xffffffff - 1;
  /** Fixed-size part of a local file header plus its central directory record. */
  const ZIP_ENTRY_OVERHEAD = 30 + 46;

  /** Share of the progress bar given to encoding; the rest covers assembling the archive. */
  const ENCODING_SHARE = 0.9;

  /** Pixels read back per chunk when checking whether a tile is empty. */
  const BLANK_SCAN_CHUNK = 256 * 1024;

  /** Longest the export works, in milliseconds, before it lets the page handle input again. */
  const MAX_BLOCKING_TIME = 40;

  /** Flattening color for formats without an alpha channel. */
  const OPAQUE_BACKGROUND = '#ffffff';

  const utf8 = new TextEncoder();
  const formatCount = (value) => value.toLocaleString('en-US');

  /**
   * Decides, without touching any pixels, exactly which files an export will contain.
   *
   * Names are made unique twice over: source images that share a base name get distinct
   * {name} values, and any two tiles that still render to the same path (for example with a
   * template that has no row/column placeholder) are numbered. Nothing is ever overwritten.
   *
   * @param {SourceImage[]} images
   * @param {ExportOptions} options
   * @throws {Error} When the template is invalid or the archive would exceed ZIP limits.
   */
  function planExport(images, options) {
    const format = FORMATS[options.format];
    if (!format) throw new Error(`Unsupported export format "${options.format}".`);

    const template = naming.compileTemplate(options.template);
    if (!template.ok) throw new Error(template.error);

    const imageNames = new naming.NameRegistry();
    const paths = new naming.NameRegistry();
    if (options.manifest) paths.claim(MANIFEST_STEM, MANIFEST_EXTENSION);

    const folders = new Set();
    let tileCount = 0;
    let deduplicated = false;

    const plannedImages = images.map((image) => {
      const baseName = naming.sanitizeSegment(naming.stripExtension(image.name));
      const name = imageNames.claim(baseName);
      if (name !== baseName) deduplicated = true;

      const grid = tileGrid(image.guides, image.width, image.height);
      const tiles = grid.tiles.map((tile) => {
        const wanted = naming.renderPath(template, { ...tile, name });
        const stem = paths.claim(wanted, format.extension);
        if (stem !== wanted) deduplicated = true;

        // JSZip adds an entry for every folder on the way down; they count toward the limit.
        for (let slash = stem.indexOf('/'); slash !== -1; slash = stem.indexOf('/', slash + 1)) {
          folders.add(stem.slice(0, slash));
        }
        return { ...tile, path: stem + format.extension };
      });

      tileCount += tiles.length;
      return {
        source: image.source,
        sourceName: image.name,
        width: image.width,
        height: image.height,
        columns: grid.columns,
        rows: grid.rows,
        tiles,
      };
    });

    const entryCount = tileCount + folders.size + (options.manifest ? 1 : 0);
    if (entryCount > MAX_ZIP_ENTRIES) {
      throw new Error(
        `This export would contain ${formatCount(entryCount)} files, but a ZIP archive holds at ` +
          `most ${formatCount(MAX_ZIP_ENTRIES)}. Export fewer images at once or use fewer slices.`,
      );
    }

    return {
      images: plannedImages,
      tileCount,
      deduplicated,
      format,
      archiveName: naming.archiveName(images.map((image) => image.name)),
    };
  }

  /** True when every pixel of the canvas is fully transparent. */
  function isBlank(ctx, width, height) {
    // Reading in bands lets the scan stop at the first visible pixel instead of copying the
    // whole tile out of the canvas first.
    const bandHeight = Math.max(1, Math.floor(BLANK_SCAN_CHUNK / width));
    for (let y = 0; y < height; y += bandHeight) {
      const { data } = ctx.getImageData(0, y, width, Math.min(bandHeight, height - y));
      // Canvas pixels are premultiplied, so zero alpha implies zero color: test whole pixels.
      const pixels = new Uint32Array(data.buffer);
      for (let i = 0; i < pixels.length; i++) {
        if (pixels[i] !== 0) return false;
      }
    }
    return true;
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          // A null blob is how browsers report a canvas beyond their size limits. A blob of
          // another type means the requested format is unsupported and PNG was substituted.
          if (blob && blob.type === mime) {
            resolve(blob);
          } else {
            const size = `${canvas.width} × ${canvas.height} px`;
            reject(new Error(`the browser could not encode a ${size} tile`));
          }
        },
        mime,
        quality,
      );
    });
  }

  /** Renders tiles through a single reusable canvas. */
  class TileEncoder {
    #canvas = document.createElement('canvas');
    #ctx;
    #format;
    #quality;
    #fixedSize;
    #skipEmpty;

    constructor(format, { quality, fixedSize, skipEmpty }) {
      this.#format = format;
      this.#quality = format.lossy ? quality : undefined;
      this.#fixedSize = fixedSize;
      this.#skipEmpty = skipEmpty;
      // Pixels are only read back to detect empty tiles; the hint keeps such a canvas in
      // software, where those reads are cheap.
      this.#ctx = this.#canvas.getContext('2d', { willReadFrequently: skipEmpty });
    }

    /**
     * @returns {Promise<Blob | null>} Null when the tile is empty and empty tiles are skipped.
     */
    async encode(source, tile) {
      const canvas = this.#canvas;
      const ctx = this.#ctx;
      const width = this.#fixedSize ? this.#fixedSize.width : tile.width;
      const height = this.#fixedSize ? this.#fixedSize.height : tile.height;

      if (canvas.width !== width || canvas.height !== height) {
        // Resizing also clears the canvas and resets the context state.
        canvas.width = width;
        canvas.height = height;
      } else {
        ctx.clearRect(0, 0, width, height);
      }

      // Tiles are always sampled 1:1 from the full-resolution source, never from the screen.
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        source,
        tile.x,
        tile.y,
        tile.width,
        tile.height,
        centerOffset(width, tile.width),
        centerOffset(height, tile.height),
        tile.width,
        tile.height,
      );

      if (this.#skipEmpty && isBlank(ctx, width, height)) return null;

      if (!this.#format.alpha) {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = OPAQUE_BACKGROUND;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      }
      return canvasToBlob(canvas, this.#format.mime, this.#quality);
    }

    /** Frees the backing store immediately; some browsers are slow to reclaim canvas memory. */
    dispose() {
      this.#canvas.width = 0;
      this.#canvas.height = 0;
    }
  }

  /**
   * Resolves in a later task, which gives the browser the chance to handle input and repaint.
   * A message channel is used rather than a timer because timers slow to a crawl while the tab
   * is in the background, and an export should not.
   */
  function nextTask() {
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
      };
      channel.port2.postMessage(null);
    });
  }

  /** Manifest entry for one source image. Rows and columns are 1-based, like the file names. */
  function describeImage(image, exportedTiles) {
    return {
      source: image.sourceName,
      width: image.width,
      height: image.height,
      columns: image.columns,
      rows: image.rows,
      tiles: exportedTiles.map((tile) => ({
        file: tile.path,
        row: tile.row + 1,
        column: tile.col + 1,
        x: tile.x,
        y: tile.y,
        width: tile.width,
        height: tile.height,
      })),
    };
  }

  /**
   * Encodes every planned tile and assembles the archive.
   *
   * @param {ReturnType<typeof planExport>} plan
   * @param {ExportOptions} options
   * @param {Object} [hooks]
   * @param {AbortSignal} [hooks.signal]  Aborting rejects with the signal's AbortError.
   * @param {(fraction: number) => void} [hooks.onProgress]  Called with a value from 0 to 1.
   * @returns {Promise<{ blob: Blob, written: number, skipped: number }>}
   */
  async function runExport(plan, options, { signal, onProgress = () => {} } = {}) {
    if (typeof JSZip === 'undefined') {
      throw new Error('The ZIP library did not load. Reload the page and try again.');
    }

    const zip = new JSZip();
    const encoder = new TileEncoder(plan.format, options);
    const manifestImages = [];
    let processed = 0;
    let written = 0;
    let archiveBytes = 0;
    let pausedAt = performance.now();

    try {
      for (const image of plan.images) {
        const exportedTiles = [];
        for (const tile of image.tiles) {
          signal?.throwIfAborted();

          let blob;
          try {
            blob = await encoder.encode(image.source, tile);
          } catch (cause) {
            throw new Error(`${image.sourceName}: ${cause.message}`, { cause });
          }

          if (blob) {
            archiveBytes += blob.size + ZIP_ENTRY_OVERHEAD + utf8.encode(tile.path).length * 2;
            if (archiveBytes > MAX_ZIP_BYTES) {
              throw new Error(
                'The export is larger than the 4 GB a ZIP archive can hold. ' +
                  'Export fewer images at once.',
              );
            }
            zip.file(tile.path, blob);
            exportedTiles.push(tile);
            written += 1;
          }

          processed += 1;
          onProgress((processed / plan.tileCount) * ENCODING_SHARE);

          // Encoding a tile waits for the browser, but a skipped tile is purely synchronous
          // work, and a long run of them would freeze the page, Cancel button included.
          if (performance.now() - pausedAt > MAX_BLOCKING_TIME) {
            await nextTask();
            pausedAt = performance.now();
          }
        }
        manifestImages.push(describeImage(image, exportedTiles));
      }
    } finally {
      encoder.dispose();
    }

    if (written === 0) throw new Error('Nothing to export: every tile is empty.');

    if (options.manifest) {
      const manifest = {
        generator: 'Slice Studio',
        version: 1,
        format: options.format,
        fixedSize: options.fixedSize,
        images: manifestImages,
      };
      zip.file(MANIFEST_STEM + MANIFEST_EXTENSION, JSON.stringify(manifest, null, 2));
    }

    // Image data is already compressed, so deflating it again would cost time for no gain.
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, ({ percent }) => {
      onProgress(ENCODING_SHARE + (percent / 100) * (1 - ENCODING_SHARE));
    });
    signal?.throwIfAborted();

    return { blob, written, skipped: processed - written };
  }

  /** Formats the current browser can actually encode (WebP is not universal). */
  function supportedFormats() {
    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = 1;
    return Object.keys(FORMATS).filter((key) =>
      probe.toDataURL(FORMATS[key].mime).startsWith(`data:${FORMATS[key].mime}`),
    );
  }

  /** Saves a blob through the browser's download manager. */
  function download(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    // The download reads the blob asynchronously; revoking the URL right away can abort it.
    setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
  }

  app.exporter = { FORMATS, planExport, runExport, supportedFormats, download };
})((globalThis.SliceStudio = globalThis.SliceStudio || {}));
