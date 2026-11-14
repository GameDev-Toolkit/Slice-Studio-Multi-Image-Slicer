/**
 * Small helpers shared across the app.
 */
(function (app) {
  'use strict';

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  /** "1 tile", "2 tiles". Regular English plurals are all the UI needs. */
  const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

  /** Writes text only when it differs, so readouts refreshed on every pointer move stay cheap. */
  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }

  app.util = { clamp, plural, setText };
})((globalThis.SliceStudio = globalThis.SliceStudio || {}));
