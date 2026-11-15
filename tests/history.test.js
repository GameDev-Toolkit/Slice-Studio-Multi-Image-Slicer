'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { History } = require('./load.js');

/** A command that sets `state.value`, recorded the way the app does it: after applying. */
function setValue(state, value, label = `set ${value}`) {
  const before = state.value;
  state.value = value;
  return {
    label,
    undo: () => { state.value = before; },
    redo: () => { state.value = value; },
  };
}

test('undo and redo walk back and forth through recorded commands', () => {
  const history = new History();
  const state = { value: 0 };
  history.push(setValue(state, 1));
  history.push(setValue(state, 2));

  assert.equal(history.undo().label, 'set 2');
  assert.equal(state.value, 1);
  history.undo();
  assert.equal(state.value, 0);
  assert.equal(history.undo(), null);

  assert.equal(history.redo().label, 'set 1');
  history.redo();
  assert.equal(state.value, 2);
  assert.equal(history.redo(), null);
});

test('canUndo, canRedo and the labels follow the stacks', () => {
  const history = new History();
  const state = { value: 0 };
  assert.deepEqual(
    [history.canUndo, history.canRedo, history.undoLabel, history.redoLabel],
    [false, false, null, null],
  );

  history.push(setValue(state, 1, 'first'));
  history.push(setValue(state, 2, 'second'));
  assert.deepEqual([history.canUndo, history.canRedo, history.undoLabel], [true, false, 'second']);

  history.undo();
  assert.deepEqual([history.undoLabel, history.redoLabel], ['first', 'second']);
});

test('a new command discards everything that could have been redone', () => {
  const history = new History();
  const state = { value: 0 };
  history.push(setValue(state, 1));
  history.undo();
  history.push(setValue(state, 5));

  assert.equal(history.canRedo, false);
  history.undo();
  assert.equal(state.value, 0);
});

test('the oldest steps are dropped once the limit is reached', () => {
  const history = new History({ limit: 3 });
  const state = { value: 0 };
  for (let value = 1; value <= 5; value++) history.push(setValue(state, value));

  let undone = 0;
  while (history.undo()) undone += 1;
  assert.equal(undone, 3);
  assert.equal(state.value, 2);
});

test('commands sharing a merge key within the window become one step', () => {
  let clock = 0;
  const history = new History({ now: () => clock });
  const state = { value: 0 };

  history.push(setValue(state, 1), { mergeKey: 'nudge' });
  clock += 400;
  history.push(setValue(state, 2), { mergeKey: 'nudge' });
  clock += 400;
  history.push(setValue(state, 3), { mergeKey: 'nudge' });

  history.undo();
  assert.equal(state.value, 0);
  assert.equal(history.canUndo, false);
  history.redo();
  assert.equal(state.value, 3);
});

test('merging stops after a pause, for another key, and for commands without a key', () => {
  let clock = 0;
  const history = new History({ now: () => clock });
  const state = { value: 0 };
  const steps = () => {
    let count = 0;
    while (history.undo()) count += 1;
    while (history.redo());
    return count;
  };

  history.push(setValue(state, 1), { mergeKey: 'a' });
  clock += 1001;
  history.push(setValue(state, 2), { mergeKey: 'a' });
  assert.equal(steps(), 2);

  history.push(setValue(state, 3), { mergeKey: 'b' });
  assert.equal(steps(), 3);

  history.push(setValue(state, 4));
  history.push(setValue(state, 5));
  assert.equal(steps(), 5);
});

test('a step that was undone and redone no longer absorbs later edits', () => {
  const history = new History({ now: () => 0 });
  const state = { value: 0 };
  history.push(setValue(state, 1), { mergeKey: 'nudge' });
  history.undo();
  history.redo();
  history.push(setValue(state, 2), { mergeKey: 'nudge' });

  history.undo();
  assert.equal(state.value, 1);
});

test('the stacks are already updated when a command runs', () => {
  const history = new History();
  const seen = [];
  const record = () => seen.push([history.canUndo, history.canRedo]);
  history.push({ label: 'observe', undo: record, redo: record });

  history.undo();
  history.redo();
  assert.deepEqual(seen, [[false, true], [true, false]]);
});

test('isLatest tells whether a command is the next one to undo', () => {
  const history = new History();
  const state = { value: 0 };
  const first = setValue(state, 1);
  const second = setValue(state, 2);
  history.push(first);
  assert.ok(history.isLatest(first));

  history.push(second);
  assert.ok(!history.isLatest(first));
  history.undo();
  assert.ok(history.isLatest(first));
  history.undo();
  assert.ok(!history.isLatest(first));
});
