# Practical PDF-XChange benchmark — 2026-11-06

The installed PDF-XChange Editor was operated through its actual Windows UI. Tests used disposable generated/public fixtures, not user documents. These are observations from exercised paths, not a claim of complete feature parity.

| Workflow | Observed in PDF-XChange | Folio implementation / verification |
|---|---|---|
| Document properties | Chromium Creator and Skia Producer were read-only; title, author, subject and keywords editable | All document-info keys including Creator/Producer editable; mapped XMP synchronized |
| Export Word | Actual four-page W3C reader PDF exported and opened in Word. Dialog offered layout/flow, language, fonts, tables, OCR, images, links and comments | Layout/flow export, source-grounded AI structure review, source coverage checks, local OCR for scans; output reopened independently |
| Export Excel | Actual controlled table exported. Regional separators, table detection and page-per-sheet options inspected. Cell containing `00123` became numeric `123` | Conservative conversion preserves `00123`, percentages and literal `=1+1` text; source tokens/coordinates retained in evidence sheet |
| PDF/A | Actual Save As PDF/A-2b with sRGB. Report showed 0 errors, 0 warnings and 17 fixes (structure tree, 15 Arial embedding fixes, metadata). Saved file entered archive mode | PDF/A-1b/2b/3b conversion followed by independent veraPDF; ordinary nonconforming fixture rejected |
| Combine files | Opened Combine Files and options. Inspected top/up/down/bottom, ranges, folders, source filename roots, retained bookmarks, form flattening, layer-name merge and named-destination conflict choices | Ordered mixed-format conversion, drag/up/down, per-file bookmark names, original outlines nested under file roots; fields namespaced to prevent collisions |

Local evidence was saved under ignored `tests/output`: `pxc-reader.docx`, `pxc-table.xlsx`, `pxc-table-pdfa.pdf`, Folio conversion outputs and machine-readable reports. UI inspection also informed categorized controls and disclosure of conversion choices. Acrobat's official combine/rearrange documentation informed sorting and bookmark organization:

- https://helpx.adobe.com/acrobat/desktop/edit-documents/combine-files/combine-files.html
- https://helpx.adobe.com/acrobat/desktop/edit-documents/combine-files/rearrange-combined-files.html

Folio deliberately distinguishes independent PDF/A/UA checks from partial PDF/X preflight. A common-rule preflight does not establish full ISO PDF/X compliance. Complex mathematical layouts, arbitrary PDFs, semantic accessibility quality, layer flattening and exact commercial parity are not certified by this sample set.
