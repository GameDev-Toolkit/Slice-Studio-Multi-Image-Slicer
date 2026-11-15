/**
 * Output naming: file-name sanitization, naming templates and collision-free name allocation.
 *
 * Names originate from user files and a user-editable template, and they end up as paths inside
 * a ZIP that is unpacked on someone's disk, so everything here is defensive: no path traversal,
 * no characters a common file system rejects, and no two entries that would overwrite each other.
 *
 * Pure and DOM-free; unit-tested under Node.
 */
(function (app) {
  'use strict';

  const DEFAULT_TEMPLATE = '{name}_Row{row}_Col{col}';
  const FALLBACK_IMAGE_NAME = 'image';
  const FALLBACK_TILE_NAME = 'tile';

  /**
   * Byte budget for one path segment. Most file systems allow 255 bytes per name; the margin
   * leaves room for a de-duplication suffix and the file extension.
   */
  const MAX_SEGMENT_BYTES = 200;

  /** Rejected by Windows, the strictest of the mainstream file systems. */
  const RESERVED_CHARS = /[\\/:*?"<>|]+/g;
  /** Control characters, plus the bidi overrides that can make a name display as another. */
  const INVISIBLE_CHARS = /[\p{Cc}\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
  /** Windows refuses these as a file name regardless of extension. */
  const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
  /** Windows silently drops trailing dots and spaces, which would make distinct names clash. */
  const TRAILING_DOTS_AND_SPACES = /[. ]+$/;

  /** {token} or {token:width}; the width zero-pads the value to that many characters. */
  const PLACEHOLDER = /\{([a-z0-9]+)(?::(\d+))?\}/gi;
  const MAX_PAD_WIDTH = 9;

  /** Values a template may reference. Tile positions are zero-based in the model. */
  const TOKENS = {
    name: (tile) => tile.name,
    row: (tile) => tile.row + 1,
    col: (tile) => tile.col + 1,
    index: (tile) => tile.index + 1,
    row0: (tile) => tile.row,
    col0: (tile) => tile.col,
    index0: (tile) => tile.index,
    x: (tile) => tile.x,
    y: (tile) => tile.y,
  };

  const utf8 = new TextEncoder();

  function stripExtension(fileName) {
    const dot = fileName.lastIndexOf('.');
    return dot > 0 ? fileName.slice(0, dot) : fileName;
  }

  /** Shortens text to at most `maxBytes` of UTF-8 without splitting a code point. */
  function truncateUtf8(text, maxBytes) {
    if (utf8.encode(text).length <= maxBytes) return text;
    const codePoints = Array.from(text);
    let bytes = 0;
    let end = 0;
    while (end < codePoints.length) {
      const size = utf8.encode(codePoints[end]).length;
      if (bytes + size > maxBytes) break;
      bytes += size;
      end += 1;
    }
    return codePoints.slice(0, end).join('');
  }

  /**
   * Turns arbitrary text into a single file or folder name that is valid on Windows, macOS and
   * Linux. Returns `fallback` when nothing usable is left (for example "..").
   */
  function sanitizeSegment(text, fallback = FALLBACK_IMAGE_NAME) {
    let name = String(text)
      .normalize('NFC')
      .replace(INVISIBLE_CHARS, '')
      .replace(RESERVED_CHARS, '_')
      .trim();
    name = truncateUtf8(name, MAX_SEGMENT_BYTES).replace(TRAILING_DOTS_AND_SPACES, '');
    if (WINDOWS_DEVICE_NAME.test(name)) name = `_${name}`;
    return name || fallback;
  }

  /**
   * Compiles a naming template such as "{name}/{row:2}-{col:2}".
   * @returns {{ ok: true, render: (tile: object) => string } | { ok: false, error: string }}
   */
  function compileTemplate(template) {
    const source = String(template).trim();
    if (!source) return { ok: false, error: 'Enter a file name pattern.' };

    for (const [placeholder, token, width] of source.matchAll(PLACEHOLDER)) {
      if (!Object.hasOwn(TOKENS, token.toLowerCase())) {
        return { ok: false, error: `Unknown placeholder ${placeholder}.` };
      }
      if (width !== undefined && (Number(width) < 1 || Number(width) > MAX_PAD_WIDTH)) {
        return { ok: false, error: `The width in ${placeholder} must be 1 to ${MAX_PAD_WIDTH}.` };
      }
    }

    // A replacer function is used on purpose: substituted values are inserted verbatim, so a
    // source file name containing "$&" or "{row}" cannot inject anything into the result.
    const render = (tile) =>
      source.replace(PLACEHOLDER, (placeholder, token, width) => {
        const value = String(TOKENS[token.toLowerCase()](tile));
        return width ? value.padStart(Number(width), '0') : value;
      });

    return { ok: true, render };
  }

  /**
   * Renders a compiled template into a safe relative path without extension. "/" separates
   * folders; empty, "." and ".." segments are discarded, so the path cannot escape the archive.
   */
  function renderPath(compiled, tile) {
    const segments = compiled
      .render(tile)
      .split('/')
      .map((segment) => sanitizeSegment(segment, ''))
      .filter(Boolean);
    return segments.length > 0 ? segments.join('/') : FALLBACK_TILE_NAME;
  }

  /** Two names with the same key would be the same file on a case-insensitive file system. */
  const collisionKey = (name) => name.normalize('NFC').toLowerCase();

  /**
   * Hands out names that are unique within one export. Comparison ignores letter case and
   * Unicode normalization form, because archives are usually unpacked on file systems that
   * treat such names as the same file.
   */
  class NameRegistry {
    #taken = new Set();
    /** Last numeric suffix issued per name, so repeated clashes do not rescan from 2. */
    #lastSuffix = new Map();

    /**
     * Reserves `stem + extension`, appending "-2", "-3", ... to the stem if it is taken.
     * @returns {string} The stem that was actually reserved.
     */
    claim(stem, extension = '') {
      const key = collisionKey(stem + extension);
      if (!this.#taken.has(key)) {
        this.#taken.add(key);
        return stem;
      }

      let suffix = this.#lastSuffix.get(key) ?? 1;
      let candidate;
      let candidateKey;
      do {
        suffix += 1;
        candidate = `${stem}-${suffix}`;
        candidateKey = collisionKey(candidate + extension);
      } while (this.#taken.has(candidateKey));

      this.#lastSuffix.set(key, suffix);
      this.#taken.add(candidateKey);
      return candidate;
    }
  }

  /** Download name for an archive holding the slices of the given source files. */
  function archiveName(sourceFileNames) {
    if (sourceFileNames.length === 1) {
      return `${sanitizeSegment(stripExtension(sourceFileNames[0]))}_slices.zip`;
    }
    return `sliced_images_${sourceFileNames.length}.zip`;
  }

  app.naming = {
    DEFAULT_TEMPLATE,
    stripExtension,
    sanitizeSegment,
    compileTemplate,
    renderPath,
    NameRegistry,
    archiveName,
  };
})((globalThis.SliceStudio = globalThis.SliceStudio || {}));
