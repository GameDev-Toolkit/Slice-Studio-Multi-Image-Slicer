/**
 * Project: the images being worked on, which of them is active, and the undo history.
 *
 * Every change to guides or to the image list goes through a method here and is recorded as a
 * command, which is what makes it undoable. The project knows nothing about the DOM: views are
 * told about changes through `onChange` and redraw themselves.
 *
 * DOM-free; unit-tested under Node.
 */
(function (app) {
  'use strict';

  const { History } = app;
  const { cloneGuides, guidesEqual } = app.slicing;

  const HISTORY_LIMIT = 100;

  /**
   * @typedef {{ axis: 'v' | 'h', index: number }} GuideRef
   *
   * @typedef {Object} ProjectChange
   * @property {boolean} guides  Guides were replaced: any guide index a view holds is stale.
   * @property {GuideRef | null} selection  Guide to select afterward, when `guides` is set.
   */

  class Project {
    /** @type {ImageEntry[]} See images.js. */
    #images = [];
    /** @type {ImageEntry | null} */
    #active = null;
    #history;
    #onChange;

    /**
     * @param {Object} options
     * @param {(change: ProjectChange) => void} options.onChange
     * @param {History} [options.history]
     */
    constructor({ onChange, history = new History({ limit: HISTORY_LIMIT }) }) {
      this.#onChange = onChange;
      this.#history = history;
    }

    /** Loaded images in list order. Read-only for callers. */
    get images() {
      return this.#images;
    }

    get active() {
      return this.#active;
    }

    get canUndo() {
      return this.#history.canUndo;
    }

    get canRedo() {
      return this.#history.canRedo;
    }

    get undoLabel() {
      return this.#history.undoLabel;
    }

    get redoLabel() {
      return this.#history.redoLabel;
    }

    find(id) {
      return this.#images.find((image) => image.id === id) ?? null;
    }

    /** Appends images and makes the first of them the active one. */
    add(entries) {
      if (entries.length === 0) return;
      this.#images.push(...entries);
      this.#active = entries[0];
      this.#notify();
    }

    activate(entry) {
      if (entry === this.#active) return;
      this.#active = entry;
      this.#notify();
    }

    /** Activates the image `offset` places further along the list, wrapping around. */
    activateNeighbor(offset) {
      const count = this.#images.length;
      if (count < 2) return;
      const index = this.#images.indexOf(this.#active);
      this.activate(this.#images[(index + offset + count) % count]);
    }

    /**
     * Removes an image. The step is undoable, so the image stays referenced by the history
     * instead of being released straight away.
     * @returns {object | null} The recorded command, or null if the image is not in the project.
     */
    remove(entry) {
      const index = this.#images.indexOf(entry);
      if (index === -1) return null;

      const command = {
        label: `Remove ${entry.name}`,
        redo: () => {
          this.#images.splice(this.#images.indexOf(entry), 1);
          // Move on to the image that took its place in the list, or to the one before it.
          if (this.#active === entry) {
            this.#active = this.#images[index] ?? this.#images[index - 1] ?? null;
          }
          this.#notify();
        },
        undo: () => {
          this.#images.splice(index, 0, entry);
          this.#active = entry;
          this.#notify();
        },
      };
      this.#history.push(command);
      command.redo();
      return command;
    }

    /**
     * Replaces the guides of one or more images as a single undoable step.
     *
     * @param {{ entry: ImageEntry, guides: { v: number[], h: number[] } }[]} changes
     * @param {string} label  Names the step, e.g. on the Undo button.
     * @param {Object} [options]
     * @param {GuideRef | null} [options.select]  Guide to leave selected.
     * @param {string} [options.mergeKey]  See History.push.
     * @returns {boolean} False when nothing would change; no step is recorded then.
     */
    commitGuides(changes, label, { select = null, mergeKey } = {}) {
      const effective = changes
        .filter(({ entry, guides }) => !guidesEqual(entry.guides, guides))
        .map(({ entry, guides }) => ({
          entry,
          before: cloneGuides(entry.guides),
          after: cloneGuides(guides),
        }));
      if (effective.length === 0) return false;

      // Undoing later brings back the image that was on screen when the edit was made.
      const focus = this.#active;
      const apply = (side, selection) => {
        for (const change of effective) change.entry.guides = cloneGuides(change[side]);
        this.#active = focus;
        this.#notify({ guides: true, selection });
      };

      this.#history.push(
        { label, undo: () => apply('before', null), redo: () => apply('after', null) },
        { mergeKey },
      );
      apply('after', select);
      return true;
    }

    /** @returns {boolean} Whether there was a step to undo. */
    undo() {
      return this.#history.undo() !== null;
    }

    /** @returns {boolean} Whether there was a step to redo. */
    redo() {
      return this.#history.redo() !== null;
    }

    /** True while `command` is the step that undo() would revert next. */
    isLatest(command) {
      return this.#history.isLatest(command);
    }

    #notify({ guides = false, selection = null } = {}) {
      this.#onChange({ guides, selection });
    }
  }

  app.Project = Project;
})((globalThis.SliceStudio = globalThis.SliceStudio || {}));
