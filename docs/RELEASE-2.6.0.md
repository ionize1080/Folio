# Folio PDF Studio 2.6.0

Paragraph editing now retains small original glyph overhangs, recognizes Chromium paragraph tags and monochrome Type3 fonts, and avoids splitting paragraphs at hyperlink underlines. This fixes the reported Adrian Day paragraph failure while retaining the initial A through save and reopen.

Font matching starts during idle time after opening a document. Reusable coverage, rankings, selected faces and browser-ready programs reduce repeated work; active editing preempts the low-priority worker. Native positioned text is written in a single batch, and dense-table grouping uses spatial lookup.

The local campaign covers 32 documents and 95 pages, including 17 pinned public documents: 303 successful edits, 136 explicit limitations, no integrity assertion failures, and unchanged originals. Actions runs six native regression lanes, four public-corpus lanes, real editing UI checks and verification of the final Windows package. See [architecture and evidence](https://github.com/ionize1080/Folio/blob/v2.6.0/docs/EDITING-2.6.0.md).

This release does not claim Acrobat parity. Complex link/tag ownership, overlapping foreign paint, unsupported encodings and some shaping cases still have limits; cross-page automatic reflow is not included.
