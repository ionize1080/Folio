# Independent TOC page calibration

Calibrate each bookmark against actual heading evidence across a user-selected
body-page range. Every entry may have a different offset. Multiple headings can
share a page; destinations may go backwards. The current target page and the
other entries' offsets do not constrain candidate ranking.

## Using the feature

- Open **More tools → Calibrate TOC page numbers**, or use the same button in
  target calibration or the generated-bookmark preview.
- Select bookmarks and body pages; exclude the contents/index pages explicitly.
- Run analysis. Review the original destination, candidate page, per-entry
  offset, heading evidence and confidence score. Preview original and proposed
  pages. Repeated headings and similar candidates remain unselected.
- Select high-confidence suggestions, choose individual candidates, or enter a
  physical PDF page manually. Manual choices are visibly marked as unverified.
- Apply the selected changes as one undoable operation. Generated outlines can
  be calibrated before they are committed. Existing hierarchy and styles stay
  intact. Unselected existing destinations are retained.

This changes bookmark destinations. It does not rewrite visible numbers on the
contents page, repair PDF PageLabels, or modify page order.

## Evidence and confidence

Production PDF/OCR line extraction supplies heading text and native page
coordinates. Adjacent lines supply additional candidates, retaining the original
lines. All requested pages are considered, even if the original target contains
an earlier body mention. Exact headings rank above approximate text and body
mentions. Margin text, repeated headers, short titles, TOC-like leaders and
competing candidates reduce confidence or require review.

Imported TOC labels are retained verbatim. Brackets, full-width digits, common
Unicode decimal digit sets, Chinese numerals, Roman numerals and prefixed labels
such as A-12 are parsed. Roman preliminary numbering remains distinct from
Arabic body numbering. PDF page labels and visible page-margin numbers are
supporting evidence; they cannot remove a heading candidate. A missing or wrong
label does not create a global offset assumption.

Scores are heuristic evidence scores, not measured correctness probabilities.
They need calibration against a labelled real-document corpus before any claim
about statistical accuracy. Equal repeated headings, short labels, missed OCR
and artwork cannot be resolved reliably by this first implementation.

## Resource and state handling

Matching runs in a terminable Web Worker. Analysis is explicit, cancellable and
bounded to 10,000 selected bookmarks, 250,000 extracted/combined lines and a
30-second worker phase. Results are paginated in groups of 50; selection counts
cover the entire preview. Changing settings invalidates the preview. Changed
PDF/session/bookmarks/OCR/page rotation prevent applying stale results. Applying
selected targets validates pages and retains a one-step undo snapshot.

The first implementation works in the ordinary workspace, using an existing
text layer or applied OCR. It does not load a new VLM or automatically OCR the
whole document. The file-backed multi-GB workspace, art-directory visual
association, richer typography features and cross-page relation models remain
separate follow-up work. Missing TOC page numbers outside the document still
require correcting the initial import before opening calibration.

## Validation

- `npm run test:unit`: existing and new regression tests, including independently
  varying offsets, backwards destinations, same-page headings, repeated titles,
  wrong labels, cross-line titles, rotated coordinates, multilingual labels,
  stale previews, manual targets, preserved styles/hierarchy and undo.
- `node tests/page-calibration-ui.cjs`: production app, real synthetic PDF,
  PDF.js extraction, Web Worker matching, previews, apply/undo, actual PDF
  write/reopen, cancellation, stale-state checks, localization and generation
  handoff. Set `FOLIO_CHROMIUM` to a supported local Chromium/Edge executable.
- `.github/workflows/toc-page-calibration.yml`: unit and real-PDF browser checks
  on Windows using installed Microsoft Edge. This is renderer/browser coverage,
  not a claim that a new portable EXE has been built or released.
