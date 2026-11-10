# Folio artwork workspace

The **Image** and **Vector** ribbon categories open a workspace inside Folio. Choose an existing PDF object, import a file, or start a new artwork with custom dimensions. The original quick image adjustments and SVG controls remain available. **Bookmarks** and **Organize** have their own categories; the AI button remains in the application header.

The workspace uses one Folio header and command row. Its canvas tools, contextual options and inspectors come from pinned PhotoCraft and VectorCraft source builds. The duplicate application menu, title bar, single-document tab and status bar are removed. **All tools** searches the localized command catalogue; commands requiring parameters open their native dialogs. The engines do not launch separate windows or desktop processes.

## Editing coverage

| Area | Integrated tools |
| --- | --- |
| Repair | Clone stamp, healing and spot healing, patch, content-aware fill/removal |
| Local adjustments | Selections, layer/vector masks, gradient masks, adjustment layers and mask painting |
| Layers | Groups, opacity and blend modes, smart objects, editable smart filters, undo/redo |
| Selection | Rectangle/ellipse, lasso/polygon/magnetic lasso, magic wand/quick selection, paths, selection refinement |
| Painting | Brush, pencil, eraser, smudge, dodge/burn/sponge; configurable brush properties |
| Filters | Gaussian/motion/lens blur, noise reduction, high pass, liquify, distortion, lens corrections and color adjustments |
| Transformation | Free transform, skew, perspective, grid warp and puppet warp |
| Color | 8/16/32-bit source documents, RGB/CMYK/Lab/gray, ICC/proofing controls and HDR source workflows |
| Productivity | Align/distribute, flip, actions/macros, channels/histograms, independent export quality controls |
| Vector | Pen/Bezier nodes and handles, shapes, Boolean paths/shape builder, alignment, gradients, text, effects, tracing, artboards and symbols |

Availability and parameters come from the live engine registry. A disabled command can require a document, suitable layer, selection, or other context; the UI preserves its enabled state. This is a source integration of these engines, not a claim that every Photoshop or Illustrator feature, plugin, file or rendering behavior is identical. Native source roundtrip and representative repair/mask/filter/Boolean/gradient/text workflows are exercised by `tests/creative-engines.cjs`.

## View and PDF reference

The percentage control opens **Canvas view**: fit artwork, fit PDF page, width, height, fill, selection, actual size, horizontal/vertical centering and custom percentage. Maximum zoom is 12,800% for raster work and 64,000% for vector work. Navigation changes the camera only. It never writes the object's PDF placement matrix.

New artwork starts with the current PDF page as its view background. Background choices are the transparency grid, a solid color, or the current PDF page. PDF mode adds a 0–100% strength control and a refresh button. The page is rendered from the current PDF including applied edits. Its corners are mapped through the inverse object-placement matrix into artwork coordinates; both engines render it through the same camera as the artwork. Rotation, mirroring, shear and nonzero page crop origins remain aligned. Fit PDF page shows the surrounding document. The reference includes existing page content, including the previously applied version of the edited object; use opacity or switch to the transparency grid to inspect transparency independently.

Backgrounds are view-only. They are excluded from PNG/PDF exports, source documents and PDF history. The placement popover changes PDF geometry explicitly; merely zooming, panning or centering does not change it. Tests compare exported artwork and the PDF placement matrix before and after camera/background changes.

## Saving

**Apply to PDF** creates one undoable edit. Existing images, paths and earlier quick-vector artworks are replaced at their original paint position. Vector results remain PDF vector artwork. The PDF stores the final artwork and small identity/geometry metadata, without source layers or editing history. **Save .folio** retains `.pcraft` / `.vectorcraft` sources so layers, masks and effects can be reopened. **Export** saves an independent artwork file.

DOCX and XLSX exports are directly available in **Export**, with local processing selected by default. They use pdf2docx/python-docx and openpyxl, respectively; these exports do not invoke LibreOffice. The full distribution retains LibreOffice for the separate Office-to-PDF import feature. Source evidence coverage and table assignment coverage are reported separately; neither is a visual layout fidelity score.

## AI / MCP

`folio_studio` shares the exact live human editor. Start with `objects`, then `open` (`kind`, object `index`/`id`, or new document `settings`). `list` finds existing sessions; the AI's live context identifies the visible editing session. Use `commands` with search/pagination for precise command IDs, parameters and enablement. `execute`, serial `batch`, and `request` expose the full engine/control surface. `inspect` reads the current state; `preview` returns artwork pixels. `show` hands the same canvas to the user. `apply`, `delete`, `duplicate` and `move` require the current Folio revision.

`view` accepts `options.mode=fit/page/width/height/fill/selection/actual/center/center-x/center-y/zoom/in/out`; `zoom` accepts `percent`. `background` accepts `options.mode=checker/solid/pdf`, `color=#rrggbb`, `opacity=0..1`, and `refresh=true`. Neither changes PDF placement. The tools action describes the native methods. Vector batches can form one undo group, but a failure reports completed steps rather than promising transactional rollback.

`folio_organize` exposes the same page assembly operations as the thumbnail UI: insertion, blank pages, deletion, extraction, replacement, copy, reverse, rotation, crop/resize, marks and split. Internal destinations and outlines are remapped to retained pages. The organizer snapshots current applied PDF edits and saves the assembled result as a PDF.

## Reproducible build

Use Rust 1.95 with `wasm32-unknown-unknown`, Python 3.12, and the locked source revisions. Run `python scripts/build-creative.py photo` and `python scripts/build-creative.py vector`; the builder installs the exact wasm-bindgen CLI version from each Cargo.lock. No platform editor binary is downloaded. Run `python scripts/verify-creative.py` before packaging. GitHub builds both engines concurrently, checks every asset hash, and passes the same artifacts to integration and packaged-executable tests.

The 2.5 release workflow runs core contracts, dependency preparation and engine builds concurrently, followed by 15 independent test suites. Native regressions are partitioned without omissions into three jobs; failures in one partition do not cancel the others. Final packaged checks use two isolated application lanes. Every report is bound to the commit and Actions run before publishing. Optional cache writes retain the project's 8 GiB budget; the workflow does not raise paid storage limits.

The real Qwen suite uses the shipped Chatbox transport and live tools to paint raster layers, unite vector paths, add gradients/text, adjust PDF backgrounds and maximum zoom, apply edits and organize pages. It imposes no output token limit, audits actual request parameters, and independently verifies exported pixels, vector paths, placement matrices and page order.

## Studio controls in 2.5

The object picker includes thumbnails, physical page numbers and dimensions. Page-object loading does not block creation or import. **Pan**, **Fit** and **Canvas Size** are directly available beside the view controls; **Position and Size** changes placement on the PDF. Dismissing a menu clears its highlighted anchor. UI text uses the host Windows UI fonts where available, including localized CJK and monospaced numeric faces, with bundled fallbacks. These view fonts do not replace document fonts.
