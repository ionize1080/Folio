## Folio PDF Studio 2.1.0

- Open several PDFs or Folio projects from the file picker or by dragging them into the window. Each tab keeps its reading position, selection, undo history and unsaved edits. Use Ctrl+Tab to switch and Ctrl+W to close the current document.
- Choose Cobalt, Celadon, Amber, Mulberry, Graphite or a custom accent in Preferences. Palettes adapt to system, light and dark appearance. Selection, focus, checkboxes and disclosure controls use consistent shapes and colors.
- Interface language follows Windows by default. Preferences supports English, Simplified Chinese and Traditional Chinese and retains explicit choices from earlier versions.
- Chatbox can list open documents and inspect the current page, selected bookmarks, text, objects and pages. It can read a background document by ID. Writes require a revision from that document. Progress appears above the composer.
- Tab switching reuses the existing editor. Bulk bookmark selection and change detection use indexed lookups.
- Chatbox can preview and refine raster edits, replace a selected rectangle, and embed editable SVGs or flowcharts. Optional image generation uses the configured Chatbox Image Creator provider. Document summaries return page-cited evidence and can use local text search.

### Release verification

The Windows release job passed 12 real Qwen scenarios. It checked bookmarks, cross-tab reading, scan enhancement and OCR, regional image replacement, full-resolution color adjustments and vector editing after reopening. The separate image-generation provider still requires live verification.

[User guide](https://github.com/ionize1080/Folio/blob/main/README.md) · [AI workflows](https://github.com/ionize1080/Folio/blob/main/docs/AI.en.md) · [Windows validation](https://github.com/ionize1080/Folio/releases/download/v2.1.0/Folio-PDF-Studio-2.1.0-validation.json)
