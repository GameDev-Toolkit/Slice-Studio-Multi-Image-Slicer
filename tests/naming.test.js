'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { naming } = require('./load.js');

const FIRST_TILE = { name: 'sheet', row: 0, col: 0, index: 0, x: 0, y: 0 };
const tile = (overrides = {}) => ({ ...FIRST_TILE, ...overrides });
const render = (template, values) => {
  const compiled = naming.compileTemplate(template);
  assert.ok(compiled.ok, compiled.error);
  return naming.renderPath(compiled, tile(values));
};

test('stripExtension removes only the last extension and leaves dotfiles alone', () => {
  assert.equal(naming.stripExtension('photo.jpg'), 'photo');
  assert.equal(naming.stripExtension('a.b.c.png'), 'a.b.c');
  assert.equal(naming.stripExtension('noext'), 'noext');
  assert.equal(naming.stripExtension('.hidden'), '.hidden');
});

test('sanitizeSegment replaces characters that file systems reject', () => {
  assert.equal(naming.sanitizeSegment('we ird:na*me?<x>|'), 'we ird_na_me_x_');
  assert.equal(naming.sanitizeSegment('a/b\\c'), 'a_b_c');
  assert.equal(naming.sanitizeSegment('  padded  '), 'padded');
});

test('sanitizeSegment keeps non-ASCII names intact', () => {
  assert.equal(naming.sanitizeSegment('спрайт лист'), 'спрайт лист');
  assert.equal(naming.sanitizeSegment('日本語'), '日本語');
});

test('sanitizeSegment strips control characters and bidirectional overrides', () => {
  assert.equal(naming.sanitizeSegment('be\u0007ll\u0000'), 'bell');
  // U+202E would make "gnp.exe" display as "exe.png".
  assert.equal(naming.sanitizeSegment('photo\u202egnp.exe'), 'photognp.exe');
});

test('sanitizeSegment neutralizes names that are special on Windows', () => {
  assert.equal(naming.sanitizeSegment('con'), '_con');
  assert.equal(naming.sanitizeSegment('COM1.txt'), '_COM1.txt');
  assert.equal(naming.sanitizeSegment('console'), 'console');
  assert.equal(naming.sanitizeSegment('trailing. . '), 'trailing');
});

test('sanitizeSegment falls back when nothing usable is left', () => {
  assert.equal(naming.sanitizeSegment('..'), 'image');
  assert.equal(naming.sanitizeSegment('   '), 'image');
  assert.equal(naming.sanitizeSegment('.', ''), '');
});

test('sanitizeSegment caps length in bytes without splitting a character', () => {
  const bytes = (text) => new TextEncoder().encode(text).length;

  const ascii = naming.sanitizeSegment('x'.repeat(500));
  assert.equal(bytes(ascii), 200);

  const cyrillic = naming.sanitizeSegment('я'.repeat(500));
  assert.equal(bytes(cyrillic), 200);
  assert.match(cyrillic, /^я+$/);

  const emoji = naming.sanitizeSegment('😀'.repeat(100));
  assert.equal(bytes(emoji), 200);
  assert.match(emoji, /^(?:😀)+$/u);
});

test('the default template reproduces the classic Row/Col naming', () => {
  assert.equal(render(naming.DEFAULT_TEMPLATE, { row: 1, col: 2 }), 'sheet_Row2_Col3');
});

test('templates support every documented placeholder', () => {
  const values = { name: 'n', row: 1, col: 2, index: 5, x: 64, y: 32 };
  assert.equal(
    render('{name} {row} {col} {index} {row0} {col0} {index0} {x} {y}', values),
    'n 2 3 6 1 2 5 64 32',
  );
});

test('a width after the placeholder zero-pads the value', () => {
  assert.equal(render('{index:3}_{row:2}', { index: 6, row: 11 }), '007_12');
  // Padding never truncates.
  assert.equal(render('{index:2}', { index: 1233 }), '1234');
});

test('a width outside 1 to 9 is reported instead of being left in the file name', () => {
  assert.deepEqual(naming.compileTemplate('{index:0}'), {
    ok: false,
    error: 'The width in {index:0} must be 1 to 9.',
  });
  assert.equal(naming.compileTemplate('{index:10}').ok, false);
  assert.equal(naming.compileTemplate('{index:9}').ok, true);
});

test('placeholders are case-insensitive', () => {
  assert.equal(render('{Name}_{ROW}', { row: 0 }), 'sheet_1');
});

test('compileTemplate reports empty patterns and unknown placeholders', () => {
  assert.deepEqual(naming.compileTemplate('   '), {
    ok: false,
    error: 'Enter a file name pattern.',
  });
  assert.deepEqual(naming.compileTemplate('{nmae}_{row}'), {
    ok: false,
    error: 'Unknown placeholder {nmae}.',
  });
  // Names inherited from Object.prototype must not pass as placeholders.
  assert.equal(naming.compileTemplate('{constructor}').ok, false);
  assert.equal(naming.compileTemplate('{toString}').ok, false);
});

test('text that merely looks like a placeholder is kept literally', () => {
  assert.equal(render('{name}_{ }_{row', {}), 'sheet_{ }_{row');
});

test('substituted values are never interpreted as template syntax', () => {
  assert.equal(render('{name}', { name: '$&{row}$1' }), '$&{row}$1');
});

test('a slash in the template creates folders', () => {
  assert.equal(render('{name}/row{row}/{col}', { row: 2, col: 4 }), 'sheet/row3/5');
});

test('rendered paths cannot escape the archive', () => {
  assert.equal(render('../../{name}/./{row}', {}), 'sheet/1');
  assert.equal(render('/{name}//{row}/', {}), 'sheet/1');
  // A run of reserved characters becomes a single underscore.
  assert.equal(render('C:\\temp\\{name}', {}), 'C_temp_sheet');
  // The same holds when the traversal comes from a substituted value.
  assert.equal(render('{name}/{row}', { name: '..' }), '1');
  assert.equal(render('..', {}), 'tile');
});

test('NameRegistry numbers names that are already taken', () => {
  const names = new naming.NameRegistry();
  assert.equal(names.claim('a', '.png'), 'a');
  assert.equal(names.claim('a', '.png'), 'a-2');
  assert.equal(names.claim('a', '.png'), 'a-3');
  assert.equal(names.claim('b', '.png'), 'b');
});

test('NameRegistry treats names differing only by case or Unicode form as the same', () => {
  const names = new naming.NameRegistry();
  assert.equal(names.claim('Sprite', '.png'), 'Sprite');
  assert.equal(names.claim('sprite', '.png'), 'sprite-2');
  // "é" as one code point, then as "e" plus a combining accent.
  assert.equal(names.claim('caf\u00e9'), 'caf\u00e9');
  assert.equal(names.claim('cafe\u0301'), 'cafe\u0301-2');
});

test('NameRegistry does not hand out a suffixed name that is itself taken', () => {
  const names = new naming.NameRegistry();
  names.claim('a-2', '.png');
  names.claim('a', '.png');
  assert.equal(names.claim('a', '.png'), 'a-3');
});

test('NameRegistry only clashes names with the same extension', () => {
  const names = new naming.NameRegistry();
  assert.equal(names.claim('manifest', '.json'), 'manifest');
  assert.equal(names.claim('manifest', '.png'), 'manifest');
});

test('archiveName depends on how many images are exported', () => {
  assert.equal(naming.archiveName(['hero sheet.png']), 'hero sheet_slices.zip');
  assert.equal(naming.archiveName(['a:b.png']), 'a_b_slices.zip');
  assert.equal(naming.archiveName(['a.png', 'b.png', 'c.png']), 'sliced_images_3.zip');
});
