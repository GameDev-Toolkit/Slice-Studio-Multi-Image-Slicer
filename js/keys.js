/**
 * Keyboard helpers: layout-independent shortcut resolution.
 * Pure and DOM-free; unit-tested under Node.
 */
(function (app) {
  'use strict';

  /** Physical keys (KeyboardEvent.code) for the punctuation used by shortcuts, US layout. */
  const PUNCTUATION_BY_CODE = {
    Minus: '-',
    Equal: '=',
    Comma: ',',
    Period: '.',
    BracketLeft: '[',
    BracketRight: ']',
  };

  /**
   * Resolves a key event to the character a shortcut should be matched against.
   *
   * The typed character wins whenever it is plain ASCII, so remapped Latin layouts (AZERTY,
   * Dvorak, ...) trigger shortcuts by the letter printed on the key. On layouts that do not
   * produce ASCII at all (Cyrillic, Greek, ...) the physical key position is used instead,
   * so Ctrl+Z keeps working without switching input language.
   *
   * @param {{ key: string, code: string }} event
   * @returns {string} Lower-cased character, or the unmodified `key` for named keys ("Escape").
   */
  function shortcutKey({ key, code }) {
    if (key.length !== 1) return key;
    if (key.charCodeAt(0) < 0x80) return key.toLowerCase();
    if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
    if (/^Digit\d$/.test(code)) return code.slice(5);
    return PUNCTUATION_BY_CODE[code] ?? key;
  }

  /**
   * Describes a key event as a combination such as "mod+shift+z" or "shift+ArrowLeft".
   *
   * "mod" stands for Ctrl, or Cmd on macOS. Shift is only reported for letters and named keys:
   * for punctuation it is merely how the character happens to be typed on a given layout. The
   * same goes for AltGr, which Windows reports as Ctrl+Alt.
   *
   * @param {KeyboardEvent} event
   * @returns {string}
   */
  function combo(event) {
    const key = shortcutKey(event);
    const altGraph = event.getModifierState?.('AltGraph') ?? false;
    const parts = [];
    if (!altGraph && (event.ctrlKey || event.metaKey)) parts.push('mod');
    if (!altGraph && event.altKey) parts.push('alt');
    if (event.shiftKey && (key.length > 1 || /^[a-z]$/.test(key))) parts.push('shift');
    parts.push(key);
    return parts.join('+');
  }

  app.keys = { shortcutKey, combo };
})((globalThis.SliceStudio = globalThis.SliceStudio || {}));
