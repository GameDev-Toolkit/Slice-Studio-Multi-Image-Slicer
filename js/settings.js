/**
 * User preferences: defaults, validation and persistence.
 *
 * Preferences are kept in localStorage. Whatever is read back is treated as untrusted - it may
 * come from an older version, another tab or a hand-edited store - so every field is validated
 * on its own and falls back to its default when invalid.
 */
(function (app) {
  'use strict';

  const { clamp } = app.util;
  const { DEFAULT_TEMPLATE } = app.naming;
  const { MAX_SLICES_PER_AXIS } = app.slicing;

  const STORAGE_KEY = 'slice-studio:settings:v1';

  const FORMATS = ['png', 'jpeg', 'webp'];
  const SCOPES = ['all', 'active'];
  const SPLIT_UNITS = ['count', 'px'];

  const MAX_TEMPLATE_LENGTH = 120;
  const MAX_FIXED_SIZE = 10000;
  const MAX_CELL_SIZE = 100000;

  /**
   * @typedef {Object} Settings
   * @property {'png'|'jpeg'|'webp'} format
   * @property {number} quality  Encoder quality for lossy formats, 0.1 to 1.
   * @property {string} template  Naming template, see naming.js.
   * @property {{ enabled: boolean, width: number, height: number }} fixedSize
   * @property {boolean} skipEmpty  Leave fully transparent tiles out of the export.
   * @property {boolean} manifest  Add a manifest.json describing every tile.
   * @property {'all'|'active'} scope  Which images an export covers.
   * @property {boolean} showPreview  Tile label overlay on the canvas.
   * @property {{ unit: 'count'|'px', count: number, px: number }} split
   */

  /** @type {Readonly<Settings>} */
  const DEFAULTS = Object.freeze({
    format: 'png',
    quality: 0.92,
    template: DEFAULT_TEMPLATE,
    fixedSize: Object.freeze({ enabled: false, width: 100, height: 100 }),
    skipEmpty: false,
    manifest: false,
    scope: 'all',
    showPreview: false,
    split: Object.freeze({ unit: 'count', count: 2, px: 32 }),
  });

  const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
  const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

  /** Integer in [min, max]; anything that is not a finite number becomes `fallback`. */
  function int(value, min, max, fallback) {
    return Number.isFinite(value) ? clamp(Math.round(value), min, max) : fallback;
  }

  /**
   * Coerces arbitrary data into a complete, valid Settings object.
   * @returns {Settings}
   */
  function sanitize(raw) {
    const source = raw !== null && typeof raw === 'object' ? raw : {};
    const fixedSize = source.fixedSize ?? {};
    const split = source.split ?? {};

    return {
      format: oneOf(source.format, FORMATS, DEFAULTS.format),
      quality: Number.isFinite(source.quality) ? clamp(source.quality, 0.1, 1) : DEFAULTS.quality,
      template:
        typeof source.template === 'string' && source.template.trim()
          ? source.template.slice(0, MAX_TEMPLATE_LENGTH)
          : DEFAULTS.template,
      fixedSize: {
        enabled: bool(fixedSize.enabled, DEFAULTS.fixedSize.enabled),
        width: int(fixedSize.width, 1, MAX_FIXED_SIZE, DEFAULTS.fixedSize.width),
        height: int(fixedSize.height, 1, MAX_FIXED_SIZE, DEFAULTS.fixedSize.height),
      },
      skipEmpty: bool(source.skipEmpty, DEFAULTS.skipEmpty),
      manifest: bool(source.manifest, DEFAULTS.manifest),
      scope: oneOf(source.scope, SCOPES, DEFAULTS.scope),
      showPreview: bool(source.showPreview, DEFAULTS.showPreview),
      split: {
        unit: oneOf(split.unit, SPLIT_UNITS, DEFAULTS.split.unit),
        count: int(split.count, 2, MAX_SLICES_PER_AXIS, DEFAULTS.split.count),
        px: int(split.px, 1, MAX_CELL_SIZE, DEFAULTS.split.px),
      },
    };
  }

  /** @returns {Settings} Stored preferences, or the defaults when none can be read. */
  function load() {
    try {
      return sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY)));
    } catch {
      // Storage can be unavailable (privacy modes, some file:// contexts) or hold stale junk.
      return sanitize(null);
    }
  }

  /** Persists preferences. Failing to do so is not worth interrupting the user for. */
  function save(settings) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Quota exceeded or storage disabled: the preferences simply last for this session only.
    }
  }

  app.settings = { DEFAULTS, MAX_TEMPLATE_LENGTH, sanitize, load, save };
})((globalThis.SliceStudio = globalThis.SliceStudio || {}));
