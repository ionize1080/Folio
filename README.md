# Folio PDF Studio

**English** · [简体中文](README.zh-Hans.md) · [繁體中文](README.zh-Hant.md)

An offline PDF workspace for Windows x64, built for **long-document bookmarks, in-page text and image editing, and OCR review**. The portable package includes its runtime, fonts and models. No separate Python or Node.js installation is needed.

[Download](https://github.com/ionize1080/Folio/releases/latest) · [1.7.2 release notes](docs/RELEASE-1.7.2.md) · [Limitations](#limitations) · [Development](#development)

## Language and appearance

English is the default for new and previously unconfigured profiles, regardless of Windows language. Choose **English / 简体中文 / 繁體中文** using the globe control in the top bar or **Preferences → Interface language**. Your choice is saved locally and takes effect without reopening the document. Both light and dark themes support the control.

Display language is independent of PDF text, bookmark titles, fonts, OCR settings and script conversion. Switching does not translate documents or discard pending edits. Native Windows file dialogs follow Windows language settings. Engine and operating-system diagnostics may retain original technical text.

## Download and get started

| Attachment | Purpose |
| --- | --- |
| `Folio-PDF-Studio-1.7.2-portable-win-x64.zip` | Complete portable application; extract everything and run `Folio.exe` |
| `Folio-PDF-Studio-1.7.2-source.zip` | Complete offline source and bundled resources |
| `Folio-PDF-Studio-1.7.2-validation.json` | Acceptance results tied to source and binary hashes |
| `Folio-PDF-Studio-1.7.2-SHA256.txt` | Attachment checksums |

Keep the entire folder, including `resources`, `locales` and DLLs. GitHub's automatic Source code archives are repository snapshots and contain fewer resources than the complete source attachment.

1. Open or drop a PDF or `.folio` project.
2. Edit bookmarks, page text or images; review OCR when needed.
3. Apply or finish the edit, then **Save**. Applying updates the session; it does not save the file.
4. For continued editing with paragraph structure and OCR corrections, use **More tools → Import / Export → Save .folio project**.

Original protection saves a copy first. **About → Check for updates** offers stable/prerelease channels and the HTTP proxy shared with Preferences. Updates are verified before installation. The updater retains the application folder name and a previous-version backup. Versions 1.3–1.6 can fail to launch or retain the update helper; use the one-time repair tool attached to the current release, as described in [Upgrading](docs/RELEASE-1.6.2.md#upgrading-from-13–16).

## Features

### Reading and document operations

Single, continuous, two-page and horizontal layouts; thumbnails, zoom, fit page/width, view history, text selection/copy, search, collapsible panels and themes. Pages and high-zoom tiles render on demand with cache budgets and stale-task cancellation.

Annotations, rotation, extraction, PDF appending, PNG export, metadata editing, password handling and local qpdf/pikepdf password-free copies are included. Extraction uses the original PDF, excludes unsaved changes and does not copy the entire bookmark tree. Save before appending another PDF; its bookmarks are not merged automatically. Save and reopen before PNG export if new annotations must be included.

### Bookmarks and automatic outlines

**Auto bookmarks** is always available in the toolbar.

| Capability | Included |
| --- | --- |
| Tree editing | Siblings/children, rename, multi-select, cut/copy/paste, drag, indent/outdent, expand/collapse, undo |
| Properties | Styles, colors, physical pages, coordinates, zoom, destination modes and original-action provenance |
| Filtering | Text/regex, case and page; select true matches while displaying ancestor paths |
| Batch rules | Find/replace, prefixes/suffixes, numbering, whitespace, destination parameters, difference previews and reports |
| Generation | Multi-level regex, capture-group titles, font sizes, pasted contents and page intervals; current-page or range preview |
| Text reconstruction | Baseline tolerance, column separation, optional multiline headings, conflict/missing-parent diagnostics |
| Insertion/deduplication | Append, replace, insert before/after/as child; parent/title/page and position-tolerance deduplication |
| Regex splitting | Sibling or hierarchical outputs, full-original-title evaluation, preview, child migration and destination inheritance |
| Calibration/margins | Match titles to page positions; rotation-aware visual top spacing in mm/pt |
| Rule memory | Recent rules, favorites, presets and import/export; restored rules require fresh previews |
| Exchange | Folio JSON and contents TXT; no proprietary PDF-XChange exchange format |

Review ranges and coordinates before applying. Cross-file import converts resolvable local destinations rather than copying original action dictionaries blindly.

### In-page text, fonts and tables

Click a paragraph to edit. Character controls include font, size, bold/italic and color. Paragraph controls include alignment, spacing, indentation, columns and Format Painter. Shift-drag constrains frame movement; arrows nudge by 1 pt, or 10 pt with Shift.

Supported small changes retain original glyph geometry. Larger edits use local line reflow or MuPDF Story. Limited same-length corrections can reuse original font resources; other edits use verified content fragments. Font matching uses coverage, outlines and widths across embedded, bundled and local fonts.

Paragraphs can be split, merged, linked within a page and manually structured. Overlap/overflow notices allow continued editing; unreliable source mapping and missing glyph coverage still block unsafe writes. Compare paragraph or full-page output before saving.

Simple ruled tables support cell text, row heights, row/column insertion/deletion, widths, rectangular merging/splitting, preview and undo. CSV/XLSX export preserves text, leading zeros and merged ranges. Structural editing stays within the original bounds and is limited to 1,000 cells.

### Images and selection

Choose **Edit image**, then click a page image. Changes preview in place and apply at source resolution. Tools include brightness/contrast, levels/histograms, curves, exposure, hue/saturation, vibrance, color balance, black-and-white, channel mixing, photo filters, LUTs, selective color, inversion, posterization, threshold, gradient maps, clarity, dehaze, blur, sharpening and grain.

Levels provide input/output handles, channels, numeric controls and samplers. Curves provide points, pencil drawing, smoothing, grids and on-image adjustment. Crop on the page using ratios, guides, rotation, straightening and perspective correction. Enter confirms; Esc cancels. Crop can be reset before saving.

Hand, text and object-selection tools support box selection, Ctrl/Shift modifiers and batch edits. Replacement images support contain, fill and stretch. Algorithms are Folio's independent implementation, not Photoshop's proprietary engine; RGB processing uses 8-bit RGB.

### Offline OCR

RapidOCR and ONNX Runtime CPU provide PP-OCRv6 small and PP-OCRv5 mobile profiles. Select pages or a region, 180/240/300 DPI, and automatic/custom resource limits. Results save page by page; stop while retaining results and resume with the same settings.

Review text against the scan, inspect orientation candidates, confirm/defer entries and correct text or geometry. Applying creates a searchable hidden text layer and retains the scan. Unconfirmed issues require review or exclusion. Language checkboxes guide notices and do not expand model capabilities. Simplified/Traditional conversion retains original recognition text and confidence. Hidden-text corrections do not change visible text in the image.

### Projects, recovery and large files

`.folio` V2 uses ZIP STORE for the original PDF, state, immutable assets and a hash manifest. It reads V1 projects; older applications cannot read V2 output. Workers, streamed saves, temporary files and atomic replacement protect existing files. IndexedDB recovery checks integrity and retains the last complete snapshot on quota failure.

PDFs above **768 MiB** enter a separate file-backed workspace, up to **8 GiB**, for reading, bookmarks, regex previews and saving a copy. It does not provide page editing, OCR, full-text search, projects or automatic recovery. Sparse-file checks above 4 GiB validate offsets, not performance for every real multi-GB yearbook. Projects are limited to 1 GiB. These budgets are not total-process memory caps.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl+O / Ctrl+S / Ctrl+Shift+S | Open / Save / Save as |
| Ctrl+F / F3 / Shift+F3 | Find / Next / Previous |
| Ctrl+Z / Ctrl+Y | Undo / Redo, prioritizing the active editor |
| Ctrl+Shift+B | New bookmark from selection/current view |
| F2 / Delete | Rename / Delete selected subtree |
| Ctrl+0 / Ctrl+1 / Ctrl+2 | Fit page / Actual size / Fit width |
| Alt+Left / Alt+Right | View history; indent/outdent inside the bookmark tree |
| Ctrl+Enter | Finish paragraph; confirm and advance in OCR review |

Shortcuts are focus-aware and configurable. Tab moves focus. Language selection supports the keyboard and uses native names rather than flags.

## Architecture

| Layer | Modules and responsibility |
| --- | --- |
| Desktop | Electron, `main.cjs`, `preload.cjs`: windows, dialogs, restricted IPC, workers and updates |
| Workspace | HTML/CSS, ES modules, PDF.js: rendering, selection, editing and review |
| Localization | `src/i18n.mjs`, `src/locales/`: offline catalogs, locale persistence, UI translation and user-content exclusions |
| Structure | pdf-lib, Web Workers: bookmarks, annotations, rules, filters and projects |
| PDF engine | Python, PDFium, PyMuPDF, pikepdf/libqpdf: objects, geometry, composition and writeback |
| Fonts/layout | `native/font_*`, `native/fast_layout.py`, `native/original_patch.py`, MuPDF Story |
| OCR | `ocr-jobs.cjs`, `native/worker.py`, `src/ocr-*.mjs`: tasks, diagnostics and corrections |
| Images/tables | `src/image-*.mjs`, `native/image_*`, `src/table-*.mjs`, `native/table_*` |
| State/save | `src/project*`, `src/recovery.mjs`, `source-store.cjs`, `file-store.cjs`: assets, recovery and atomic saves |

The original PDF remains the session baseline. Content is composed, bookmark provenance is checked, and then the output is written. Displaying a PDF does not imply every object can be rewritten losslessly. See the [documentation index](docs/README.md) for historical technical records.

## Limitations

- Unembedded fonts, unusual encodings, Type3, complex shaping, unsupported directions and nonstandard page units may remain read-only or require explicit fallback fonts.
- Saving/reopening may split paragraphs. Searchable text does not prove that original spaces, code formatting and all glyph positions were retained.
- OCR can omit characters, misread orientation or merge across cells. Confidence does not establish completeness; review output.
- Cross-page reflow, arbitrary image wrapping, complex/borderless/nested tables and structured equation editing are not fully supported.
- Forms, secure redaction, digital signing and proprietary PDF-XChange bookmark exchange are not implemented. Rewriting may invalidate signatures.
- Ordinary edits and projects retaining original content are not secure redaction. Off-page content is clipped on export.
- Automated Windows acceptance does not cover every real IME, mixed-DPI setup or hardware combination. Linux engine tests do not imply a Linux desktop release.

## Development

Windows CI uses Node.js 24, Python 3.12 and the pinned lockfile.

```sh
npm ci
python -m pip install -r tests/requirements.txt
python -m pip install --target native/vendor fonttools==4.61.1
python scripts/restore-assets.py
npm run test:unit
npm run build:win
npm run test:package
```

See [.github/workflows/folio-v16.yml](.github/workflows/folio-v16.yml) for full packaging and Windows acceptance, including fontTools licensing. `npm start` launches development mode. `npm test` is the historical standard suite; release-specific checks run separately. Set `FOLIO_EXE` for `node tests/i18n-v16.cjs`. Other options include `FOLIO_PYTHON`, `FOLIO_CHROMIUM` and `FOLIO_FIXTURES`.

Edit translation JSON, run `node scripts/build-locales.mjs`, then unit/UI acceptance. Preserve placeholders and technical tokens. List new languages only after complete translation and validation. See [localization guidance](docs/LOCALIZATION.md).

## Roadmap and licensing

Priorities remain paragraph ownership after reopening, font fidelity, OCR completeness/orientation, manual-correction protection, first-edit speed and real large-file performance. Cross-page reflow and structured export remain future work. Historical measurements are not acceptance for new binaries; each release includes its own report.

Folio code uses [MIT](LICENSE). Distributed PyMuPDF/MuPDF components use AGPL terms; fonts, models and runtimes retain their own licenses. The root license does not relicense dependencies. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Document processing and translation stay local. There is no telemetry. Checking/downloading updates accesses GitHub. Local OCR/layout models do not automatically generate or rewrite document prose.

## Smart contents recognition

**More tools → Smart table of contents** detects candidate pages, reconstructs entries from geometry, and searches each target independently. Review titles, hierarchy and candidate pages before applying. Optional bundled offline OCR supports image-only documents. [Workflow and limitations](docs/RELEASE-1.7.0.md) · [Corpus evidence](docs/SMART-TOC-VALIDATION.json) · [Online sample provenance](docs/SMART-TOC-SOURCES.json).


Smart contents 1.7.2 adds a menu icon, one-click detection/matching, compact review and cross-page bulk selection. See [release notes](docs/RELEASE-1.7.2.md) for the Acrobat regression and validation limits.

### Reliability acceptance

`npm run test:quick` runs all unit contracts and archive/release transport tests. `npm run test:full` also runs native preservation and browser transaction tests; install the test dependencies and Playwright browser first. The machine-readable capability list is `scripts/acceptance.json`. Native Windows package, updater and offline OCR checks remain part of the release workflow. See [review decisions](docs/REVIEW-2026-10-07-response.md).
