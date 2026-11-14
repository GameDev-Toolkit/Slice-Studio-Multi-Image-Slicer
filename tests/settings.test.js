'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { settings } = require('./load.js');

const STORAGE_KEY = 'slice-studio:settings:v1';

/** Minimal stand-in for window.localStorage. */
function fakeStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    store,
  };
}

afterEach(() => {
  delete globalThis.localStorage;
});

test('sanitize returns the defaults for anything that is not an object', () => {
  for (const junk of [null, undefined, 42, 'text', true]) {
    assert.deepEqual(settings.sanitize(junk), settings.DEFAULTS);
  }
  assert.deepEqual(settings.sanitize({}), settings.DEFAULTS);
  assert.deepEqual(settings.sanitize([]), settings.DEFAULTS);
});

test('sanitize returns a fresh object every time', () => {
  const first = settings.sanitize(null);
  first.fixedSize.width = 7;
  first.split.count = 9;
  assert.equal(settings.sanitize(null).fixedSize.width, 100);
  assert.equal(settings.DEFAULTS.split.count, 2);
});

test('sanitize keeps valid values', () => {
  const valid = {
    format: 'webp',
    quality: 0.8,
    template: '{name}/{index:3}',
    fixedSize: { enabled: true, width: 64, height: 48 },
    skipEmpty: true,
    manifest: true,
    scope: 'active',
    showPreview: true,
    split: { unit: 'px', count: 8, px: 16 },
  };
  assert.deepEqual(settings.sanitize(valid), valid);
});

test('sanitize replaces each invalid field with its default, independently', () => {
  const result = settings.sanitize({
    format: 'bmp',
    quality: 'high',
    template: '   ',
    fixedSize: { enabled: 'yes', width: 'wide', height: 32 },
    skipEmpty: 1,
    manifest: true,
    scope: 'everything',
    showPreview: null,
    split: { unit: 'em', count: null, px: 24 },
  });
  assert.deepEqual(result, {
    ...settings.DEFAULTS,
    fixedSize: { enabled: false, width: 100, height: 32 },
    manifest: true,
    split: { unit: 'count', count: 2, px: 24 },
  });
});

test('sanitize clamps numbers to their ranges and rounds sizes', () => {
  const result = settings.sanitize({
    quality: 7,
    fixedSize: { enabled: true, width: 0, height: 123456 },
    split: { unit: 'count', count: 1000, px: 0.2 },
  });
  assert.equal(result.quality, 1);
  assert.deepEqual(result.fixedSize, { enabled: true, width: 1, height: 10000 });
  assert.deepEqual(result.split, { unit: 'count', count: 256, px: 1 });

  assert.equal(settings.sanitize({ quality: 0 }).quality, 0.1);
  assert.equal(settings.sanitize({ fixedSize: { width: 40.6 } }).fixedSize.width, 41);
  assert.equal(settings.sanitize({ split: { count: 1 } }).split.count, 2);
});

test('sanitize limits the length of the naming template', () => {
  const result = settings.sanitize({ template: 'x'.repeat(500) });
  assert.equal(result.template.length, settings.MAX_TEMPLATE_LENGTH);
});

test('sanitize tolerates nested values of the wrong type', () => {
  const result = settings.sanitize({ fixedSize: 'big', split: 3 });
  assert.deepEqual(result.fixedSize, settings.DEFAULTS.fixedSize);
  assert.deepEqual(result.split, settings.DEFAULTS.split);
});

test('load falls back to the defaults when storage is missing, empty or corrupt', () => {
  assert.deepEqual(settings.load(), settings.DEFAULTS);

  globalThis.localStorage = fakeStorage();
  assert.deepEqual(settings.load(), settings.DEFAULTS);

  globalThis.localStorage = fakeStorage({ [STORAGE_KEY]: '{not json' });
  assert.deepEqual(settings.load(), settings.DEFAULTS);

  globalThis.localStorage = {
    getItem: () => { throw new Error('storage is disabled'); },
  };
  assert.deepEqual(settings.load(), settings.DEFAULTS);
});

test('save and load round-trip through storage', () => {
  const storage = fakeStorage();
  globalThis.localStorage = storage;

  const changed = { ...settings.sanitize(null), format: 'jpeg', scope: 'active' };
  settings.save(changed);
  assert.deepEqual([...storage.store.keys()], [STORAGE_KEY]);
  assert.deepEqual(settings.load(), changed);
});

test('load validates what it reads back', () => {
  globalThis.localStorage = fakeStorage({
    [STORAGE_KEY]: JSON.stringify({ format: 'exe', quality: 0.5, extra: 'ignored' }),
  });
  assert.deepEqual(settings.load(), { ...settings.DEFAULTS, quality: 0.5 });
});

test('save does not throw when storage refuses the write', () => {
  globalThis.localStorage = {
    setItem: () => { throw new Error('quota exceeded'); },
  };
  assert.doesNotThrow(() => settings.save(settings.sanitize(null)));
});
