# Folio PDF Studio 1.9.0

## Editing and bookmark improvements

- Arrow Up/Down retain the preferred horizontal position across short and empty lines. Home/End and Shift selection follow rendered PDF lines.
- Composition commits mark the draft dirty and form one undo step, including browsers that send a duplicate final input event. Escape during composition does not cancel editing.
- Two-em Chinese paragraph indents can begin a new paragraph after a completed sentence. Positioned spaces at Latin link/style boundaries now survive punctuation and accented characters.
- A direct replacement-font action selects the whole unresolved paragraph and opens the font picker. The choice is explicit and remains undoable.
- Saved paragraphs retain exact hyphen and newline semantics. Reopening pages containing inline images no longer damages image operands.
- Bookmark zoom has inherit, fixed percentage, page, width, height and visible-content modes; scopes, preview, undo/redo and saved targets are supported. Converting original local/named targets is explicit; external and unresolved targets are skipped.
- Unicode title case conversion, paste before/after, and selected-subtree expansion/collapse.
- Standalone HTML bookmark export preserves hierarchy, title styles and relative page links. Keep it beside the named PDF. External actions remain plain text.

## Validation and limits

Windows testing used the local Online Samples corpus, installed Acrobat Pro and PDF-XChange, native desktop interaction, real browser keyboard events, native PDF round trips and packaged-application checks. See [comparison and scope](COMPARISON-1.9.0.zh-Hans.md) and the release validation attachment for exact results and hashes.

The bounded corpus run samples specific pages, not every page. Protected/custom-encoded fonts, scans requiring OCR and paragraphs with insufficient safe space are not counted as successful edits. Font substitution can change wrapping. Actual Chinese IME candidate-window interaction was not automated; composition event ordering was tested. This release does not claim full PDF-XChange parity: action-chain editing, creating PDF contents pages from bookmarks, bookmark-based page sorting and its proprietary interchange format remain outside this release.

Extract the complete portable archive and run Folio.exe. Existing installations can use Check for updates. No separate Python or Node.js is required.
