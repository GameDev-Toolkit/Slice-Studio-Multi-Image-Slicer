/**
 * Sidebar file list: one row per loaded image with a thumbnail, its size and its tile count.
 *
 * Rows are keyed by image id and reused between renders, so updating the list never rebuilds
 * the DOM or redraws thumbnails that are already there.
 */
(function (app) {
  'use strict';

  const { plural, setText } = app.util;

  /** Thumbnail edge length in CSS pixels; must match .file-thumb in the stylesheet. */
  const THUMBNAIL_SIZE = 36;

  function drawThumbnail(canvas, image) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const size = Math.round(THUMBNAIL_SIZE * dpr);
    canvas.width = size;
    canvas.height = size;

    // Fit the whole image inside the square without distorting it.
    const scale = Math.min(size / image.width, size / image.height);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    const ctx = canvas.getContext('2d');
    // Enlarged pixel art should stay crisp; photos being shrunk should be filtered.
    ctx.imageSmoothingEnabled = scale < 1;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image.source, (size - width) / 2, (size - height) / 2, width, height);
  }

  function describe(image) {
    const tiles = (image.guides.v.length + 1) * (image.guides.h.length + 1);
    return `${image.width} × ${image.height} · ${plural(tiles, 'tile')}`;
  }

  class FileList {
    #list;
    #template;
    /** @type {Map<number, HTMLElement>} */
    #rows = new Map();
    #activeId = null;

    /**
     * @param {HTMLElement} list
     * @param {HTMLTemplateElement} template
     * @param {{ onSelect: (id: number) => void, onRemove: (id: number) => void }} handlers
     */
    constructor(list, template, { onSelect, onRemove }) {
      this.#list = list;
      this.#template = template;

      // One delegated listener serves every row, however many images are loaded.
      list.addEventListener('click', (event) => {
        const row = event.target.closest('.file-item');
        if (!row) return;
        const id = Number(row.dataset.id);
        if (event.target.closest('.file-remove')) onRemove(id);
        else onSelect(id);
      });
    }

    /**
     * @param {ImageEntry[]} images  See images.js.
     * @param {number | null} activeId
     */
    render(images, activeId) {
      // Rows of removed images go first, so the rows that stay are already in place below.
      const present = new Set(images.map((image) => image.id));
      for (const [id, row] of this.#rows) {
        if (present.has(id)) continue;
        row.remove();
        this.#rows.delete(id);
      }

      images.forEach((image, position) => {
        const row = this.#rows.get(image.id) ?? this.#createRow(image);

        const isActive = image.id === activeId;
        row.classList.toggle('active', isActive);
        const select = row.querySelector('.file-select');
        if (isActive) select.setAttribute('aria-current', 'true');
        else select.removeAttribute('aria-current');

        setText(row.querySelector('.file-meta'), describe(image));

        // Only touch the DOM when a row is new or out of place.
        if (this.#list.children[position] !== row) {
          this.#list.insertBefore(row, this.#list.children[position] ?? null);
        }
      });

      if (activeId !== this.#activeId) {
        this.#activeId = activeId;
        // Selection can change from the keyboard or through undo; keep it in sight.
        this.#rows.get(activeId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }

    #createRow(image) {
      const row = this.#template.content.firstElementChild.cloneNode(true);
      row.dataset.id = String(image.id);

      // File names are untrusted text and are only ever assigned as text, never as markup.
      const name = row.querySelector('.file-name');
      name.textContent = image.name;
      row.querySelector('.file-select').title = image.name;

      const remove = row.querySelector('.file-remove');
      remove.title = 'Remove from project';
      remove.setAttribute('aria-label', `Remove ${image.name}`);

      drawThumbnail(row.querySelector('.file-thumb'), image);
      this.#rows.set(image.id, row);
      return row;
    }
  }

  app.FileList = FileList;
})((globalThis.SliceStudio = globalThis.SliceStudio || {}));
