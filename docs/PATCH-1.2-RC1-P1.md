# 1.2.0 RC1 P1 — input performance and core bookmark access

The missing-glyph fallback previously cached by `(source font, character)`. Each different new character repeated system-wide outline comparison and selected/font-file conversion. The original-position renderer also reparsed font coverage JSON for each glyph on every layout.

Changes:
- Reuse up to four selected full fonts per source/script after checking coverage; only run matching again when all cached faces lack the new character. The outer cache is bounded to 64 source/script combinations.
- Cache font metadata by file timestamp (96 entries), selected system faces (96 entries), and reuse source fonts within a layout request. Original embedded glyphs remain preferred; fallback records remain visible.
- Abandon obsolete draft expansion after each native layout call. An already running native call still completes; this is not hard cancellation.
- Use local font size/baseline for caret height, including punctuation and genuinely smaller text.
- Move Automatic Bookmarks from More Tools to a permanently visible main toolbar button.

Validation on Linux:
- 92 JavaScript unit tests passed, including punctuation and mixed-size caret regressions.
- Two fallback-cache tests passed: different missing characters share a full face; a missing glyph or different source font triggers matching again; uncovered selections are rejected.
- Native 1.2 PDF tests passed: standard and embedded fonts retain original positions; style changes still use the fragment path. A real PDF dot has a short ink box but retains its 16pt font metric.
- Controlled Chinese subset test: 192-character initial paragraph; append six distinct missing characters. Subsequent five inputs: before 257.55–451.21 ms, after 63.63–66.25 ms, about 4–7x faster. First missing character: 1033.74 → 951.68 ms. Backend layout time only, on this host; these are not measurements of the user's PDF or Windows machine.
- Native 1.1 regressions passed: actual outline matching, original glyph positions, deliberate full reflow, qpdf decryption, spreadsheet export, and OCR layer replacement.
- Reproduce timings with `python tests/benchmark-input-p1.py` (cold process, then six successive different characters).
- Windows validation completed successfully: https://github.com/ionize1080/Folio/actions/runs/35301324064 — tested source `c2a425e798d72178c198c7e4b25de62ebc1b879a`.
- Full test suite, portable build verification, and packaged Windows EXE open/edit/atomic-save checks all passed. Browser report contains no errors and verifies real punctuation caret geometry plus toolbar visibility at 900 and 1440px.
- Tested packaged `app.asar` SHA-256: `cde3f9806b4b786ae25947b6c11a0fbb652396398c90bede459db7721e2bc534`.
- Portable artifact: https://github.com/ionize1080/Folio/actions/runs/35301324064/artifacts/10530067915
- Source artifact: https://github.com/ionize1080/Folio/actions/runs/35301324064/artifacts/10530262493
- Isolated full-CJK metadata benchmark (1,000 loads): 1964.69 ms before, 11.65 ms after. This is one stage, not end-to-end UI latency.

Limitations: first-time font matching still scans candidate fonts. Entering a new page still inspects it and prepares its PDF background. This patch does not claim to reproduce or eliminate the user's specific tens-of-seconds delay without the affected PDF. AI page analysis was already asynchronous and is not called per input character.
