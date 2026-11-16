# Screenshot provenance and reproduction

The 2.8.3 gallery contains **real Folio application captures**, taken on Windows with the release source commit `fe5b6a7b52350e908da9009142bb68129f7f09c2`. The interface is Simplified Chinese and captures use a 1440 × 960 application viewport at scale factor 1. Reduced motion is enabled so a hidden window cannot be captured halfway through a dialog animation. No interface text or recognition results are painted into the screenshots afterward.

## Public source material

- [Folio-Demo.pdf](examples/Folio-Demo.pdf): six generated pages with invented prose, bookmarks, a small table and a geometric landscape illustration.
- [Folio-Demo-Scan.pdf](examples/Folio-Demo-Scan.pdf): a rasterized page from that same generated document, initially without a text layer.
- All names, values and illustrations are created by [the fixture generator](../scripts/docs-fixtures.py). It reads no existing user PDFs or images. Metadata identifies the demo generator, not a person or local computer.
- Each capture session starts with new Folio and Chatbox profiles under ignored test output. Normal user profiles, recently opened files, API credentials and personal conversations are not copied.

## What the captures establish

The reader, rule preview, bookmark QC, organizer, font browser, export options, print preview and preferences are actual application UI. The paragraph screenshot shows a real editable paragraph. The image studio opens an embedded image from the demo PDF; the vector studio creates rectangles, gradients and text with real local studio commands. The OCR screenshot is taken only after local recognition completes with nonempty results.

The studio capture uses the existing local test bridge in an isolated profile, without sending a model request. It demonstrates the same editor controlled by `folio_studio`, not an AI conversation. The export and print screenshots show configuration/preview, not a claim that an export or print job was completed. Screenshot capture is not a replacement for [release acceptance](VALIDATION.md).

## Reproduce

Prepare the native runtime, OCR models and embedded editors as described in [Development](DEVELOPMENT.md), then run from the repository root:

```powershell
native/runtime/python.exe scripts/docs-fixtures.py
node scripts/docs-screenshots.cjs
node scripts/check-docs.mjs
```

The capture script writes to `docs/images/2.8.3/`; its temporary profiles stay under `tests/output/`. The detailed capture helper can be rerun separately with `node scripts/docs-screenshots-detail.cjs`. Regenerating screenshots may change rendering details across machines and requires another visual review and manifest refresh.

After reviewing regenerated assets, run `node scripts/check-docs.mjs --refresh-manifest`, then run the checker again without that flag. Normal validation never changes the manifest.

## Publication review

Review every full-resolution capture for readable text, settled dialogs, clipped controls and unintended content. Publish only the generated PDFs, selected PNGs, their manifest, documentation and reproducible scripts. Do not stage test outputs, profiles, downloaded customer documents, logs or arbitrary screenshots. The [asset manifest](images/2.8.3/manifest.json) records repository-relative filenames, dimensions and SHA-256 hashes; it contains no machine-specific paths.

[English tour](FEATURES.md) · [简体中文图解](FEATURES.zh-Hans.md) · [繁體中文圖解](FEATURES.zh-Hant.md)
