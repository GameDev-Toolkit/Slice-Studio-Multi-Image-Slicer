# Slice Studio — Multi-Image Slicer

[![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/HTML)
[![CSS3](https://img.shields.io/badge/CSS3-1572B6?logo=css3&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/CSS)
[![JavaScript](https://img.shields.io/badge/JavaScript-Vanilla-F7DF1E?logo=javascript&logoColor=111)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![JSZip](https://img.shields.io/badge/JSZip-3.10.1-7B68EE)](https://stuk.github.io/jszip/)
[![No build step](https://img.shields.io/badge/build-none-00FFFF)](#quick-start)
[![Runs in browser](https://img.shields.io/badge/platform-browser-3264FA)](#browser-requirements)

**Slice Studio** is a lightweight, browser-based tool for splitting one or more images into tiles. Place guides by hand or generate evenly spaced rows and columns, preview the resulting grid, and export every slice in a single ZIP archive as PNG, JPEG, or WebP.

The app has no backend and no build process. Image decoding, guide editing, slicing, encoding, and ZIP generation all happen in the browser, and the page makes no network requests after it has loaded.

## Table of contents

- [Features](#features)
- [Quick start](#quick-start)
- [How to use](#how-to-use)
- [Controls and shortcuts](#controls-and-shortcuts)
- [How slicing works](#how-slicing-works)
- [Export format](#export-format)
- [Fixed-size output](#fixed-size-output)
- [Project structure](#project-structure)
- [Technical overview](#technical-overview)
- [Browser requirements](#browser-requirements)
- [Privacy](#privacy)
- [Known limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## Features

- Add any number of images with the file picker, by dragging them onto the page, or by pasting them from the clipboard.
- Keep independent guides and zoom/pan settings for every image.
- Add guides with a button or with `V` / `H` right under the pointer.
- Drag guides with live pixel and percentage feedback, nudge them with the arrow keys, or type an exact position.
- Split an image into 2–256 equal rows or columns, or into cells of a fixed pixel size.
- Copy a layout to every other image at once, or copy and paste it between images and browser tabs.
- Undo and redo every edit, including removing an image.
- Preview every slice with its row, column, and pixel dimensions.
- Zoom toward the pointer from 2% to 6400% and pan around large images.
- Export slices from the original full-resolution image, independently of the current zoom level.
- Export as PNG, JPEG, or WebP, with a file name pattern of your choice, including subfolders.
- Optionally pad or center-crop every slice to an exact output size, skip fully transparent tiles, and add a `manifest.json` that describes every tile.
- Follow long exports on a progress indicator, and cancel them.
- Work with a mouse, a keyboard, a pen, or a touch screen, down to phone-sized windows.
- Have your export and toolbar preferences remembered between visits.
- Work entirely on the client side and offline: no image is uploaded and nothing is downloaded.

## Quick start

### Option 1: open the app directly

Clone or download the repository, then open `index.html` in a modern browser.

```bash
git clone https://github.com/GameDev-Toolkit/Slice-Studio-Multi-Image-Slicer.git
cd Slice-Studio-Multi-Image-Slicer
```

No dependency installation, compilation, or internet connection is required. Everything the page needs, including JSZip, is in the repository.

### Option 2: run a local web server

Any static file server works.

With Python:

```bash
python -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080).

With Node.js:

```bash
npx serve .
```

Open the address printed in the terminal.

## How to use

1. **Add images.** Click **Add images**, drag image files anywhere onto the page, or paste an image from the clipboard. You can add several files at once.
2. **Select an image.** Choose a file in **Project files**, or step through the list with `[` and `]`. Each image keeps its own guides and zoom/pan state.
3. **Define the slices.**
   - Click **Vertical** or **Horizontal** to add one guide, or press `V` / `H` to drop one under the pointer.
   - Enter a value, choose `parts` or `px`, then click **Cols** or **Rows** to create an even split.
   - Drag a guide to position it. The tooltip displays its pixel position in the original image and the percentage.
   - Click a guide to select it, or step through the guides with `,` and `.`, then nudge it with the arrow keys or type its position into the toolbar field.
   - Click **To all** to copy the layout of the current image to every other image.
4. **Inspect the result.** Click **Preview** to display each tile's row/column index and dimensions. The status bar shows the grid size and the pixel under the pointer.
5. **Choose the export settings.** Pick the format, the file name pattern, and whether tiles get a fixed size, whether empty tiles are skipped, and whether a manifest is added.
6. **Export.** Click **Export ZIP**. The browser downloads one archive containing the slices of every image in the project, or of the current image only.

> [!TIP]
> A guide added with a button lands in the middle of the widest unsplit gap. Repeated clicks therefore produce useful subdivisions without stacking new guides at the same position.

## Controls and shortcuts

Press `?` in the app for the same list. On macOS use `⌘` instead of `Ctrl`.

| Action | Control |
| --- | --- |
| Add images | **Add images**, drop files anywhere on the page, or paste with `Ctrl`+`V` |
| Select an image | Click it in **Project files**, or press `[` / `]` for the previous / next one |
| Remove an image | Click the `×` button beside the file; **Undo** brings it back |
| Add a guide | **Vertical** or **Horizontal**; `V` or `H` adds it under the pointer |
| Select a guide | Click it, or press `,` / `.` for the previous / next one |
| Move a guide | Drag it; press the arrow keys to nudge the selected guide by 1 px, or by 10 px with `Shift`; or type its position into the toolbar field |
| Remove one guide | Double-click it, drag it off the image, or press `Delete` / `Backspace` while it is hovered or selected |
| Remove all guides from the active image | **Clear** |
| Create equal columns or rows | Enter a value, choose `parts` or `px`, then click **Cols** or **Rows** |
| Copy the guides to every other image | **To all** |
| Copy and paste guides | `Ctrl`+`C`, then `Ctrl`+`V` on another image |
| Undo / redo | Toolbar buttons, `Ctrl`+`Z`, and `Ctrl`+`Shift`+`Z` or `Ctrl`+`Y` |
| Cancel a drag, or clear the selection | `Esc` |
| Zoom toward the pointer | Mouse wheel, or pinch on a touch screen or trackpad |
| Zoom in steps | **+** / **−** toolbar buttons, or the `+` / `-` keys |
| Zoom to 100% | Click the zoom percentage, or press `1` |
| Fit the image to the workspace | **Fit**, or press `0` |
| Pan | Drag empty space, hold `Space` and drag, or middle-drag; the arrow keys pan while no guide is selected |
| Toggle tile labels and dimensions | **Preview**, or press `P` |
| Export | **Export ZIP**, or press `Ctrl`+`S` |
| Show the shortcut list | The **?** button, or press `?` |

On a touch screen, drag a guide with one finger, drag empty space to pan, pinch with two fingers to zoom, and double-tap a guide to remove it.

In windows narrower than about 1440 px the toolbar buttons show their icons only. Below 760 px the sidebar turns into a strip above the canvas and an export bar below it.

## How slicing works

Guides are stored as whole pixel positions in the original image, not as screen coordinates. The line drawn on screen is therefore always the exact cut that gets exported, however the view is zoomed, panned, or resized.

- A vertical guide adds a column boundary.
- A horizontal guide adds a row boundary.
- Image edges are always included as boundaries.
- `V` vertical guides create `V + 1` columns.
- `H` horizontal guides create `H + 1` rows.
- The total number of tiles is `(V + 1) × (H + 1)`.
- Guides on one axis are always distinct and lie strictly inside the image, so no slice is ever empty. Dragging a guide onto another one merges the two; a guide nudged with the arrow keys steps over its neighbors instead.
- Each axis can hold up to 255 guides, which makes 256 slices.
- An image with no guides is exported as one full-size tile.

Even splits replace the existing guides on the selected axis and leave the other axis unchanged.

- With `parts`, choosing `4` and clicking **Cols** creates three vertical guides at 25%, 50%, and 75%, rounded to whole pixels, producing four columns.
- With `px`, choosing `32` and clicking **Cols** places a guide every 32 pixels. The last column is narrower when the width is not a multiple of 32.

**To all** and pasting copied guides keep the relative positions of the guides: on an image of a different size the layout is scaled to fit.

Copied guides travel through the clipboard as a short piece of JSON text, so a layout can also be kept in a note or generated by a script:

```json
{"type":"slice-studio/layout","version":1,"width":256,"height":128,"vertical":[64,128,192],"horizontal":[64]}
```

## Export format

Slices are collected in one ZIP archive. The archive stores the files without compressing them again, because image data is already compressed.

| Format | Notes |
| --- | --- |
| PNG | Lossless, keeps transparency. The default. |
| JPEG | Quality 10–100. JPEG has no transparency: transparent areas become white. |
| WebP | Quality 10–100, keeps transparency. Offered only in browsers that can encode WebP. |

**Images** selects what is exported: every image in the project, or the current image only.

### File names

The **File name** field holds a pattern. The default is:

```text
{name}_Row{row}_Col{col}
```

For example, a 2 × 3 grid created from `landscape.jpg` produces:

```text
landscape_Row1_Col1.png
landscape_Row1_Col2.png
landscape_Row1_Col3.png
landscape_Row2_Col1.png
landscape_Row2_Col2.png
landscape_Row2_Col3.png
```

| Placeholder | Value |
| --- | --- |
| `{name}` | Source file name without its extension |
| `{row}`, `{col}` | Row and column, counted from 1, starting at the top-left corner |
| `{index}` | Running number within the image, counted from 1, left to right and then top to bottom |
| `{row0}`, `{col0}`, `{index0}` | The same, counted from 0 |
| `{x}`, `{y}` | Top-left corner of the tile in the source image, in pixels |
| `{index:3}` | Any number can be zero-padded to a width of 1–9 digits: `007` |
| `/` | Starts a folder, for example `{name}/{row}_{col}` |

The line under the field shows the name the first tile will get. The file extension is added automatically.

Names are made safe for Windows, macOS, and Linux:

- The characters `\ / : * ? " < > |` are replaced with underscores, and control characters are removed.
- Trailing dots and spaces are dropped, and names that Windows reserves, such as `CON` or `NUL`, are prefixed with an underscore.
- A pattern cannot escape the archive: empty, `.`, and `..` path segments are discarded.
- Nothing is ever overwritten. Two source images with the same base name are exported as `name` and `name-2`, and tiles that would still end up with the same path are numbered the same way.

Archive naming:

| Export scope | ZIP filename |
| --- | --- |
| One image | `<image-name>_slices.zip` |
| Multiple images | `sliced_images_<image-count>.zip` |

### Skipping empty tiles

With **Skip empty tiles** enabled, tiles whose pixels are all fully transparent are left out of the archive. The notification shown after the export says how many were skipped.

### Manifest

With **Add manifest.json** enabled, the archive also contains a `manifest.json` that lists every exported tile with its source rectangle:

```json
{
  "generator": "Slice Studio",
  "version": 1,
  "format": "png",
  "fixedSize": null,
  "images": [
    {
      "source": "sheet.png",
      "width": 256,
      "height": 128,
      "columns": 8,
      "rows": 4,
      "tiles": [
        { "file": "sheet_Row1_Col1.png", "row": 1, "column": 1, "x": 0, "y": 0, "width": 32, "height": 32 }
      ]
    }
  ]
}
```

`x`, `y`, `width`, and `height` describe the tile in the source image. When a fixed size is used, `fixedSize` holds the dimensions of the exported files.

## Fixed-size output

Enable **Fixed size** to place every exported tile on a canvas with the specified width and height, from `1 × 1` through `10000 × 10000` pixels.

- If a slice is smaller than the target canvas, it is centered and surrounded by transparent padding. JPEG has no transparency, so there the padding is white.
- If a slice is larger than the target canvas, it is center-cropped.
- The slice is not stretched or scaled.
- The setting applies to every image and tile in the next export.

This is useful for sprite sheets, machine-learning datasets, game assets, thumbnails, and other workflows that require uniform dimensions.

## Project structure

```text
Slice-Studio-Multi-Image-Slicer/
├── index.html          # Markup, icons, and templates; loads the scripts below in order
├── styles.css          # Dark interface, layout, and responsive rules
├── favicon.svg
├── js/
│   ├── util.js         # Small shared helpers
│   ├── slicing.js      # Guide model: splits, moves, tile grid, clipboard layouts
│   ├── naming.js       # File name patterns, sanitizing, collision-free names
│   ├── viewport.js     # Zoom and pan math
│   ├── keys.js         # Keyboard shortcut resolution, independent of the keyboard layout
│   ├── history.js      # Undo/redo stack
│   ├── project.js      # Loaded images, the active image, undoable changes
│   ├── settings.js     # Preferences: defaults, validation, storage
│   ├── images.js       # Turns files into decoded images
│   ├── exporter.js     # Export plan, tile encoding, ZIP assembly, download
│   ├── renderer.js     # Canvas drawing
│   ├── stage.js        # Canvas interaction: gestures, zoom, pan, hover, selection
│   ├── file-list.js    # Sidebar file list
│   ├── toast.js        # Notifications
│   ├── export-panel.js # Export form, summary, progress, and cancel
│   └── main.js         # Entry point: commands, shortcuts, clipboard, drag and drop
├── tests/              # Unit tests for the modules that do not need a browser
├── vendor/jszip/       # JSZip 3.10.1 and its license
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

## Technical overview

| Area | Implementation |
| --- | --- |
| User interface | Semantic HTML, custom CSS, and inline SVG icons |
| Rendering | HTML Canvas 2D API with device-pixel-ratio support, redrawn at most once per frame |
| Input | Pointer Events for mouse, pen, and touch; wheel; keyboard |
| Image loading | File API, object URLs, and `Image` |
| Slice generation | One reused off-screen canvas that samples the original image pixels |
| Encoding | `HTMLCanvasElement.toBlob()` |
| Archive generation | JSZip 3.10.1, bundled in `vendor/` |
| Download | Blob URL and a temporary download link |
| Application model | In-memory project with an undo history; preferences in `localStorage`; no backend |
| Security | A Content Security Policy that allows the page's own files only |

The interface canvas is scaled for high-DPI displays, while interactions use CSS-pixel coordinates. Exporting does not capture the visible canvas: each region is sampled directly from the original decoded image, so zoom and pan do not reduce output quality.

The scripts are classic scripts rather than ES modules, because most browsers refuse to load modules from a page opened straight from disk. Each file adds its part to a single `SliceStudio` namespace and depends only on the files loaded before it.

## Browser requirements

Use a current version of Chrome, Edge, Firefox, or Safari. The newest features the app relies on are CSS container queries, `Array.prototype.findLast()`, and `AbortSignal.throwIfAborted()`, which are available from Chrome and Edge 105, Firefox 110, and Safari 16.

The browser must also support:

- HTML Canvas 2D and `HTMLCanvasElement.toBlob()`
- File, drag-and-drop, and clipboard events
- Pointer Events and `ResizeObserver`
- The `<dialog>` element
- Blob URLs

## Privacy

Selected images remain in browser memory and are processed locally. Slice Studio contains no code that sends image content anywhere, and its Content Security Policy forbids the page from contacting any server at all.

The only thing stored on your device is your preferences: the export settings, the file name pattern, the split value, and the preview toggle. They are kept in the browser's `localStorage`. Images, file names, and guides are never stored.

## Known limitations

- Images and guides are not saved; refreshing or closing the page clears them. Only the preferences are kept.
- EXIF metadata, color profiles, animation frames, and other source metadata are not copied to exported slices. An animated image is sliced as a single still frame.
- Very large images, large fixed-size canvases, or grids with many tiles can consume substantial browser memory. Browsers also limit the size of a canvas, which caps the largest tile that can be encoded.
- The ZIP is built in memory before download. One archive can hold at most 65,534 entries (files and folders) and 4 GB; an export that would exceed either limit is refused with an explanation instead of producing a broken archive.
- Pinching on a trackpad zooms the canvas only in browsers that report the gesture as a wheel event, as Chrome, Edge, and Firefox do. Safari on macOS magnifies the whole page instead; zoom with a two-finger scroll or the `+` / `-` keys there.
- JPEG and WebP quality values are passed to the browser's own encoder, so the same value can give slightly different files in different browsers.

## Troubleshooting

### Export does not start

- Confirm at least one image is listed in the sidebar.
- Check the line under the **File name** field. An unknown placeholder disables the button and is named there.
- Make sure the browser allows downloads from the page.
- Read the notification in the corner of the window: it explains why an export was refused or failed.

### An image does not load

- A notification lists the files that could not be read. Files that are not images are rejected right away.
- Verify that the file is a browser-supported image type by opening it directly in the same browser.
- Re-export unusual or damaged source files as PNG or JPEG before importing them.

### A guide is difficult to select

- Zoom in and move the pointer close to the cyan line.
- The cursor changes direction when a guide is within selection range.
- Once a guide is selected, the arrow keys and the position field move it without any dragging.

### Export is slow or the tab runs out of memory

- Export the current image only, or fewer images at once.
- Use fewer rows or columns.
- Reduce the source resolution before loading.
- Avoid unnecessarily large fixed output dimensions.

### Tiles have transparent borders or cropped edges

This is expected when **Fixed size** is enabled. Disable it to export every slice at its natural dimensions, or adjust the target width and height.

### Some tiles are missing from the archive

This is expected when **Skip empty tiles** is enabled: fully transparent tiles are left out.

## Development

There is no compilation step. Edit the source files and refresh the browser:

- Update structure or controls in `index.html`.
- Update presentation and layout in `styles.css`.
- Update behavior in `js/`. [Project structure](#project-structure) lists what each file is responsible for. A new file needs a `<script>` tag in `index.html`, placed after the files it depends on.

The logic that does not need a browser, such as guide math, naming, zoom math, history, settings, and export planning, is covered by unit tests. They use the test runner built into Node.js 18 or newer and need no installation:

```bash
node --test
```

Code style: two-space indentation, single quotes, semicolons, `const` by default, and lines of at most 100 characters. Comments explain why the code does something, not what it does.

When changing slicing behavior, also test at least these cases in a browser:

1. An image with no guides.
2. Only vertical guides and only horizontal guides.
3. A mixed row-and-column grid.
4. Manually positioned guides, including one dragged onto another.
5. Multiple images with different grid layouts, including two files with the same name.
6. Fixed output smaller and larger than the source slices.
7. Filenames containing spaces, Unicode, and filesystem-reserved characters.
8. Large images at different zoom levels.
9. Every export format, with and without **Skip empty tiles** and the manifest.
10. Undo and redo after each kind of edit.
11. A narrow window and a touch screen.

## Contributing

Contributions are welcome. Before submitting a change:

1. Keep the app usable without a build tool.
2. Preserve client-side image processing and full-resolution export.
3. Test in more than one modern browser.
4. Document any new control, shortcut, dependency, or output behavior.
5. Keep changes focused and include clear reproduction or verification steps.

## License

This project is distributed under the **Apache-2.0 license**.

See [`LICENSE`](./LICENSE) for full legal text.

The bundled JSZip library is dual-licensed under the MIT license and the GPLv3; see [`vendor/jszip/LICENSE.markdown`](./vendor/jszip/LICENSE.markdown).

## ❤️ Support the Project

If you find this tool useful, consider leaving a ⭐ on GitHub
