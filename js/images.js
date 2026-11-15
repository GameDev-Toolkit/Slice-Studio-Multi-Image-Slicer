/**
 * Image intake: turns user-supplied files into decoded images that are ready to slice.
 *
 * Files are decoded straight from object URLs. Nothing is copied into data URLs and nothing
 * ever leaves the page.
 */
(function (app) {
  'use strict';

  /**
   * @typedef {Object} ImageEntry
   * @property {number} id  Unique within the session; stable for the lifetime of the entry.
   * @property {string} name  Original file name.
   * @property {number} width  Intrinsic width in pixels.
   * @property {number} height  Intrinsic height in pixels.
   * @property {HTMLImageElement} source  The decoded image, at full resolution.
   * @property {{ v: number[], h: number[] }} guides  See slicing.js.
   * @property {{ zoom: number, panX: number, panY: number } | null} viewport
   *   Null until the image has been shown for the first time.
   * @property {boolean} fitted  The viewport is the automatic fit, so it should follow resizes.
   * @property {{ width: number, height: number } | null} viewSize
   *   Size of the canvas, in CSS pixels, that the viewport was last laid out for.
   */

  /** Decoded bitmaps are large; a few at a time keeps a big batch from exhausting the tab. */
  const MAX_CONCURRENT_DECODES = 4;

  const FALLBACK_NAME = 'image.png';

  let nextId = 1;

  /**
   * Cheap pre-filter so that an obviously unrelated file is never handed to the decoder.
   * Some platforms report no type at all for less common formats; those get the benefit of
   * the doubt and are left for the decoder to judge.
   */
  function looksLikeImage(file) {
    return file.type === '' || file.type.startsWith('image/');
  }

  /** @returns {Promise<HTMLImageElement>} */
  function decode(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      // Once loading has settled the element holds the data itself and the URL is dead weight.
      const release = () => URL.revokeObjectURL(url);

      image.onload = () => {
        release();
        if (image.naturalWidth > 0 && image.naturalHeight > 0) resolve(image);
        else reject(new Error('has no pixel dimensions'));
      };
      image.onerror = () => {
        release();
        reject(new Error('is not an image this browser can read'));
      };
      image.src = url;
    });
  }

  /** @returns {ImageEntry} */
  function createEntry(file, image) {
    return {
      id: nextId++,
      name: file.name || FALLBACK_NAME,
      width: image.naturalWidth,
      height: image.naturalHeight,
      source: image,
      guides: { v: [], h: [] },
      viewport: null,
      fitted: true,
      viewSize: null,
    };
  }

  /** Runs `task` over `items` with at most `limit` in flight; results keep the input order. */
  async function mapWithLimit(items, limit, task) {
    const results = new Array(items.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await task(items[index]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
  }

  /**
   * Decodes a batch of files. A file that cannot be read never fails the batch; it is reported
   * alongside the images that did load.
   *
   * @param {Iterable<File>} files
   * @returns {Promise<{ images: ImageEntry[], failures: { name: string, reason: string }[] }>}
   *   Both lists follow the order of `files`.
   */
  async function loadImages(files) {
    const outcomes = await mapWithLimit([...files], MAX_CONCURRENT_DECODES, async (file) => {
      const name = file.name || FALLBACK_NAME;
      if (!looksLikeImage(file)) return { failure: { name, reason: 'is not an image' } };
      try {
        return { image: createEntry(file, await decode(file)) };
      } catch (error) {
        return { failure: { name, reason: error.message } };
      }
    });

    return {
      images: outcomes.flatMap((outcome) => outcome.image ?? []),
      failures: outcomes.flatMap((outcome) => outcome.failure ?? []),
    };
  }

  app.images = { loadImages };
})((globalThis.SliceStudio = globalThis.SliceStudio || {}));
