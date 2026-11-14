'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { exporter, naming } = require('./load.js');

const OPTIONS = {
  format: 'png',
  quality: 0.92,
  template: naming.DEFAULT_TEMPLATE,
  fixedSize: null,
  skipEmpty: false,
  manifest: false,
};

const image = (name, width, height, guides = { v: [], h: [] }) => ({
  name,
  width,
  height,
  guides,
  source: { name },
});

const plan = (images, options = {}) => exporter.planExport(images, { ...OPTIONS, ...options });
const paths = (planned) => planned.images.flatMap((entry) => entry.tiles.map((tile) => tile.path));

test('the default template names tiles <name>_Row<r>_Col<c>.png, row by row', () => {
  const planned = plan([image('sheet.png', 64, 32, { v: [32], h: [16] })]);
  assert.deepEqual(paths(planned), [
    'sheet_Row1_Col1.png',
    'sheet_Row1_Col2.png',
    'sheet_Row2_Col1.png',
    'sheet_Row2_Col2.png',
  ]);
  assert.equal(planned.tileCount, 4);
  assert.equal(planned.deduplicated, false);
  assert.equal(planned.archiveName, 'sheet_slices.zip');
});

test('each planned tile carries its source rectangle', () => {
  const [entry] = plan([image('sheet.png', 64, 32, { v: [48], h: [] })]).images;
  assert.deepEqual(
    entry.tiles.map(({ x, y, width, height }) => [x, y, width, height]),
    [[0, 0, 48, 32], [48, 0, 16, 32]],
  );
  assert.deepEqual([entry.columns, entry.rows, entry.sourceName], [2, 1, 'sheet.png']);
  assert.deepEqual(entry.source, { name: 'sheet.png' });
});

test('the file extension follows the export format', () => {
  const images = [image('photo.jpg', 10, 10)];
  assert.deepEqual(paths(plan(images, { format: 'jpeg' })), ['photo_Row1_Col1.jpg']);
  assert.deepEqual(paths(plan(images, { format: 'webp' })), ['photo_Row1_Col1.webp']);
  assert.equal(plan(images, { format: 'jpeg' }).format.mime, 'image/jpeg');
});

test('several images share one archive named after their count', () => {
  const planned = plan([image('a.png', 8, 8), image('b.png', 8, 8), image('c.png', 8, 8)]);
  assert.equal(planned.archiveName, 'sliced_images_3.zip');
  assert.equal(planned.tileCount, 3);
});

test('images with the same base name do not overwrite each other', () => {
  const planned = plan([image('dup.png', 8, 8), image('dup.jpg', 8, 8), image('DUP.webp', 8, 8)]);
  assert.deepEqual(paths(planned), [
    'dup_Row1_Col1.png',
    'dup-2_Row1_Col1.png',
    'DUP-3_Row1_Col1.png',
  ]);
  assert.equal(planned.deduplicated, true);
});

test('tiles that render to the same path are numbered', () => {
  const sheet = image('sheet.png', 30, 10, { v: [10, 20], h: [] });
  const planned = plan([sheet], { template: '{name}' });
  assert.deepEqual(paths(planned), ['sheet.png', 'sheet-2.png', 'sheet-3.png']);
  assert.equal(planned.deduplicated, true);
});

test('no two planned paths are the same file on a case-insensitive file system', () => {
  const images = [
    image('Hero.png', 40, 40, { v: [20], h: [20] }),
    image('hero.png', 40, 40, { v: [20], h: [20] }),
    image('HERO-2.png', 40, 40, { v: [20], h: [20] }),
  ];
  for (const template of [naming.DEFAULT_TEMPLATE, '{name}', '{row}', 'tiles/{name}/{col}']) {
    const all = paths(plan(images, { template }));
    const keys = new Set(all.map((path) => path.normalize('NFC').toLowerCase()));
    assert.equal(keys.size, all.length, template);
  }
});

test('source names are sanitized before they become paths', () => {
  const planned = plan([
    image('we ird:na*me?<x>|.png', 8, 8),
    image('спрайт лист.png', 8, 8),
    image('..png', 8, 8),
    image('CON.png', 8, 8),
  ]);
  assert.deepEqual(paths(planned), [
    'we ird_na_me_x__Row1_Col1.png',
    'спрайт лист_Row1_Col1.png',
    'image_Row1_Col1.png',
    '_CON_Row1_Col1.png',
  ]);
});

test('neither a source name nor the template can place a file outside the archive', () => {
  const hostile = [
    image('../../etc/passwd', 8, 8),
    image('..\\..\\evil.png', 8, 8),
    image('/absolute.png', 8, 8),
    image('..', 8, 8),
    image('C:\\Windows\\system.png', 8, 8),
  ];
  for (const template of [naming.DEFAULT_TEMPLATE, '{name}', '../{name}/../{row}', '/{name}']) {
    for (const path of paths(plan(hostile, { template }))) {
      const segments = path.split('/');
      assert.ok(!segments.some((segment) => ['', '.', '..'].includes(segment)), path);
      assert.ok(!/[\\:]/.test(path), path);
    }
  }
});

test('a template with folders plans nested paths', () => {
  const planned = plan([image('sheet.png', 20, 10, { v: [10], h: [] })], {
    template: '{name}/tiles/{index:2}',
  });
  assert.deepEqual(paths(planned), ['sheet/tiles/01.png', 'sheet/tiles/02.png']);
});

test('the manifest name is reserved so a tile cannot take it', () => {
  const images = [image('sheet.png', 10, 10)];
  const options = { template: 'manifest', format: 'png' };
  assert.deepEqual(paths(plan(images, { ...options, manifest: false })), ['manifest.png']);
  // A PNG never clashes with manifest.json, so the name stays as it is.
  assert.deepEqual(paths(plan(images, { ...options, manifest: true })), ['manifest.png']);
});

test('an invalid template or format is rejected with a readable message', () => {
  const images = [image('sheet.png', 10, 10)];
  assert.throws(() => plan(images, { template: '{nope}' }), /Unknown placeholder \{nope\}/);
  assert.throws(() => plan(images, { template: '' }), /Enter a file name pattern/);
  assert.throws(() => plan(images, { format: 'gif' }), /Unsupported export format "gif"/);
});

test('an export beyond the ZIP entry limit is refused up front', () => {
  const guides = (count) => Array.from({ length: count }, (_, index) => index + 1);
  // 255 x 256 tiles plus a strip of 254 is 65,534 files: exactly what a ZIP can hold.
  const atLimit = [
    image('big.png', 255, 256, { v: guides(254), h: guides(255) }),
    image('strip.png', 254, 1, { v: guides(253), h: [] }),
  ];
  assert.equal(plan(atLimit).tileCount, 65534);

  // The manifest and every folder are entries too.
  assert.throws(() => plan(atLimit, { manifest: true }), /65,535 files.*at most 65,534/);
  assert.throws(() => plan(atLimit, { template: '{name}/{index}' }), /65,536 files/);
  assert.throws(
    () => plan([...atLimit, image('one.png', 4, 4)]),
    /Export fewer images at once or use fewer slices/,
  );
});
