# Folio PDF Studio 1.9.1

This release improves editing of embedded Chinese fonts, paragraph detection, local insertions and deletions, and tagged PDF roundtrips.

- Recognize legacy Apple TrueType programs embedded in textbook PDFs without replacing their existing glyphs.
- Sample only the outlines needed for fallback matching, retaining the same candidates and scores while reducing first-use latency.
- Group widely spaced body lines without merging distinct paragraph gaps; keep wrapped six-digit identifiers inside their paragraph.
- Ignore filled table backgrounds as ruling lines, avoiding false miniature cells.
- Preserve source baselines for supported insertions and deletions across extracted Chinese soft wraps.
- Allow existing text over background images and proven text-free background Forms; keep foreground and unresolved content checks.
- Save complete contiguous tagged paragraph ranges while retaining the structure tree and ParentTree. Partial semantic ranges and links remain protected.
- Align saved clipping and reopen tolerances, and validate negative word spacing against actual glyph advances.

The [deep-edit report](DEEP-EDIT-1.9.1.zh-Hans.md) documents 20 selected pages, multiple insertion/deletion positions, full-document saves, real keyboard tests and observations from installed PDF-XChange and Acrobat. Blocked or failed edits are reported separately; this is not a claim of complete editing parity. Original PDFs and extracted sample text are excluded from release attachments.

Extract the complete portable ZIP and run Folio.exe. The validation attachment ties the tested source and application binaries to SHA-256 hashes.
