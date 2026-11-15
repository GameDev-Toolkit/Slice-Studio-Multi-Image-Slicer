/**
 * Linear undo/redo history.
 *
 * Recording a command does not run it: whoever makes a change applies it themselves, and the
 * history only reverts and re-applies it later. Pure and DOM-free; unit-tested under Node.
 */
(function (app) {
  'use strict';

  /**
   * @typedef {Object} Command
   * @property {string} label  Shown to the user, e.g. "Move guide".
   * @property {() => void} undo
   * @property {() => void} redo
   */

  /** Edits sharing a merge key within this window collapse into a single undo step. */
  const MERGE_WINDOW_MS = 1000;

  class History {
    #undoStack = [];
    #redoStack = [];
    #limit;
    #now;

    /**
     * @param {Object} [options]
     * @param {number} [options.limit]  Maximum number of undo steps kept.
     * @param {() => number} [options.now]  Millisecond clock; injectable for tests.
     */
    constructor({ limit = 200, now = Date.now } = {}) {
      this.#limit = limit;
      this.#now = now;
    }

    /**
     * Records a command, without running it, as the next step to undo.
     *
     * With a `mergeKey`, a command that quickly follows another with the same key replaces its
     * redo side instead of adding a step. Holding an arrow key to nudge a guide therefore undoes
     * in one go rather than one pixel at a time.
     *
     * @param {Command} command
     * @param {{ mergeKey?: string }} [options]
     */
    push(command, { mergeKey } = {}) {
      const time = this.#now();
      const top = this.#undoStack.at(-1);
      this.#redoStack.length = 0;

      if (mergeKey && top && top.mergeKey === mergeKey && time - top.time <= MERGE_WINDOW_MS) {
        top.command.redo = command.redo;
        top.time = time;
        return;
      }

      this.#undoStack.push({ command, mergeKey, time });
      if (this.#undoStack.length > this.#limit) this.#undoStack.shift();
    }

    /**
     * Reverts the latest command and returns it, or null when there is nothing to undo.
     *
     * The stacks are updated before the command runs, so whatever the command notifies
     * already sees the new canUndo/canRedo.
     */
    undo() {
      const entry = this.#undoStack.pop();
      if (!entry) return null;
      // Once undone, a step must never absorb later edits.
      this.#redoStack.push({ ...entry, mergeKey: undefined });
      entry.command.undo();
      return entry.command;
    }

    /** Re-applies the most recently undone command and returns it, or null. */
    redo() {
      const entry = this.#redoStack.pop();
      if (!entry) return null;
      this.#undoStack.push(entry);
      entry.command.redo();
      return entry.command;
    }

    get canUndo() {
      return this.#undoStack.length > 0;
    }

    get canRedo() {
      return this.#redoStack.length > 0;
    }

    /** Label of the command that undo() would revert, or null. */
    get undoLabel() {
      return this.#undoStack.at(-1)?.command.label ?? null;
    }

    /** Label of the command that redo() would re-apply, or null. */
    get redoLabel() {
      return this.#redoStack.at(-1)?.command.label ?? null;
    }

    /** True while `command` is still the next thing undo() would revert. */
    isLatest(command) {
      return this.#undoStack.at(-1)?.command === command;
    }
  }

  app.History = History;
})((globalThis.SliceStudio = globalThis.SliceStudio || {}));
