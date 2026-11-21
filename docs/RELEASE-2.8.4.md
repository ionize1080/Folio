# Folio PDF Studio 2.8.4

Use Ctrl+Shift+P to find a command. The OCR and bookmark workbenches have updated controls, and the reading view adds page tones. In a paragraph editor, Ctrl+B and Ctrl+I apply bold and italic.

For supported horizontal paragraphs, you can type or undo at the original text position while Folio prepares the edit background and font. Reopening an inspected page reuses its page data. Native workers reuse font names and refresh the index when fonts change. Folio also skips unused PDF open-action requests when the restore-view preference is enabled.

Incremental saves preserve the original cross-reference format, document identifiers and trailer metadata, including metadata held in a linearized file’s first trailer. Regression tests cover classic tables, cross-reference streams and documents previously saved by Folio. In the Synology DS1621+ Chinese data sheet, the edited paragraph reopened with searchable replacement text. The adjacent column, raised footnote and seven other pages rendered identically in the comparison. Bookmark-only incremental saves on seven PDFs passed qpdf checks. MuPDF matched text, page geometry and rendering at 0.32× on all 305 pages. PDFium matched rendering at 0.5× on 19 sampled pages. Adobe Reader XI itself has not been tested.

The Windows workflow runs the document, editing, saving and updater regressions and exercises the packaged application. The release includes the portable ZIP, source ZIP, SHA-256 checksums and a validation report tied to the published commit.
