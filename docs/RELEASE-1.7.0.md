# Folio PDF Studio 1.7.0

Smart table-of-contents recognition is available under **More tools → Smart table of contents**.

1. Detect candidate contents pages (first 50 pages by default; editable range), preview them and correct the selected page numbers.
2. Extract entries. Edit titles, printed labels and hierarchy, reorder or remove entries, and add missing entries.
3. Locate physical pages. Each title searches independently across the selected body pages; contents pages are excluded. Exact/fuzzy heading evidence, PDF page labels and printed margin labels provide reviewable candidates. Wrong printed numbers and differing offsets are allowed.
4. Preview source and destination pages. Choose alternatives or enter a physical page manually, then create selected bookmarks. Existing bookmarks can be appended or replaced, with one-step undo. Save the PDF to persist the bookmarks.

Geometry handles horizontal, rotated/diagonal and vertical text, multi-column rows, superscript numbers, wrapped titles, page-first captions and leaders made of dots, symbols, whitespace or vector lines. Page labels include Unicode decimal digits, Chinese ordinary/financial numerals, Roman numerals and prefixed labels. Enable alphabetic labels explicitly for a/b/c numbering; this overrides Roman interpretation of c/i/v/x.

Optional **local AI** uses the bundled RapidOCR/ONNX CPU models for pages with little or no text. Documents stay on the device. OCR does not require a cloud account or download a language model. Existing reviewed OCR is reused. This is OCR plus geometric/evidence rules, not a general-purpose vision-language model.

Scores describe heuristic evidence, not measured accuracy. Arbitrary artistic typography, curved text, severely damaged scans, bilingual interleaving, ambiguous hierarchies and languages unsupported by the OCR model can still need correction. Candidate-page detection can miss pages: enter them manually. Default detection covers 50 pages; body matching covers the user-selected range. Large scanned books are slower with OCR. Conflicting or unmatched destinations are not silently assigned the printed number. Review the title and hierarchy even for automatically selected exact matches.

Includes independent calibration for existing bookmarks and preserves the Windows updater repair from 1.6.2. For older broken updaters, the release includes a one-time repair utility; extract the portable archive separately or run the repair tool with the old installation folder selected.

Validation combines deterministic geometry/numeral tests, real PDF extraction and save/reopen UI tests, local/online exploratory corpora and the full Windows release regression workflow. Corpus counts are not a benchmark accuracy claim; see `SMART-TOC-VALIDATION.json` and the attached validation report.
