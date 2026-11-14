# Folio PDF Studio 2.8.0

The modern workspace brings clearer ribbon commands, a three-pane bookmark rule editor, an OCR review workspace and a redesigned page organizer. Light and dark themes retain the same document layout.

- Opening another PDF keeps the current document visible and usable while the new editor prepares its first page. It then switches within the same window. Existing tabs retain their page, selection, undo history and unsaved edits; reopening the same path selects its existing tab. Password prompts remain accessible, and failed or cancelled opens preserve the previous document.
- Ribbon categories and document-tab buttons retain their DOM. Switching categories no longer rebuilds commands or changes the document viewport. Keyboard navigation, disabled commands and collapse state stay synchronized.
- Bookmark rows reuse unchanged elements; destination-coordinate edits reuse the preview image. Rule previews cache extracted text and update automatically. Colour presets correctly mark changed styles, and repeated inline renaming leaves no duplicate rows.
- The page organizer supports keyboard reordering, Space quick look, thumbnail zoom, marquee selection and PDF/image drops. Rotation reuses cached thumbnails; closing releases pending rendering resources. Changes can be applied to the current document before saving.
- Scrolling searches only nearby page geometry and avoids repeating active-page work. Text and layout reuse reduces unnecessary copying. OCR cache cleanup protects live snapshots and jobs throughout asynchronous scans.
- Electron is updated to 44.11.3, with dependency fixes included in the lockfile.

Local Windows measurements on the included small PDF fixtures showed approximately **4–8 ms median warm document activation** and **0.5 ms P95 ribbon click-handler time**, with no command-subtree reconstruction over 96 category switches in three languages. The next rendered ribbon frame was around 13 ms. These measurements describe the tested machine and fixtures; first opens still depend on file complexity, storage, decryption and rendering.

Publication requires parallel GitHub Actions checks for the same source commit, including native editing, OCR, saving integrity, printing, AI workflows and the modern interface. The exact portable ZIP is tested across four package jobs with **29 acceptance scripts**, followed by hash and provenance validation. The release includes the portable ZIP, source archive, validation JSON and SHA-256 checksums.
