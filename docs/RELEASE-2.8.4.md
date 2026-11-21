# Folio PDF Studio 2.8.4

[English](RELEASE-2.8.4.md) · [简体中文](RELEASE-2.8.4.zh-Hans.md) · [繁體中文](RELEASE-2.8.4.zh-Hant.md)

You can start typing in a supported horizontal paragraph while Folio prepares the page behind it. Incremental saves also work with Adobe Reader XI on the cross-reference stream that produced error 14 in 2.8.3. [Windows x64 portable and source downloads](https://github.com/ionize1080/Folio/releases/tag/v2.8.4)

## Edit a paragraph at its original position

Open a text PDF, enter paragraph editing and click a supported horizontal paragraph. Start typing or undo while the edit background and font are prepared. Use **Ctrl+B** and **Ctrl+I** for bold and italic. Returning to a previously inspected page reuses its page data. Native workers also reuse the font-name index and refresh it when fonts change.

![Folio 2.8.4 with a paragraph active for editing on the demo page](images/2.8.4/paragraph-edit.webp)

On two tagged paragraphs in the Hang Lung interim report, preparing the edit backgrounds took **0.420 s and 0.939 s**, down from 1.468 s and 2.094 s in the same local comparison. First entry into edit mode and applying an edit that needs a new glyph can still take several seconds. [Measurements and fidelity checks](https://github.com/ionize1080/Folio/pull/26)

In a separate local edit on page 23, inserting the replacement took 4.1 ms, applying it took 12.85 s, and incremental saving took 3.47 s. [Six-stage timing breakdown](VALIDATION-2.8.4.md)

## Find a command and work on the page

Press **Ctrl+Shift+P** and type part of a command name. The bookmark and OCR workbenches have updated controls. Search groups the results in the interface, and the reading view offers page tones. Enabling restore-view also skips an unnecessary PDF open-action lookup.

![The 2.8.4 command palette open over the generated demo PDF](images/2.8.4/command-palette.webp)

[Illustrated feature tour](FEATURES.md) · [Screenshot sources](SCREENSHOTS.md)

## Open incremental saves in Adobe Reader XI

Folio preserves the source cross-reference format, document identifiers and trailer entries, including metadata in a linearized PDF’s first trailer. Adobe Reader XI 11.0.10.32 reproduced error 14 after each of two 2.8.3 saves of the same cross-reference-stream fixture. Both 2.8.4 saves opened and the expected text could be copied from both pages. In the same fixture, reopening the failing 2.8.3 copy in 2.8.4 and saving incrementally restored readability while preserving all bytes of the previous revision. [Error 14 reproduction and recovery](https://github.com/ionize1080/Folio/actions/runs/44871005460/job/136745299657)

Twelve additional public PDFs opened in fresh Reader XI processes and reached their last pages. They included classic and linearized files, successive saves and paragraph edits. Reader XI copied the expected Chinese text after the first save, second save and redo. [Reader XI test run](https://github.com/ionize1080/Folio/actions/runs/44870462512/job/136743594117)

## Check what changed in a saved PDF

The edited Chinese paragraph in the Synology DS1621+ data sheet reopened as searchable text. The adjacent column, raised footnote and the other seven pages matched the reference rendering. In a two-column NAACL paper, the saved abstract gained only `Test.` in extraction order. Folio preserves the order of lines sharing a text object when it can reconstruct their original text state.

Seven separate bookmark-only saves passed qpdf. MuPDF compared text, page geometry and rendering at 0.32× on all 305 pages. PDFium compared rendering at 0.5× on 19 sampled pages. The Windows release supplies the tested portable ZIP, source ZIP, validation JSON and SHA-256 list. [2.8.4 validation](VALIDATION-2.8.4.md) · [Windows release workflow](https://github.com/ionize1080/Folio/actions/workflows/release-284.yml)
