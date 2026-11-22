# Folio PDF Studio 2.8.5

[English](RELEASE-2.8.5.md) · [简体中文](RELEASE-2.8.5.zh-Hans.md) · [繁體中文](RELEASE-2.8.5.zh-Hant.md)

## Navigate by thumbnail

Press **Ctrl+T** or open **Thumbnails** in the left sidebar. Click a preview to go to its page. Use **Ctrl+wheel** over the sidebar or move the size slider to fit more columns. The main document keeps its zoom. **Select pages** opens the range picker for OCR and bookmark generation.

## Resize and change tools

The ribbon selects a desktop tab on pointer press and supports keyboard navigation. At a fixed page zoom, dragging the sidebar repositions mounted pages and reuses their canvases. Zoom anchors account for mixed page sizes, rotated pages and two-page spreads.

Both Chatbox page-image tools now describe the same crop coordinates for requests such as viewing only the top half of a page.

The Windows release workflow builds the portable ZIP once, checks that archive in six parallel jobs, and runs the public editing corpus in four shards. The validation JSON and SHA-256 manifest accompany both archives.
