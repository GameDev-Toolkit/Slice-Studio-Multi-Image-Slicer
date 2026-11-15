'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Project, History } = require('./load.js');

const image = (id, name, width = 100, height = 50) => ({
  id,
  name,
  width,
  height,
  guides: { v: [], h: [] },
});

/** A project holding images a, b and c, with a record of every change notification. */
function setup(options = {}) {
  const changes = [];
  const project = new Project({ onChange: (change) => changes.push(change), ...options });
  const [a, b, c] = [image(1, 'a'), image(2, 'b'), image(3, 'c')];
  project.add([a, b, c]);
  changes.length = 0;
  return { project, changes, a, b, c };
}

const names = (project) => project.images.map((entry) => entry.name);

test('add appends images and activates the first of the batch', () => {
  const { project, changes, a } = setup();
  assert.deepEqual(names(project), ['a', 'b', 'c']);
  assert.equal(project.active, a);

  const d = image(4, 'd');
  project.add([d, image(5, 'e')]);
  assert.deepEqual(names(project), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(project.active, d);
  assert.equal(changes.length, 1);

  project.add([]);
  assert.equal(changes.length, 1);
});

test('find looks images up by id', () => {
  const { project, b } = setup();
  assert.equal(project.find(2), b);
  assert.equal(project.find(99), null);
});

test('activate notifies only when the active image actually changes', () => {
  const { project, changes, a, b } = setup();
  project.activate(a);
  assert.equal(changes.length, 0);
  project.activate(b);
  assert.equal(project.active, b);
  assert.deepEqual(changes, [{ guides: false, selection: null }]);
});

test('activateNeighbor steps through the list and wraps around', () => {
  const { project, a, b, c } = setup();
  project.activateNeighbor(1);
  assert.equal(project.active, b);
  project.activateNeighbor(1);
  project.activateNeighbor(1);
  assert.equal(project.active, a);
  project.activateNeighbor(-1);
  assert.equal(project.active, c);
});

test('commitGuides replaces guides, selects the requested guide and can be undone', () => {
  const { project, changes, a } = setup();
  const select = { axis: 'v', index: 0 };
  const change = { entry: a, guides: { v: [50], h: [] } };
  assert.equal(project.commitGuides([change], 'Add', { select }), true);

  assert.deepEqual(a.guides, { v: [50], h: [] });
  assert.deepEqual(changes, [{ guides: true, selection: select }]);
  assert.equal(project.undoLabel, 'Add');

  assert.equal(project.undo(), true);
  assert.deepEqual(a.guides, { v: [], h: [] });
  // Undo and redo never restore a selection: the guide indices may no longer mean the same.
  assert.deepEqual(changes[1], { guides: true, selection: null });
  assert.equal(project.redoLabel, 'Add');

  assert.equal(project.redo(), true);
  assert.deepEqual(a.guides, { v: [50], h: [] });
  assert.deepEqual(changes[2], { guides: true, selection: null });
});

test('commitGuides records nothing when the guides would not change', () => {
  const { project, changes, a } = setup();
  assert.equal(project.commitGuides([{ entry: a, guides: { v: [], h: [] } }], 'Noop'), false);
  assert.equal(project.canUndo, false);
  assert.equal(changes.length, 0);
});

test('commitGuides copies the guides it is given and the ones it restores', () => {
  const { project, a } = setup();
  const guides = { v: [10], h: [] };
  project.commitGuides([{ entry: a, guides }], 'Add');
  guides.v.push(20);
  assert.deepEqual(a.guides.v, [10]);

  a.guides.v.push(99);
  project.undo();
  project.redo();
  assert.deepEqual(a.guides.v, [10]);
});

test('one commit can change several images and undoes as a single step', () => {
  const { project, a, b, c } = setup();
  project.commitGuides(
    [
      { entry: a, guides: { v: [10], h: [] } },
      { entry: b, guides: { v: [], h: [] } },
      { entry: c, guides: { v: [30], h: [5] } },
    ],
    'Apply to all',
  );
  assert.deepEqual([a.guides.v, b.guides.v, c.guides.v], [[10], [], [30]]);

  project.undo();
  assert.deepEqual([a.guides.v, c.guides.v, c.guides.h], [[], [], []]);
  assert.equal(project.canUndo, false);
});

test('undoing a guide edit brings back the image it was made on', () => {
  const { project, a, b } = setup();
  project.commitGuides([{ entry: a, guides: { v: [50], h: [] } }], 'Add');
  project.activate(b);

  project.undo();
  assert.equal(project.active, a);
  project.activate(b);
  project.redo();
  assert.equal(project.active, a);
});

test('commits sharing a merge key undo together', () => {
  const { project, a } = setup({ history: new History({ now: () => 0 }) });
  for (const px of [11, 12, 13]) {
    project.commitGuides([{ entry: a, guides: { v: [px], h: [] } }], 'Move', { mergeKey: 'nudge' });
  }
  project.undo();
  assert.deepEqual(a.guides.v, []);
  assert.equal(project.canUndo, false);
  project.redo();
  assert.deepEqual(a.guides.v, [13]);
});

test('remove activates the image that takes the place of the removed one', () => {
  const { project, a, b, c } = setup();
  project.activate(b);
  project.remove(b);
  assert.deepEqual(names(project), ['a', 'c']);
  assert.equal(project.active, c);

  project.remove(c);
  assert.equal(project.active, a);
  project.remove(a);
  assert.equal(project.active, null);
  assert.deepEqual(names(project), []);
});

test('removing an image that is not active keeps the active one', () => {
  const { project, a, c } = setup();
  project.remove(c);
  assert.equal(project.active, a);
});

test('undoing a removal puts the image back where it was, with its guides', () => {
  const { project, b } = setup();
  project.commitGuides([{ entry: b, guides: { v: [25], h: [] } }], 'Add');
  const command = project.remove(b);
  assert.equal(command.label, 'Remove b');
  assert.ok(project.isLatest(command));

  project.undo();
  assert.deepEqual(names(project), ['a', 'b', 'c']);
  assert.equal(project.active, b);
  assert.deepEqual(b.guides.v, [25]);
  assert.ok(!project.isLatest(command));

  project.redo();
  assert.deepEqual(names(project), ['a', 'c']);
});

test('remove ignores an image that is not in the project', () => {
  const { project, changes } = setup();
  assert.equal(project.remove(image(9, 'stranger')), null);
  assert.equal(project.canUndo, false);
  assert.equal(changes.length, 0);
});

test('undo and redo report whether there was anything to do', () => {
  const { project } = setup();
  assert.equal(project.undo(), false);
  assert.equal(project.redo(), false);
});

test('change notifications already see the new undo state', () => {
  const seen = [];
  const project = new Project({
    onChange: () => seen.push([project.canUndo, project.canRedo]),
  });
  const a = image(1, 'a');
  project.add([a]);
  project.commitGuides([{ entry: a, guides: { v: [5], h: [] } }], 'Add');
  project.undo();
  project.redo();
  assert.deepEqual(seen, [[false, false], [true, false], [false, true], [true, false]]);
});
