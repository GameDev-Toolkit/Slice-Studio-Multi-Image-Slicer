/**
 * Transient, non-blocking notifications ("toasts").
 *
 * The container is an ARIA live region, so messages are announced without stealing focus.
 * Markup comes from a <template> in index.html; this file only fills it in and manages lifetime.
 */
(function (app) {
  'use strict';

  const DEFAULT_DURATION_MS = 4500;
  /** Errors, and toasts that offer an action, stay up longer so they can be read and used. */
  const LONG_DURATION_MS = 9000;
  const MAX_VISIBLE = 4;

  class Toaster {
    #container;
    #template;

    /**
     * @param {HTMLElement} container
     * @param {HTMLTemplateElement} template
     */
    constructor(container, template) {
      this.#container = container;
      this.#template = template;
    }

    /**
     * @param {string} message
     * @param {Object} [options]
     * @param {'info' | 'error'} [options.kind]
     * @param {{ label: string, run: () => void }} [options.action]  Optional button, e.g. Undo.
     * @returns {() => void} Dismisses the toast early.
     */
    show(message, { kind = 'info', action } = {}) {
      const toast = this.#template.content.firstElementChild.cloneNode(true);
      toast.classList.add(`toast--${kind}`);
      toast.querySelector('.toast-message').textContent = message;

      let timer = 0;
      const dismiss = () => {
        clearTimeout(timer);
        toast.remove();
      };
      const duration = kind === 'error' || action ? LONG_DURATION_MS : DEFAULT_DURATION_MS;
      const startTimer = () => {
        clearTimeout(timer);
        timer = setTimeout(dismiss, duration);
      };

      if (action) {
        const button = toast.querySelector('.toast-action');
        button.textContent = action.label;
        button.hidden = false;
        button.addEventListener('click', () => {
          dismiss();
          action.run();
        });
      }
      toast.querySelector('.toast-close').addEventListener('click', dismiss);

      // Do not let a toast vanish while the pointer rests on it or one of its buttons has focus.
      let hovered = false;
      let focused = false;
      const holdOrResume = () => {
        if (hovered || focused) clearTimeout(timer);
        else startTimer();
      };
      toast.addEventListener('pointerenter', () => {
        hovered = true;
        holdOrResume();
      });
      toast.addEventListener('pointerleave', () => {
        hovered = false;
        holdOrResume();
      });
      toast.addEventListener('focusin', () => {
        focused = true;
        holdOrResume();
      });
      toast.addEventListener('focusout', (event) => {
        // Focus that only moves between the toast's own buttons has not left it.
        focused = toast.contains(event.relatedTarget);
        holdOrResume();
      });

      this.#container.append(toast);
      while (this.#container.childElementCount > MAX_VISIBLE) {
        this.#container.firstElementChild.remove();
      }
      startTimer();
      return dismiss;
    }
  }

  app.Toaster = Toaster;
})((globalThis.SliceStudio = globalThis.SliceStudio || {}));
