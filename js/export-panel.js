/**
 * Export panel: the export preferences form, a live summary of what an export will produce,
 * and the export run itself with its progress and cancel controls.
 */
(function (app) {
  'use strict';

  const { exporter, naming } = app;
  const { clamp, plural, setText } = app.util;

  const numberOr = (input, fallback) =>
    Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : fallback;

  class ExportPanel {
    #dom;
    #settings;
    #toaster;
    #getImages;
    /** AbortController of the export in progress, or null. */
    #job = null;

    /**
     * @param {Record<string, HTMLElement>} dom  The panel's elements, keyed by id.
     * @param {Object} context
     * @param {Settings} context.settings  Shared preferences; updated in place. See settings.js.
     * @param {Toaster} context.toaster
     * @param {() => { all: ImageEntry[], active: ImageEntry | null }} context.getImages
     */
    constructor(dom, { settings, toaster, getImages }) {
      this.#dom = dom;
      this.#settings = settings;
      this.#toaster = toaster;
      this.#getImages = getImages;

      // Offer only what this browser can encode, and drop a saved choice that is not among it.
      const supported = exporter.supportedFormats();
      for (const option of [...dom.exportFormat.options]) {
        if (!supported.includes(option.value)) option.remove();
      }
      if (!supported.includes(settings.format)) settings.format = 'png';

      this.#write();

      const onChange = () => {
        this.#read();
        this.#write();
        this.sync();
      };
      for (const control of [
        dom.exportFormat, dom.exportQuality, dom.nameTemplate, dom.fixedSizeEnabled, dom.fixedWidth,
        dom.fixedHeight, dom.skipEmpty, dom.includeManifest, dom.exportScope,
      ]) {
        control.addEventListener('change', onChange);
      }
      // Validate the naming pattern as it is typed, without rewriting the field under the caret.
      dom.nameTemplate.addEventListener('input', () => this.sync());

      dom.btnExport.addEventListener('click', () => this.run());
      dom.btnCancelExport.addEventListener('click', () => this.#job?.abort());
    }

    /** Refreshes the file-name example, the summary line and the button states. */
    sync() {
      const dom = this.#dom;
      const sources = this.#sources();
      const compiled = naming.compileTemplate(dom.nameTemplate.value);

      const hint = compiled.ok ? this.#exampleName(compiled, sources[0]) : compiled.error;
      dom.nameTemplate.setAttribute('aria-invalid', String(!compiled.ok));
      dom.nameExample.classList.toggle('is-error', !compiled.ok);
      setText(dom.nameExample, hint);

      const tiles = sources.reduce(
        (total, image) => total + (image.guides.v.length + 1) * (image.guides.h.length + 1),
        0,
      );
      const origin = sources.length === 1 ? sources[0].name : `${sources.length} images`;
      const summary = sources.length > 0 ? `${plural(tiles, 'tile')} from ${origin}` : '';
      setText(dom.exportSummary, summary);

      const exporting = this.#job !== null;
      dom.btnExport.disabled = exporting || sources.length === 0 || !compiled.ok;
      dom.btnExport.setAttribute('aria-busy', String(exporting));
      dom.btnCancelExport.hidden = !exporting;
      if (!exporting) setText(dom.exportLabel, 'Export ZIP');
    }

    /** Slices the images in scope and hands the resulting ZIP to the browser as a download. */
    async run() {
      if (this.#job) return;
      // Read the form now: a value may have been typed without its field losing focus yet.
      this.#read();
      this.#write();

      const sources = this.#sources();
      if (sources.length === 0) return;

      const toaster = this.#toaster;
      const options = this.#options();
      let plan;
      try {
        plan = exporter.planExport(sources, options);
      } catch (error) {
        toaster.show(error.message, { kind: 'error' });
        return;
      }

      this.#job = new AbortController();
      this.#setProgress(0);
      this.sync();
      try {
        const { blob, written, skipped } = await exporter.runExport(plan, options, {
          signal: this.#job.signal,
          onProgress: (fraction) => this.#setProgress(fraction),
        });
        exporter.download(blob, plan.archiveName);

        const notes = [];
        if (skipped > 0) notes.push(`${plural(skipped, 'empty tile')} skipped`);
        if (plan.deduplicated) notes.push('clashing names were numbered');
        const details = notes.length > 0 ? ` (${notes.join(', ')})` : '';
        toaster.show(`Exported ${plural(written, 'tile')} to ${plan.archiveName}${details}.`);
      } catch (error) {
        if (error.name === 'AbortError') {
          toaster.show('Export canceled.');
        } else {
          console.error(error);
          toaster.show(`Export failed. ${error.message}`, { kind: 'error' });
        }
      } finally {
        this.#job = null;
        this.sync();
      }
    }

    /** The images an export covers under the current scope setting. */
    #sources() {
      const { all, active } = this.#getImages();
      if (this.#settings.scope !== 'active') return all;
      return active ? [active] : [];
    }

    #options() {
      const { format, quality, template, fixedSize, skipEmpty, manifest } = this.#settings;
      return {
        format,
        quality,
        template,
        fixedSize: fixedSize.enabled ? { width: fixedSize.width, height: fixedSize.height } : null,
        skipEmpty,
        manifest,
      };
    }

    /** Name the first tile of `image` would get, to show what the pattern produces. */
    #exampleName(compiled, image) {
      const name = naming.sanitizeSegment(naming.stripExtension(image ? image.name : 'image'));
      const path = naming.renderPath(compiled, { name, row: 0, col: 0, index: 0, x: 0, y: 0 });
      return `e.g. ${path}${exporter.FORMATS[this.#settings.format].extension}`;
    }

    /** Pulls the form into the shared settings, validating as it goes, and saves them. */
    #read() {
      const dom = this.#dom;
      const settings = this.#settings;
      Object.assign(
        settings,
        app.settings.sanitize({
          ...settings,
          format: dom.exportFormat.value,
          // The field shows a percentage; an empty field keeps the previous value.
          quality: numberOr(dom.exportQuality, settings.quality * 100) / 100,
          template: dom.nameTemplate.value,
          fixedSize: {
            enabled: dom.fixedSizeEnabled.checked,
            width: numberOr(dom.fixedWidth, settings.fixedSize.width),
            height: numberOr(dom.fixedHeight, settings.fixedSize.height),
          },
          skipEmpty: dom.skipEmpty.checked,
          manifest: dom.includeManifest.checked,
          scope: dom.exportScope.value,
        }),
      );
      app.settings.save(settings);
    }

    /** Reflects the settings in the form, which also normalizes whatever was typed. */
    #write() {
      const dom = this.#dom;
      const { format, quality, template, fixedSize, skipEmpty, manifest, scope } = this.#settings;

      dom.exportFormat.value = format;
      dom.exportQuality.value = String(Math.round(quality * 100));
      dom.exportQuality.disabled = !exporter.FORMATS[format].lossy;
      dom.fixedSizeEnabled.checked = fixedSize.enabled;
      dom.fixedWidth.value = String(fixedSize.width);
      dom.fixedHeight.value = String(fixedSize.height);
      dom.fixedWidth.disabled = !fixedSize.enabled;
      dom.fixedHeight.disabled = !fixedSize.enabled;
      dom.skipEmpty.checked = skipEmpty;
      dom.includeManifest.checked = manifest;
      dom.exportScope.value = scope;
      // The pattern field is left alone while it is being typed in.
      if (document.activeElement !== dom.nameTemplate) dom.nameTemplate.value = template;
    }

    #setProgress(fraction) {
      const percent = Math.round(clamp(fraction, 0, 1) * 100);
      this.#dom.btnExport.style.setProperty('--progress', `${percent}%`);
      setText(this.#dom.exportLabel, `Exporting ${percent}%`);
    }
  }

  app.ExportPanel = ExportPanel;
})((globalThis.SliceStudio = globalThis.SliceStudio || {}));
