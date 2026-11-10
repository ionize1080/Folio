# Editing workflows in 2.5.0

## Image and studio consistency

In page-image mode, the transparent object hit target remains transparent under pointer hover, keyboard focus and selection. The context menu exposes quick adjustment, crop/replacement and opening the same object in Image Studio.

Studio input is normalized to the image as it appears in the PDF. The replacement path applies the inverse placement transform instead of flipping the already normalized pixels again. Tests include mirrors, rotations, skew, page rotation, rectangular and curved clipping, even-odd holes, nested graphics-state restoration, perspective and contain/cover/stretch replacement. The 62 local geometry checks compare independent MuPDF and PDFium renders. The largest measured mean channel difference in this run was 0.22 on a 0–255 scale. This measurement describes these fixtures, not every PDF.

All six browser PDF-loading paths share the same JPEG2000 WASM decoder, CMap and font resources. A real yearbook regression changes the first summary year from 2024 to 2026 and compares the neighboring railway photograph: both the editing background and saved PDF retain every image pixel. A negative control without the decoder reproduces the missing photograph.

The picker shows source-image thumbnails with physical page and dimensions. Creation and import remain usable while extraction runs. Sessions belong to their PDF document; switching documents cannot silently select a different document's artwork.

## Paragraph editing and bookmarks

Read-only inspection retains the selected page's fonts, resources and object identity while avoiding a clone of every page. A bounded native cache serves inspection and background preview; the renderer deduplicates in-flight page inspections per source and releases document references when the source is collected. Tagged documents keep their structure-aware handling. Writes still target the complete original document.

Trailing source whitespace no longer causes a false ink-overflow error. Numbered headings such as 3.9 remain separate from adjacent prose, while quantities such as 3.9亿元 stay within their paragraph. Font-coverage results and unchanged source-stream parsing are reused.

The equivalence regression compares legacy and focused inspection fields on synthetic documents and four local sample PDFs. In one run, the yearbook page 62 inspection changed from 3.41 s to 1.28 s under concurrent work. Built-in fallback fonts now preload alongside inspection using the same shared promises, including browser font decoding. In the final yearbook run, the actual selection event to editable input took 3.03 s initially and 1.02 s on reselection. Playwright click and visibility waits are reported separately and are not presented as application processing time. Timings vary with CPU load and font-cache state. The end-to-end report separately records entering the editor, selecting a paragraph, applying and reopening, so a native microbenchmark is not presented as a complete click-to-edit measurement.

Bookmark provenance normalizes only floating-point serialization differences within four ULPs. Intentional coordinate changes remain rejected. The real 100-page yearbook test edits a paragraph, uses the actual AI document snapshot/render path, inserts two custom pages and saves a copy. Independent reopening checks all 91 bookmark destinations, original glyph positions and unchanged-page pixels. User PDFs and API keys are excluded from release archives.

## Blank pages

**Organize → Insert Blank Pages** allows matching the insertion page or another page, choosing A3/A4/A5/B5/Letter/Legal, or entering custom dimensions in mm, inches or points. Orientation, count, first/current/last/custom target and before/after insertion are visible in one dialog. Preview and validation update together; cancellation works even when a hidden or visible field was previously invalid. Reference dimensions use the visible cropped, rotated and scaled page.

The dialog was compared with the installed PDF-XChange Editor through actual desktop interaction. It covers the requested blank-page controls; it does not claim all PDF-XChange features are identical.

## Image provider setup

Open **AI → Settings → Image Model Provider** in either docked or separate Chatbox. Choose the protocol/provider, endpoint, model and key. Save, then test to see the returned preview. Existing saved settings are retained. The key is held by the main process and is never included in chat or returned by the settings-read response.

Qwen Token Plan uses `qwen-image-3.0-pro` in this release's live tests. Qwen native reference-image requests use their JSON protocol; OpenAI-compatible providers use the selected image protocol. A blue-circle generation and an orange recolor both returned HTTP 200, and independent pixel classification verified the requested change. This does not establish support for every provider that advertises compatibility.

The authorized local-history audit found eight source-registration-limit errors, one unsupported search operation and one invalid bookmark-color error in the November 5 log. Source lifecycle tests cover release on success and failure. The audit records counts and categories without copying API keys or conversation text.

## Interface review

Review used [Apple's menu guidance](https://developer.apple.com/design/human-interface-guidelines/menus) and [typography guidance](https://developer.apple.com/design/human-interface-guidelines/typography), alongside Windows conventions. Menus clear anchor highlights after dismissal, indicate the selected option with a check, group related commands and use an ellipsis for commands that need more input. Dropdowns retain native keyboard semantics while using shared spacing, padding, color and borders.

Both Rust/WASM studios receive the host UI's Latin, CJK, symbol and numeric fonts, with bundled fallback fonts where the host face is unavailable. These fonts affect controls only. PDF text and artwork keep their document-font choices. Direct pan/fit/size controls reduce trips through the command catalogue.

## Performance approach and build verification

The raster and vector engines already compile from Rust to WebAssembly. Current paragraph grouping takes approximately 1.85–3.19 ms on the profiled samples; rewriting this small JavaScript operation in WASM would not address the larger font preparation and document-copy costs. Profiling is used before moving additional work: eliminating whole-document copies and redundant parsing directly reduces latency, whereas moving orchestration into WASM would retain those costs. Native paragraph geometry, font compatibility and saved PDF content must agree before an optimization is accepted. The current implementation follows [PyMuPDF's reusable page/text extraction model](https://pymupdf.readthedocs.io/en/latest/page.html) while preserving Folio's source-object protections.

The [2.5 workflow](../.github/workflows/release-250.yml) runs the two engine builds concurrently and requires 15 independent acceptance suites. Seventeen final-package checks run in two isolated lanes and include the new studio controls, provider settings, paragraph editing, page insertion and independent saved-file verification. Reports are tied to the source commit and workflow run; the updater verifies the same executable and application hashes inside the final ZIP before publication. Published evidence is attached to the [release](https://github.com/ionize1080/Folio/releases/tag/v2.5.0).
