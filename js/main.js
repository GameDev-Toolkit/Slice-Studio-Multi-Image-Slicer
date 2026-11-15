/**
 * Application entry point: builds the project, the stage and the panels, and wires the toolbar,
 * keyboard, clipboard and drag-and-drop to them.
 */
(function (app) {
  'use strict';

  const { slicing, keys, Project, Stage, FileList, Toaster, ExportPanel } = app;
  const { clamp, plural, setText } = app.util;
  const { MAX_SLICES_PER_AXIS } = slicing;

  /** Distance, in screen pixels, that one arrow-key press pans the view. */
  const PAN_STEP = 48;
  /** Pixels a guide moves per arrow-key press while Shift is held. */
  const NUDGE_STEP_LARGE = 10;

  /** Small windows start with the export settings folded away to leave room for the rest. */
  const COMPACT_LAYOUT = '(max-width: 760px), (max-height: 560px)';

  const element = (id) => {
    const node = document.getElementById(id);
    if (!node) throw new Error(`index.html is missing #${id}`);
    return node;
  };

  const dom = Object.fromEntries(
    [
      'btnHelp', 'btnUpload', 'uploadLabel', 'fileInput', 'fileList', 'emptyFiles',
      'btnUndo', 'btnRedo',
      'btnAddVertical', 'btnAddHorizontal', 'guideAxis', 'guidePosition',
      'btnClearGuides', 'btnApplyToAll',
      'splitValue', 'splitUnit', 'btnSplitCols', 'btnSplitRows',
      'btnZoomOut', 'btnZoomActual', 'btnZoomIn', 'btnZoomFit', 'btnTogglePreview',
      'canvas', 'tooltip', 'emptyState', 'btnBrowse',
      'statusBar', 'statusPosition', 'statusSlices', 'statusImage',
      'exportSettings', 'exportFormat', 'exportQuality', 'nameTemplate', 'nameExample',
      'fixedSizeEnabled', 'fixedWidth', 'fixedHeight', 'skipEmpty', 'includeManifest',
      'exportScope', 'exportSummary', 'btnExport', 'exportLabel', 'btnCancelExport',
      'helpDialog', 'btnCloseHelp', 'toasts', 'toastTemplate', 'fileItemTemplate',
    ].map((id) => [id, element(id)]),
  );

  const settings = app.settings.load();
  const toaster = new Toaster(dom.toasts, dom.toastTemplate);
  const project = new Project({ onChange: onProjectChange });

  const stage = new Stage(dom.canvas, dom.tooltip, {
    onEdit: (guides, label, select) => {
      project.commitGuides([{ entry: project.active, guides }], label, { select });
    },
    onSelectionChange: syncGuideField,
    onViewportChange: syncZoomReadout,
    onPointerMove: syncPointerReadout,
  });

  const fileList = new FileList(dom.fileList, dom.fileItemTemplate, {
    onSelect: (id) => project.activate(project.find(id)),
    onRemove: (id) => removeImage(project.find(id)),
  });

  const exportPanel = new ExportPanel(dom, {
    settings,
    toaster,
    getImages: () => ({ all: project.images, active: project.active }),
  });

  /** Number of file batches still being decoded. */
  let pendingLoads = 0;
  /** The latest image removal while its "Undo" notification is still on screen. */
  let recentRemoval = null;
  /**
   * Whether focus is where it is because the user tabbed there. :focus-visible cannot answer
   * that: browsers turn it on for a clicked button as soon as any key is pressed.
   */
  let focusedByKeyboard = false;

  const axisSize = (image, axis) => (axis === 'v' ? image.width : image.height);

  /** Controls that are operated with Space or Enter and have no use for any other key. */
  const PRESSABLE = 'button, summary, a[href], input[type="checkbox"]';

  /** True for elements that take typing themselves: text and number fields, and selects. */
  const takesTyping = (target) =>
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.matches('input:not([type="checkbox"]), textarea, select'));

  /* Images */

  async function addFiles(files) {
    const batch = [...files];
    if (batch.length === 0) return;

    pendingLoads += 1;
    syncUi();
    try {
      const { images, failures } = await app.images.loadImages(batch);
      project.add(images);
      reportLoadFailures(failures);
    } finally {
      pendingLoads -= 1;
      syncUi();
    }
  }

  function reportLoadFailures(failures) {
    if (failures.length === 0) return;
    if (failures.length === 1) {
      toaster.show(`${failures[0].name} ${failures[0].reason}.`, { kind: 'error' });
      return;
    }
    const names = failures.slice(0, 3).map((failure) => failure.name).join(', ');
    const more = failures.length > 3 ? ` and ${failures.length - 3} more` : '';
    toaster.show(`${failures.length} files could not be read as images: ${names}${more}.`, {
      kind: 'error',
    });
  }

  function removeImage(entry) {
    const command = project.remove(entry);
    if (!command) return;
    const dismiss = toaster.show(`Removed ${entry.name}.`, {
      action: { label: 'Undo', run: () => project.undo() },
    });
    recentRemoval = { command, dismiss };
  }

  /* Guides */

  /** Replaces the guides on one axis of the active image as an undoable step. */
  function commitAxis(axis, guides, label, options) {
    const entry = project.active;
    const next = { ...entry.guides, [axis]: guides };
    return project.commitGuides([{ entry, guides: next }], label, options);
  }

  function addGuide(axis) {
    const image = project.active;
    if (!image) return;
    const size = axisSize(image, axis);
    const existing = image.guides[axis];
    const kind = axis === 'v' ? 'vertical' : 'horizontal';

    if (existing.length >= MAX_SLICES_PER_AXIS - 1) {
      toaster.show(`An image can have at most ${MAX_SLICES_PER_AXIS - 1} ${kind} guides.`, {
        kind: 'error',
      });
      return;
    }

    // From the keyboard the guide lands under the pointer. Otherwise, or when that spot cannot
    // take a guide, it goes to the middle of the widest gap.
    const pointer = stage.pointerOnImage;
    let px = pointer ? Math.round(axis === 'v' ? pointer.x : pointer.y) : null;
    if (px === null || px < 1 || px > size - 1 || existing.includes(px)) {
      px = slicing.midpointOfLargestGap(existing, size);
    }
    if (px === null) {
      toaster.show(`There is no room for another ${kind} guide.`);
      return;
    }

    const next = slicing.normalizeGuides([...existing, px], size);
    commitAxis(axis, next, `Add ${kind} guide`, { select: { axis, index: next.indexOf(px) } });
  }

  function removeTargetGuide() {
    const target = stage.targetGuide;
    if (!project.active || !target) return;
    const next = project.active.guides[target.axis].filter((_, index) => index !== target.index);
    commitAxis(target.axis, next, 'Remove guide');
  }

  /**
   * Moves the selected guide by a number of pixels.
   * @returns {boolean} Whether a guide is selected, i.e. whether the key press was used up.
   */
  function nudgeSelection(dx, dy) {
    const image = project.active;
    const selection = stage.selection;
    if (!image || !selection) return false;

    const { axis, index } = selection;
    const delta = axis === 'v' ? dx : dy;
    // An arrow that points along the guide has nowhere to move it.
    const moved =
      delta !== 0 && slicing.nudgeGuide(image.guides[axis], index, delta, axisSize(image, axis));
    if (moved) {
      const target = { axis, index: moved.index };
      commitAxis(axis, moved.guides, 'Move guide', {
        select: target,
        // A burst of key presses undoes as one step.
        mergeKey: `nudge:${image.id}:${axis}`,
      });
      // A guide moved without a pointer may have left the visible part of the image.
      stage.reveal(target);
    }
    return true;
  }

  /** Moves the selected guide to the position typed into the toolbar field. */
  function moveSelectionTo(value) {
    const image = project.active;
    const selection = stage.selection;
    if (!image || !selection) return;

    if (Number.isFinite(value)) {
      const { axis, index } = selection;
      const size = axisSize(image, axis);
      const px = clamp(Math.round(value), 1, size - 1);
      const moved = slicing.moveGuide(image.guides[axis], index, px, size);
      const target = { axis, index: moved.index };
      commitAxis(axis, moved.guides, 'Move guide', { select: target });
      stage.reveal(target);
    }
    // Shows the position actually applied, or puts the old one back after unusable input.
    syncGuideField();
  }

  /**
   * Selects the guide after or before the selected one, which makes every guide reachable
   * without a pointer. Vertical guides come first, left to right, then horizontal ones.
   */
  function selectNeighboringGuide(step) {
    const image = project.active;
    if (!image) return;
    const guides = [
      ...image.guides.v.map((_, index) => ({ axis: 'v', index })),
      ...image.guides.h.map((_, index) => ({ axis: 'h', index })),
    ];
    if (guides.length === 0) return;

    const selection = stage.selection;
    const current = selection
      ? guides.findIndex(({ axis, index }) => axis === selection.axis && index === selection.index)
      : -1;
    // With nothing selected, stepping forward starts at the first guide and backward at the last.
    const from = current === -1 && step < 0 ? 0 : current;
    const next = guides[(from + step + guides.length) % guides.length];
    stage.select(next);
    stage.reveal(next);
  }

  function clearGuides() {
    const entry = project.active;
    if (entry) project.commitGuides([{ entry, guides: { v: [], h: [] } }], 'Clear guides');
  }

  function split(axis) {
    const image = project.active;
    if (!image) return;
    // Read the field now: a value may have been typed without the field losing focus yet.
    readSplitControls();
    writeSplitControls();

    const size = axisSize(image, axis);
    const slices = axis === 'v' ? 'columns' : 'rows';
    const extent = `${size} px ${axis === 'v' ? 'wide' : 'tall'}`;
    const { unit, count, px } = settings.split;
    let guides;

    if (unit === 'px') {
      const resulting = slicing.sliceCountForCell(size, px);
      if (resulting < 2) {
        toaster.show(`The image is only ${extent}, so ${px} px cells do not divide it.`);
        return;
      }
      if (resulting > MAX_SLICES_PER_AXIS) {
        toaster.show(
          `${px} px cells would make ${resulting} ${slices}. The limit is ${MAX_SLICES_PER_AXIS}.`,
          { kind: 'error' },
        );
        return;
      }
      guides = slicing.splitByCell(size, px);
    } else {
      guides = slicing.splitByCount(size, count);
      const made = guides.length + 1;
      if (made < count) {
        toaster.show(`The image is only ${extent}: split into ${made} ${slices}, not ${count}.`);
      }
    }
    commitAxis(axis, guides, `Split into ${slices}`);
  }

  function applyToAll() {
    const source = project.active;
    if (!source || project.images.length < 2) return;

    const others = project.images.filter((image) => image !== source);
    const changes = others.map((entry) => ({
      entry,
      guides: slicing.fitLayout(source, entry.width, entry.height),
    }));
    const changed = project.commitGuides(changes, 'Apply guides to all images', {
      select: stage.selection,
    });
    toaster.show(
      changed
        ? `Guides copied to ${plural(others.length, 'other image')}.`
        : 'Every image already has these guides.',
    );
  }

  /* Toolbar preferences */

  function readSplitControls() {
    const { unit } = settings.split;
    const typed = dom.splitValue.valueAsNumber;
    // An empty or unusable field keeps the previous value.
    const value = Number.isFinite(typed) ? typed : settings.split[unit];
    const next = { ...settings, split: { ...settings.split, [unit]: value } };
    Object.assign(settings, app.settings.sanitize(next));
    app.settings.save(settings);
  }

  function writeSplitControls() {
    const { unit } = settings.split;
    dom.splitUnit.value = unit;
    dom.splitValue.value = String(settings.split[unit]);
    dom.splitValue.min = unit === 'px' ? '1' : '2';
    dom.splitValue.title = unit === 'px' ? 'Cell size in pixels' : 'Number of equal parts';
  }

  function changeSplitUnit() {
    // Keep what was typed for the old unit before the field switches over to the other one.
    readSplitControls();
    settings.split.unit = dom.splitUnit.value === 'px' ? 'px' : 'count';
    app.settings.save(settings);
    writeSplitControls();
  }

  function togglePreview() {
    settings.showPreview = !settings.showPreview;
    app.settings.save(settings);
    stage.setShowPreview(settings.showPreview);
    dom.btnTogglePreview.setAttribute('aria-pressed', String(settings.showPreview));
  }

  /* Keeping the UI in step with the project */

  function onProjectChange({ guides, selection }) {
    stage.setImage(project.active);
    if (guides) stage.guidesReplaced(selection);

    // The notification's Undo button only makes sense while removal is the next step to undo.
    if (recentRemoval && !project.isLatest(recentRemoval.command)) {
      recentRemoval.dismiss();
      recentRemoval = null;
    }
    syncUi();
  }

  /** Refreshes everything outside the canvas. Cheap enough to run after any state change. */
  function syncUi() {
    const image = project.active;
    const hasImage = image !== null;
    const hasGuides = hasImage && image.guides.v.length + image.guides.h.length > 0;

    fileList.render(project.images, image?.id ?? null);
    dom.emptyFiles.hidden = project.images.length > 0;
    dom.emptyState.hidden = hasImage;
    dom.statusBar.hidden = !hasImage;

    for (const control of [
      dom.btnAddVertical, dom.btnAddHorizontal, dom.splitValue, dom.splitUnit, dom.btnSplitCols,
      dom.btnSplitRows, dom.btnZoomOut, dom.btnZoomActual, dom.btnZoomIn, dom.btnZoomFit,
    ]) {
      control.disabled = !hasImage;
    }
    dom.btnClearGuides.disabled = !hasGuides;
    dom.btnApplyToAll.disabled = !hasImage || project.images.length < 2;

    const { canUndo, canRedo, undoLabel, redoLabel } = project;
    dom.btnUndo.disabled = !canUndo;
    dom.btnRedo.disabled = !canRedo;
    dom.btnUndo.title = `${canUndo ? `Undo: ${undoLabel}` : 'Undo'} (Ctrl+Z)`;
    dom.btnRedo.title = `${canRedo ? `Redo: ${redoLabel}` : 'Redo'} (Ctrl+Shift+Z)`;

    const loading = pendingLoads > 0;
    dom.btnUpload.setAttribute('aria-busy', String(loading));
    setText(dom.uploadLabel, loading ? 'Loading…' : 'Add images');

    if (hasImage) {
      const columns = image.guides.v.length + 1;
      const rows = image.guides.h.length + 1;
      setText(dom.statusSlices, `${columns} × ${rows} slices (${columns * rows} total)`);
      setText(dom.statusImage, `${image.name} — ${image.width}×${image.height}px`);
    }

    syncGuideField();
    syncZoomReadout();
    syncPointerReadout();
    exportPanel.sync();
  }

  function syncGuideField() {
    const image = project.active;
    const selection = image ? stage.selection : null;
    dom.guidePosition.disabled = !selection;

    if (selection) {
      setText(dom.guideAxis, selection.axis === 'v' ? 'X' : 'Y');
      dom.guidePosition.max = String(axisSize(image, selection.axis) - 1);
      dom.guidePosition.value = String(image.guides[selection.axis][selection.index]);
    } else {
      setText(dom.guideAxis, 'px');
      dom.guidePosition.value = '';
    }
  }

  function syncZoomReadout() {
    const zoom = project.active?.viewport?.zoom;
    if (!zoom) {
      setText(dom.btnZoomActual, '--');
      return;
    }
    const percent = zoom * 100;
    setText(dom.btnZoomActual, `${percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`);
  }

  function syncPointerReadout() {
    const point = stage.pointerOnImage;
    setText(dom.statusPosition, point ? `${Math.floor(point.x)}, ${Math.floor(point.y)}` : '—');
  }

  /* Clipboard: guides travel as text, so they can go to another tab or be kept in a note. */

  function onCopy(event) {
    const image = project.active;
    if (!image || takesTyping(event.target) || dom.helpDialog.open) return;
    // Selected text (a notification, for instance) is what the user means to copy.
    if (!document.getSelection().isCollapsed) return;

    event.clipboardData.setData('text/plain', slicing.serializeLayout(image));
    event.preventDefault();
    toaster.show('Guides copied. Switch to another image and paste to apply them.');
  }

  function onPaste(event) {
    if (takesTyping(event.target) || dom.helpDialog.open) return;
    const { files } = event.clipboardData;
    if (files.length > 0) {
      event.preventDefault();
      addFiles(files);
      return;
    }

    const image = project.active;
    const layout = slicing.parseLayout(event.clipboardData.getData('text/plain'));
    if (!image || !layout) return;
    event.preventDefault();

    const guides = slicing.fitLayout(layout, image.width, image.height);
    if (!project.commitGuides([{ entry: image, guides }], 'Paste guides')) {
      toaster.show('This image already has these guides.');
      return;
    }
    const scaled = layout.width !== image.width || layout.height !== image.height;
    toaster.show(
      scaled ? `Guides pasted, scaled from ${layout.width}×${layout.height}.` : 'Guides pasted.',
    );
  }

  /* Keyboard */

  function undo() {
    // Mid-drag, the thing to take back is the drag itself.
    if (!stage.cancelGesture()) project.undo();
  }

  /** Arrow keys move the selected guide; with nothing selected they pan the view instead. */
  function arrow(dx, dy, step) {
    if (!nudgeSelection(dx * step, dy * step)) stage.panBy(-dx * PAN_STEP, -dy * PAN_STEP);
  }

  /** Fired once per key press. */
  const SHORTCUTS = new Map(Object.entries({
    'mod+s': () => exportPanel.run(),
    v: () => addGuide('v'),
    h: () => addGuide('h'),
    Delete: removeTargetGuide,
    Backspace: removeTargetGuide,
    Escape: () => stage.cancelGesture() || stage.select(null),
    0: () => stage.fit(),
    1: () => stage.zoomTo(1),
    '[': () => project.activateNeighbor(-1),
    ']': () => project.activateNeighbor(1),
    p: togglePreview,
    '?': () => dom.helpDialog.showModal(),
  }));

  /** Fired again and again for as long as the key is held down. */
  const REPEATING_SHORTCUTS = new Map(Object.entries({
    'mod+z': undo,
    'mod+shift+z': () => project.redo(),
    'mod+y': () => project.redo(),
    ',': () => selectNeighboringGuide(-1),
    '.': () => selectNeighboringGuide(1),
    '+': () => stage.zoomStep(1),
    '=': () => stage.zoomStep(1),
    '-': () => stage.zoomStep(-1),
    ArrowLeft: () => arrow(-1, 0, 1),
    ArrowRight: () => arrow(1, 0, 1),
    ArrowUp: () => arrow(0, -1, 1),
    ArrowDown: () => arrow(0, 1, 1),
    'shift+ArrowLeft': () => arrow(-1, 0, NUDGE_STEP_LARGE),
    'shift+ArrowRight': () => arrow(1, 0, NUDGE_STEP_LARGE),
    'shift+ArrowUp': () => arrow(0, -1, NUDGE_STEP_LARGE),
    'shift+ArrowDown': () => arrow(0, 1, NUDGE_STEP_LARGE),
  }));

  function onKeyDown(event) {
    if (event.key === 'Tab') focusedByKeyboard = true;
    // A modal dialog owns the keyboard while it is open.
    if (dom.helpDialog.open) return;

    if (event.code === 'Space') {
      onSpaceDown(event);
      return;
    }
    if (takesTyping(event.target)) {
      // Escape hands the keyboard back to the canvas shortcuts.
      if (event.key === 'Escape') event.target.blur();
      return;
    }

    const combo = keys.combo(event);
    let action = REPEATING_SHORTCUTS.get(combo);
    if (!action && !event.repeat) action = SHORTCUTS.get(combo);
    if (!action) return;
    event.preventDefault();
    action();
  }

  /**
   * Holding Space turns dragging into panning. A control the user tabbed to keeps Space for
   * itself; one that merely holds focus because it was clicked does not get in the way.
   */
  function onSpaceDown(event) {
    const { target } = event;
    if (!(target instanceof HTMLElement) || event.ctrlKey || event.metaKey || event.altKey) return;

    const pressable = target.matches(PRESSABLE);
    if (takesTyping(target) || (pressable && focusedByKeyboard)) return;

    event.preventDefault();
    // Otherwise the clicked control would be activated again when Space is released.
    if (pressable) target.blur();
    stage.setPanMode(true);
  }

  /* Wiring */

  /**
   * Accepts files dropped anywhere in the window. Covering the whole window matters: a drop that
   * misses a dedicated target makes the browser navigate to the file, discarding all the work.
   */
  function bindFileDrop() {
    const carriesFiles = (event) => event.dataTransfer?.types.includes('Files') ?? false;
    const showOverlay = (visible) => document.body.classList.toggle('drag-over', visible);
    // dragenter and dragleave fire for every element crossed, so only their balance means anything.
    let depth = 0;

    window.addEventListener('dragenter', (event) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth += 1;
      showOverlay(true);
    });
    window.addEventListener('dragover', (event) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', (event) => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) showOverlay(false);
    });
    window.addEventListener('drop', (event) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      showOverlay(false);
      addFiles(event.dataTransfer.files);
    });
  }

  function bindEvents() {
    const pickFiles = () => dom.fileInput.click();
    dom.btnUpload.addEventListener('click', pickFiles);
    dom.btnBrowse.addEventListener('click', pickFiles);
    dom.fileInput.addEventListener('change', () => {
      addFiles(dom.fileInput.files);
      // Lets the same file be picked again later.
      dom.fileInput.value = '';
    });

    dom.btnUndo.addEventListener('click', undo);
    dom.btnRedo.addEventListener('click', () => project.redo());
    dom.btnAddVertical.addEventListener('click', () => addGuide('v'));
    dom.btnAddHorizontal.addEventListener('click', () => addGuide('h'));
    dom.guidePosition.addEventListener('change', () => {
      moveSelectionTo(dom.guidePosition.valueAsNumber);
    });
    dom.btnClearGuides.addEventListener('click', clearGuides);
    dom.btnApplyToAll.addEventListener('click', applyToAll);

    dom.splitValue.addEventListener('change', () => {
      readSplitControls();
      writeSplitControls();
    });
    dom.splitUnit.addEventListener('change', changeSplitUnit);
    dom.btnSplitCols.addEventListener('click', () => split('v'));
    dom.btnSplitRows.addEventListener('click', () => split('h'));

    dom.btnZoomIn.addEventListener('click', () => stage.zoomStep(1));
    dom.btnZoomOut.addEventListener('click', () => stage.zoomStep(-1));
    dom.btnZoomActual.addEventListener('click', () => stage.zoomTo(1));
    dom.btnZoomFit.addEventListener('click', () => stage.fit());
    dom.btnTogglePreview.addEventListener('click', togglePreview);

    dom.btnHelp.addEventListener('click', () => dom.helpDialog.showModal());
    dom.btnCloseHelp.addEventListener('click', () => dom.helpDialog.close());
    dom.helpDialog.addEventListener('click', (event) => {
      // Only a click on the backdrop has the dialog element itself as its target.
      if (event.target === dom.helpDialog) dom.helpDialog.close();
    });

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', (event) => {
      if (event.code === 'Space') stage.setPanMode(false);
    });
    document.addEventListener('pointerdown', () => { focusedByKeyboard = false; }, true);
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    window.addEventListener('blur', () => {
      // Key and button releases that happen while another window has focus never arrive here.
      stage.setPanMode(false);
      stage.cancelGesture();
    });

    bindFileDrop();
  }

  function init() {
    if (window.matchMedia(COMPACT_LAYOUT).matches) dom.exportSettings.open = false;

    stage.setShowPreview(settings.showPreview);
    dom.btnTogglePreview.setAttribute('aria-pressed', String(settings.showPreview));
    writeSplitControls();
    bindEvents();
    syncUi();
  }

  init();
})(globalThis.SliceStudio);
