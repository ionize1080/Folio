# Folio PDF Studio 2.8.1

Incremental saves with source protection disabled now append changes on the first save as well as later saves, after checking the original bytes. External changes still stop an unsafe overwrite.

- Adjacent text selection fragments merge into continuous line highlights, including after paragraph editing. Reading preferences offer an independent selection outline switch, off by default. Copying preserves the original text.
- Selection dragging reuses page and glyph measurements during each gesture. Scrolling no longer measures or redraws an unchanged selection.
- Wrapped bookmark titles use a second line only when needed; short titles retain their normal height. The variable-height list remains virtualized. Preference category navigation finishes immediately so controls stay under the pointer.
- Integrates the latest modern design: the font workbench, preview controls and window sizing. Font details are reused, preview coverage needs no extra request, and long samples remain visible at large sizes.

Local validation covered 9 PDFs and 99 save cycles, including the supplied organized financial report, forms, scans, text, images, vectors, OCR layers, bookmark edits, undo/redo, compaction and reopening. MuPDF, PDFium and pypdf independently checked outputs. Three live documents also saved concurrently, including actual local OCR, with isolated edits and 18 tab switches. Original sample files remained unchanged; tests edited copies.

On the local small fixture, a 30-step selection gesture reduced character geometry measurements from 686 to 35. Ordinary scrolling required none. These are operation counts for a defined scenario, not a speed guarantee for every PDF.

Publishing requires all parallel Actions checks from the same commit. The exact portable ZIP is tested in five groups with 33 acceptance scripts. Public CI uses generated and pinned public samples; local user PDFs are not uploaded. Release assets include source, validation evidence and SHA-256 checksums.
