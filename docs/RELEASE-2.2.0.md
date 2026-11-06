## Folio PDF Studio 2.2.0

The built-in Chatbox can generate images concurrently, insert them into PDFs and edit existing images. Image service settings support custom endpoints, API keys, model names and OpenAI-compatible or Qwen native protocols. Explicit keys use Windows protected storage.

- Move, resize, rotate, crop, recolor, change opacity and blend modes, or delete images, including existing inline images. Move selected images between pages.
- Create and edit SVG lines and native PDF linear/radial gradients, including transparency. Reopen the saved PDF to continue editing or delete inserted graphics.
- Merge PDFs in a chosen order, or split by page counts/ranges, preserving bookmarks and current unsaved changes.
- Resize the Chatbox sidebar by dragging its edge. Tool workflows have more steps, and interrupted or truncated responses display an explanation. Temporary OCR and assembly documents are released after use.

Verification includes automated graphics/native tests, real concurrent Qwen Image requests from Chatbox, independent inspection of the saved PDF, packaged application tests and updater validation. See the release validation JSON for this build's evidence.

Complex clipped/nested content can remain protected; SVG support is a validated subset. This release does not claim complete PDF-XChange parity. [Scope and comparison](https://github.com/ionize1080/Folio/blob/main/docs/GRAPHICS-2.2.0.md).
