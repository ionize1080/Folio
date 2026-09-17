# Folio 0.3.0 validation

2026-09-11. Runtime validation is performed on Linux Chromium and Python, not on a Windows desktop.

- Core: 18 tests. Outline/action preservation, eight destinations/null/zero, batch/history, 10k-bookmark serialization, rules, shortcut contexts, save/protection, existing output replacement and failed replacement safety, rotated whitespace and field-level arithmetic reports.
- Existing UI: 19 checks on the 258-page supplied reference. Five layouts, anchored zoom, generation, text selection/search, shortcuts, menus, batch edits, save/history/recovery, DPR 1/1.5/2.
- New UI: 8 actual-native-engine flows. Frame retention, DPR2 tiles, whitespace preview, native text edits, undo/redo, combined save, OCR correction/preview, final searchable save. Exact frame counts are in v3-ui-report.json.
- Native: 7 grouped checks. Native Chinese text/path edits, untouched-page pixels, stale identity rejection, existing text skip, offline reference OCR, searchable dual-layer output with pixel-identical scan appearance, alignment and manual correction. Exact timing is in v3-native-report.json.

Models are verified against upstream SHA-256 values. CPython/wheel hashes and CRCs are checked; VC dependencies are bundled from Microsoft's official redistributable. Folio.exe PE32+/AMD64/version/icon and all packaged application/native files are checked against source. The rebuild reuses the validated Electron runtime from the preserved 0.2 package; BUILD-INFO records the runtime archive hash. The default build path verifies an official Electron ZIP.

No actual Windows launch, file picker/ReplaceFileW execution, antivirus behavior, driver-specific rendering or mixed-monitor DPI test was available. OCR sample success does not guarantee perfect accuracy on other scans. Object editing supports simple top-level objects; replacement text uses the embedded font. Complex clipping/forms/special text modes remain read-only. OCR positioning is line-based; complex layouts require review. Page extraction still uses opened source bytes. Digital signature preservation, PDF/A and encrypted editing are not certified.
