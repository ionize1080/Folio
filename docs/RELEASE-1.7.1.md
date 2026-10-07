# Folio PDF Studio 1.7.1

Smart contents now offers one-click detection, extraction and destination matching. Its More tools menu icon is restored.

- High-confidence entries are selected automatically. Select all ready entries across every page of the current filter, deselect, search titles, or show only review/unresolved/selected entries. Explicit bulk adoption of first candidates keeps those entries marked for review.
- Compact editable rows replace large scrolling cards. Expand details only for correction or preview. Advanced range, direction and offline OCR controls remain available.
- Exclude running headers/folios, preserve closing brackets and quotes, and retain consistent indentation levels across continuation pages. Additional examples/figures/tables indexes are optional.
- Internal PDF links are corroborated against destination headings. Unverified links remain candidates and cannot override independently supported destinations.

The user's Acrobat SDK guide was tested with real PDF.js extraction, UI and matching worker. Its main contents on pages 3–8 produce 291 automatically located entries, agreeing individually with all 291 original outline titles, physical pages and levels (title comparison ignores chapter prefixes, whitespace and punctuation; punctuation preservation has a separate regression test). This local sample result is not an accuracy guarantee for arbitrary artistic contents. The source PDF is not redistributed.

Validation includes 181 unit tests, cross-page bulk selection/filtering, real PDF save/reopen, packaged offline OCR, previously reviewed artistic samples, and the full Windows release suite. Publishing now reconciles draft state and asset hashes after transient network failures without replacing conflicting or published assets.

Download and extract the portable Windows x64 ZIP and run Folio.exe, or use the in-app updater. Offline processing and the previous updater repair remain available. Review uncertain entries and save the PDF to persist generated bookmarks.
