'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { keys } = require('./load.js');

const event = (key, code, modifiers = {}) => ({
  key,
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  getModifierState: (name) => name === 'AltGraph' && Boolean(modifiers.altGraph),
  ...modifiers,
});

test('shortcutKey uses the typed character on Latin layouts', () => {
  assert.equal(keys.shortcutKey({ key: 'z', code: 'KeyZ' }), 'z');
  assert.equal(keys.shortcutKey({ key: 'Z', code: 'KeyZ' }), 'z');
  // AZERTY: the key in the US "Q" position types "a".
  assert.equal(keys.shortcutKey({ key: 'a', code: 'KeyQ' }), 'a');
  assert.equal(keys.shortcutKey({ key: '?', code: 'Slash' }), '?');
});

test('shortcutKey falls back to the key position on non-Latin layouts', () => {
  assert.equal(keys.shortcutKey({ key: 'я', code: 'KeyZ' }), 'z');
  assert.equal(keys.shortcutKey({ key: 'М', code: 'KeyV' }), 'v');
  assert.equal(keys.shortcutKey({ key: 'х', code: 'BracketLeft' }), '[');
  assert.equal(keys.shortcutKey({ key: 'б', code: 'Comma' }), ',');
  assert.equal(keys.shortcutKey({ key: 'ю', code: 'Period' }), '.');
  assert.equal(keys.shortcutKey({ key: '٣', code: 'Digit3' }), '3');
  assert.equal(keys.shortcutKey({ key: 'ё', code: 'Backquote' }), 'ё');
});

test('shortcutKey passes named keys through unchanged', () => {
  assert.equal(keys.shortcutKey({ key: 'Escape', code: 'Escape' }), 'Escape');
  assert.equal(keys.shortcutKey({ key: 'ArrowLeft', code: 'ArrowLeft' }), 'ArrowLeft');
});

test('combo lists modifiers in a fixed order', () => {
  assert.equal(keys.combo(event('z', 'KeyZ', { ctrlKey: true })), 'mod+z');
  assert.equal(keys.combo(event('z', 'KeyZ', { metaKey: true })), 'mod+z');
  assert.equal(keys.combo(event('Z', 'KeyZ', { ctrlKey: true, shiftKey: true })), 'mod+shift+z');
  assert.equal(keys.combo(event('я', 'KeyZ', { ctrlKey: true })), 'mod+z');
  assert.equal(keys.combo(event('v', 'KeyV', { altKey: true })), 'alt+v');
  assert.equal(keys.combo(event('ArrowLeft', 'ArrowLeft', { shiftKey: true })), 'shift+ArrowLeft');
});

test('combo ignores Shift for punctuation, where it is part of typing the character', () => {
  assert.equal(keys.combo(event('?', 'Slash', { shiftKey: true })), '?');
  assert.equal(keys.combo(event('+', 'Equal', { shiftKey: true })), '+');
});

test('combo does not mistake AltGr for Ctrl+Alt', () => {
  const altGr = { ctrlKey: true, altKey: true, altGraph: true };
  assert.equal(keys.combo(event('[', 'Digit8', altGr)), '[');
});

test('combo works for events without getModifierState', () => {
  assert.equal(keys.combo({ key: 'h', code: 'KeyH' }), 'h');
});
