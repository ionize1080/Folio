# Folio PDF Studio 1.8.0

OCR review can now be skipped in one action while retaining the recognized text. Smart contents recognition preserves more continuation pages and correctly nests chapters under part headings. The app has a new, consistent folded-page icon.

- Choose **Skip all pending review and apply** to keep unreviewed OCR text. Skipping does not mark it as verified, alter confidence scores or override missing-font checks. Applying remains undoable; save the PDF to keep it.
- Recognize spaced dot leaders, Spanish contents banners, alphabetic appendix numbering, sparse continuation pages and off-centre columns beneath full-width introductory text.
- Keep Roman-numbered or larger part headings above numbered chapters. Separate an auxiliary index from main contents even when both share a page. This recovers the xcolor manual's third contents page.
- Contents-page checkboxes make it easier to add or remove candidates before extraction.
- Correct Type1 PDF encoding overrides and subset ligatures. Editing nearby text no longer drops a letter from an original ff ligature. Native and fast editing have save/reopen regressions.
- Use the same original vector icon for the toolbar, welcome screen and Windows program resources, including small icon sizes.

## Validation scope

Downloaded 20 public PDF manuals from CTAN and the R project and inspected 29 unique local PDFs. Tests cover contents extraction, hierarchy, real-page editing, searchable OCR output, bookmark save/reopen, native regression and browser interaction. Four public manuals have no printed contents; absence of generated bookmarks is expected. The validation attachment records final results and package hashes. Samples and private document content are not redistributed.

Automatic selection is not an accuracy guarantee. Scanned yearbooks were checked on 21 contents/detection pages and 12 body sample pages, not every page. Ambiguous destinations still require review. Unsupported source fonts need an explicit replacement; a scanned page needs OCR before its text can be edited.

## Install

Extract the complete portable Windows x64 ZIP and run `Folio.exe`. Keep its resources and DLLs together. English, Simplified Chinese and Traditional Chinese interfaces are included. The update-repair ZIP is retained for older installations; see the 1.6.2 upgrade instructions.
