# Folio PDF Studio 1.7.2

This release strengthens the link between applied edits, previews and saved PDFs.

- Append preserves applied text/table/image content and OCR, including after a save in the same session. Save, append and page comparison share a version-checked export snapshot.
- Failed table selection invalidates prior previews. Late responses cannot enable Apply for a different table. Non-grid decorations are preserved; mixed grid/decoration paths require cell text editing.
- Ordinary and streamed saves detect external file changes using identity and SHA-256 before replacement. Save a copy or reopen when a conflict is reported.
- Text that would overflow an inherited PDF clip is rejected with the draft preserved. Stream-level clip tracking also covers clips omitted by engine inspection.
- Generic image editing retains perspective settings and ignores stale replacement-file reads. Replacement images remain editable after PDF save/reopen across contain, cover and stretch modes.
- Edit backgrounds have a 6MP/8192px limit per surface. Neutral, adjusted and perspective image replacement share pre-decode size checks.
- TOC links cannot override ambiguous or ineligible body matches. Recognition and OCR review evidence constrain automatic selection; manual targets update their status immediately.
- Continuous Shift selection, IME guards, dialog names, menu focus, keyboard panel resizing, joint panel width budgets, empty rule names and target-page FitR sizing are corrected.
- Source archives use tracked files plus explicitly restored assets and include a per-file manifest. General main/PR acceptance, quick/full commands and version-aware updater repair messages are included.

See the [review decisions and remaining work](REVIEW-2026-10-07-response.md). Source masks/default color spaces, independent fill/stroke reflow, OCR cache leases, general resource cleanup and full IPC schemas remain separate work. The app is unsigned. Native input-method and screen-reader manual testing is not claimed.

Download the portable Windows x64 ZIP, extract the entire folder and run Folio.exe. No separate runtime installation is required. English remains the default, with Simplified and Traditional Chinese available. The validation attachment ties acceptance reports to the exact source and packaged binaries.
