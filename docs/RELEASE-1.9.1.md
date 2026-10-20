# Folio PDF Studio 1.9.1

This release improves editing of embedded Chinese fonts, paragraph detection, local insertions and deletions, and tagged PDF roundtrips.

- Recognize legacy Apple TrueType programs embedded in textbook PDFs without replacing their existing glyphs.
- Preserve shared TrueType advances during font subsetting and recover reliable widths from previously saved PDFs, preventing newly inserted Chinese characters from collapsing on a subsequent edit.
- Recover embedded font weight when a saved PDF omits its explicit weight descriptor, preventing existing bold text from being replaced by a regular face on the next edit.
- Publish complete shared font-cache files atomically so concurrent selection and layout cannot read a partially written font or metadata file.
- Sample only the outlines needed for fallback matching, retaining the same candidates and scores while reducing first-use latency.
- Release original-document handles after a committed interface reload or renderer exit, preserving active native leases and preventing repeated sessions from exhausting the source limit.
- Group widely spaced body lines without merging distinct paragraph gaps; keep wrapped six-digit identifiers inside their paragraph.
- Ignore filled table backgrounds as ruling lines, avoiding false miniature cells.
- Preserve source baselines for supported insertions and deletions across extracted Chinese soft wraps.
- Allow existing text over background images and proven text-free background Forms; keep foreground and unresolved content checks.
- Save complete contiguous tagged paragraph ranges while retaining the structure tree and ParentTree. Partial semantic ranges and links remain protected.
- Align saved clipping and reopen tolerances, and validate negative word spacing against actual glyph advances.
- Align missing-glyph recommendations in immediate previews and precise layout without blocking keystrokes on font scoring.
- Keep tagged semantic context during background previews and prevent edits from detaching independently drawn phonetic labels from their base characters.
- Fix full-document saves incorrectly rejecting unchanged bookmark metadata; preserve bookmark destinations and zoom parameters across repeated saves.
- Apply Chinese punctuation rules at local line boundaries and separate diamond list items while retaining each item's continuation lines.
- Allow frames to grow past space-only objects with no painted area; real text, artwork and cell boundaries continue to constrain expansion.

Automated finishing-and-saving intervals still take seconds to tens of seconds and include action waits and scheduling. Preview-state observations were not bound to the current input and may capture stale states; they do not establish valid current-edit layout latency. The report records these limitations and a separate foreground spot-check. Dense exercises and interleaved content retain editing limits; independent phonetic labels do not yet move automatically with their base characters. Reflow across source lines can lose per-character PDF spacing, and decorative backgrounds are not fully recognized as text containers. Completing an edit despite an overflow warning can save text beyond its original frame and colored background; reopening infers a new frame from the saved text and may no longer warn.

The [deep-edit report](DEEP-EDIT-1.9.1.zh-Hans.md) documents 20 selected pages, multiple insertion/deletion positions, full-document saves, real keyboard tests and observations from installed PDF-XChange and Acrobat. Blocked or failed edits are reported separately; this is not a claim of complete editing parity. Original PDFs and extracted sample text are excluded from release attachments.

Extract the complete portable ZIP and run Folio.exe. The validation attachment ties the tested source and application binaries to SHA-256 hashes.
