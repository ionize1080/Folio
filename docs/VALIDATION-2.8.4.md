# Folio 2.8.4 validation

[English](VALIDATION-2.8.4.md) · [简体中文](VALIDATION-2.8.4.zh-Hans.md) · [繁體中文](VALIDATION-2.8.4.zh-Hant.md)

The Windows release workflow validates the exact Windows x64 portable ZIP and builds the source archive from the same checkout. The published validation JSON identifies the build commit, run URL and executable hashes. The [earlier Windows candidate run](https://github.com/ionize1080/Folio/actions/runs/44871390695) contains the pre-merge test results. [Windows release workflow](https://github.com/ionize1080/Folio/actions/workflows/release-284.yml) · [Validation JSON](https://github.com/ionize1080/Folio/releases/download/v2.8.4/Folio-PDF-Studio-2.8.4-validation.json)

## Paragraph editing and speed

| Sample and operation | Observed result |
| --- | --- |
| Hang Lung interim report, two tagged paragraphs | Preparing the two edit backgrounds took 0.420 s and 0.939 s, previously 1.468 s and 2.094 s on the same setup. MuPDF and PDFium matched the reference pixels. |
| 45-page traditional Chinese interim report, replace two characters on page 23 | 430 unaffected character positions and the pixels outside the edit bounds matched. All other 44 pages matched in extracted text and rendering. |
| Synology DS1621+ Chinese data sheet, edit and reopen | Replacement text remained searchable. The adjacent column, raised footnote and seven other pages matched in rendering. |
| Two-column NAACL paper, append to the abstract | In content-stream order, the reopened document differed only by the inserted `Test.`. |

The timing above measures preparation of the edit background. First entry into edit mode and applying edits with missing glyphs can take longer. This distinction matters when evaluating performance on a different PDF or machine. [Editing evidence and comparison](https://github.com/ionize1080/Folio/pull/26)

### One local editing session, from opening the file to saving

On page 23 of the 45-page Hang Lung interim report, the tester selected `該等資產` and inserted `上述資產`. The table gives the elapsed time for each action in this single local run. The first row starts when the PDF opens. The editing rows start after navigating to page 23.

| Action and endpoint | Elapsed time |
| --- | ---: |
| Open the PDF until the first page’s text layer contains text | 1.11 s |
| Enter edit mode on page 23 until the first editable region appears | 3.20 s |
| Click the paragraph until the editor is focused and ready to type | 78 ms |
| Insert the replacement into the selection | 4.1 ms |
| Click Done until the edit is applied and the paragraph editor closes | 12.85 s |
| Click Save until incremental saving completes | 3.47 s |

The background-preparation comparison above times a separate operation. This six-stage session used a local build, and the Windows release workflow reports its own results.

## Incremental saves and independent readers

| Reader or method | Test and result |
| --- | --- |
| Adobe Reader XI 11.0.10.32, 12 public PDFs | Each file opened in a fresh Windows process and reached its last page. The expected Chinese text could be copied after the first save, second save and redo. [Reader XI job](https://github.com/ionize1080/Folio/actions/runs/44870462512/job/136743594117) |
| Adobe Reader XI, seven-file error 14 comparison | Both 2.8.3 incremental saves of the cross-reference-stream fixture failed. Two direct 2.8.4 saves and two resaves of the failing legacy file opened, reached the last page and yielded the expected text. [Reproduction and recovery](https://github.com/ionize1080/Folio/actions/runs/44871005460/job/136745299657) |
| qpdf, MuPDF and PDFium, seven bookmark-only saves | qpdf checked the files. MuPDF matched text, page geometry and rendering at 0.32× across all 305 pages. PDFium matched rendering at 0.5× on 19 sampled pages. [Comparison results](https://github.com/ionize1080/Folio/pull/26) |

## Verify your download

1. Download the Windows portable ZIP or source ZIP and the SHA-256 list from the same release. [2.8.4 assets](https://github.com/ionize1080/Folio/releases/tag/v2.8.4) · [SHA-256 list](https://github.com/ionize1080/Folio/releases/download/v2.8.4/Folio-PDF-Studio-2.8.4-SHA256.txt)
2. Run `Get-FileHash -Algorithm SHA256 .\Folio-PDF-Studio-2.8.4-portable-win-x64.zip` in the download directory. For the source archive, substitute `Folio-PDF-Studio-2.8.4-source.zip`.
3. Compare the result with the line for that exact filename. The list also contains the digest of the validation JSON.

[Illustrated release notes](RELEASE-2.8.4.md) · [Validation archive](VALIDATION.md)
