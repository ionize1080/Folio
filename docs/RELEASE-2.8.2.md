# Folio PDF Studio 2.8.2

Fixes paragraph edits being blocked from saving with “the original bookmark source has changed” when an existing bookmark has a high-precision destination coordinate or zoom value.

The native PDF writer rounded untouched bookmark numbers while preparing edited content. It now retains their full numeric precision, including indirect values and named destinations, without changing the original reader or globally patching the PDF library. Genuine changes to bookmark sources still fail validation.

Validated locally on the reported 183-page, 33-bookmark document: append “合计付款” to the first paragraph on page 153 with source protection disabled, save, edit again, undo, redo, reopen, and save again. Five saved outputs retain every bookmark destination. MuPDF compares text and rendered pages against the edit preview, and unedited pages against the original; PDFium independently checks the edited page. The original file is unchanged.

Public CI uses a generated reproduction with the same precise destination values, never the user's PDF. It demonstrates the old rounding failure, checks repeated native rewrites and real paragraph edits, and verifies that genuine destination changes remain rejected. Release publication requires the full parallel regression suite and 34 acceptance scripts across five groups against the exact portable ZIP. Source, validation evidence and SHA-256 checksums are included.
