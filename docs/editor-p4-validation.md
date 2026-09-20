# Editor regression follow-up to RC1-P3

The reported caret, overflowing preview and narrow table save failures were reproduced against the P3 source and fixed in this patch.

- Character anchors no longer override horizontal hit testing. Capture click coordinates before asynchronous activation.
- Unaccepted overflow is clipped to the editing frame. Keep the complete draft and require an explicit overflow decision; do not allocate a page-spanning overlay or show collision marks for hidden text.
- Remove the artificial two-em minimum column width. Table resize and height controls grow the row while preserving column width and carrying subsequent rows.
- Visual-only formatting retains authoritative source glyph anchors when text, font metrics and paragraph geometry match. Directional or complex shaping regions retain their existing layout route.
- Focusing original text does not trigger automatic cell growth.

## Reproduction and validation

`npm test` includes `tests/editor-p4.test.mjs`, `tests/editor-p4.py` and `tests/ui-editor-p4.cjs`. The latter uses a generated three-row, two-column PDF with a 14pt text frame: select bold, add 24pt to row height, commit and write the actual PDF. No private document is needed.

Local validation: 109 unit tests, targeted native regressions, P3 fast editor UI and detailed editor UI passed. The P3 fast input scenario made zero native layout calls for 15 edits. Full Windows EXE validation has not been run for this patch.

An additional private 222-page document was sampled with Python random seed 20260920: PDF pages 33, 62, 72, 89, 105, 116, 151, 162, 182, 209. Each page was tested for activation, active click, undo/redo and bold/save, and the written PDF was reopened. In ten fixed samples, page count and non-whitespace character multisets were preserved; raster changes outside the target cell were zero at 1.3x scale, a four-pixel margin and per-channel difference threshold 30. The previous source changed pixels outside the target cell on six pages after bold formatting.

Twenty real cells (tightest and longest per sampled page), each in four layout modes, also received native checks. Plain bold overflow fell from 9/20 to 1/20. The remaining long cell contains a character absent from the resolved font. Its fallback still reflows and increases row height; original activation is stable and the result can be saved. This patch does not claim universal font fidelity.

Local actual-document UI tests used Linux Chromium 153 and native PDF workers. Optional AI layout was unavailable (missing rapid_layout after installing onnxruntime); geometric analysis and native table/layout editing were exercised. This is not evidence of Windows packaged-app behavior or AI layout coverage. Private input PDFs, extracts, screenshots and saved results are excluded from the repository.
