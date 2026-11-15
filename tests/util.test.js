'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { util } = require('./load.js');

test('clamp limits a value to a range', () => {
  assert.equal(util.clamp(5, 0, 10), 5);
  assert.equal(util.clamp(-5, 0, 10), 0);
  assert.equal(util.clamp(50, 0, 10), 10);
});

test('plural adds an "s" for anything but one', () => {
  assert.equal(util.plural(1, 'tile'), '1 tile');
  assert.equal(util.plural(0, 'tile'), '0 tiles');
  assert.equal(util.plural(12, 'other image'), '12 other images');
});

test('setText only writes when the text changes', () => {
  let writes = 0;
  const node = {
    text: 'old',
    get textContent() { return this.text; },
    set textContent(value) { this.text = value; writes += 1; },
  };
  util.setText(node, 'old');
  assert.equal(writes, 0);
  util.setText(node, 'new');
  util.setText(node, 'new');
  assert.equal(writes, 1);
  assert.equal(node.text, 'new');
});
