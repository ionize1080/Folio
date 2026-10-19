# Folio PDF Studio 1.9.0

## Editing and bookmark improvements

- Arrow Up/Down retain the preferred horizontal position across short and empty lines. Home/End and Shift selection follow rendered PDF lines.
- Composition commits mark the draft dirty and form one undo step, including browsers that send a duplicate final input event. Escape during composition does not cancel editing.
- Two-em Chinese paragraph indents can begin a new paragraph after a completed sentence. Positioned spaces at Latin link/style boundaries now survive punctuation and accented characters.
- A direct replacement-font action selects the whole unresolved paragraph and opens the font picker. The choice is explicit and remains undoable.
- Two-column papers and small-caps headings retain their paragraph boundaries. Reopened paragraphs preserve soft/hard wrapping and font mapping, and can be widened and edited again.
- CJK reflow no longer duplicates copied text; saved hyphens and owned paragraph clips allow reliable subsequent edits.
- The font picker shows selection scope and empty search results, scrolls within small windows, and improves dark-theme readability. Late initialization cannot overwrite a chosen font.
- Table cells retain logical wrapping across repeated saves and edits. CJK punctuation tracking supports half-em compression while rejecting negative glyph advances.
- Native-font corrections no longer introduce word-internal spaces during standard PDF extraction or reopened editing, while preserving other glyph positions.
- Saved paragraphs retain exact hyphen and newline semantics. Reopening pages containing inline images no longer damages image operands.
- Bookmark zoom has inherit, fixed percentage, page, width, height and visible-content modes; scopes, preview, undo/redo and saved targets are supported. Converting original local/named targets is explicit; external and unresolved targets are skipped.
- Unicode title case conversion, paste before/after, and selected-subtree expansion/collapse.
- Standalone HTML bookmark export preserves hierarchy, title styles and relative page links. Keep it beside the named PDF. External actions remain plain text.
- All eight bookmark zoom modes are covered, with fixes for filtered scopes, destination coordinates, stale previews, first-click application and clipboard validation. Compact menus work in narrow windows.

## Validation and limits

Windows testing used the local Online Samples corpus, installed Acrobat Pro and PDF-XChange, native desktop interaction, real browser keyboard events, native PDF round trips and packaged-application checks. See [comparison and scope](COMPARISON-1.9.0.zh-Hans.md) and the release validation attachment for exact results and hashes.

The extended corpus run covers 23 selected pages, with separate second-edit and packaged-application checks; it does not certify entire documents. Protected/custom-encoded fonts, scans requiring OCR and paragraphs with insufficient safe space are not counted as successful edits. Font substitution can change wrapping. Actual Sogou Chinese IME candidate selection, single-step undo and Escape during composition were tested on this machine; other IMEs were not individually certified. This release does not claim full PDF-XChange parity: action-chain editing, creating PDF contents pages from bookmarks, bookmark-based page sorting and its proprietary interchange format remain outside this release.

Extract the complete portable archive and run Folio.exe. Existing installations can use Check for updates. No separate Python or Node.js is required.
