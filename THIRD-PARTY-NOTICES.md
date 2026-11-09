# Third-party components

## AI components in the 2.1.0 distribution

- Chatbox 1.20.3, GPL-3.0: verified native-dependency archive SHA-256 `e43647af8168b731caa9afaed269a4700f8686c257fbc4dd6a254da42729fa01`; upstream source commit `d3cd0ad1e6a1127bbbf3991bb5296c181f4cbdeb`. The portable bundle includes `resources/Chatbox/CHATBOX-LICENSE.txt`, the corresponding upstream source ZIP and `provenance.json`. Folio adaptations are supplied in `integrations/chatbox` and the exact preparation script. Upstream dependencies retain their licenses.
- PDF MCP 2.0.0, Apache-2.0, commit `9d66cca073f664a8c97d4984b5d9d61d68d4ba30`: 57 upstream tools plus five Folio additions give the file-level service 62 tools; source submodule `integrations/pdf-mcp-upstream`, LICENSE/NOTICE included under `resources/pdf-runtime/licenses/pdf-mcp`.
- Model Context Protocol TypeScript SDK 1.32.1, MIT: pinned by `integrations/chatbox/package-lock.json`. Python dependencies are pinned in `integrations/pdf-mcp-requirements.lock.txt`; their distribution metadata and licenses remain in the portable runtime.
- Tesseract OCR 5.5.3 and tessdata_fast, Apache-2.0: Windows portable binaries and English, simplified/traditional Chinese and orientation models. Model source revision and individual SHA-256 hashes are in PDF runtime provenance. Paddle remains the preferred Folio OCR engine.
- pyzbar 0.1.9, MIT, with its bundled ZBar/libiconv libraries and their included notices, supplies barcode detection.

Chatbox GPL source is compiled into hosted services and a separate renderer sharing Folio’s Electron. Its original license and corresponding upstream source, adapters and reproducible source transformations are supplied. Native model configuration is retained. No API keys or test profiles are part of the distribution.

| Component | Version | License | Included license |
|---|---|---|---|
| Electron | 44.3.0 | MIT, plus Chromium third-party licenses | Runtime LICENSE and LICENSES.chromium.html |
| Mozilla PDF.js / pdfjs-dist | 5.6.205 | Apache-2.0 | src/vendor/PDFJS-LICENSE |
| pdf-lib | 1.17.1 | MIT | src/vendor/PDF-LIB-LICENSE.md |

PDF.js CMaps, standard fonts and WASM decoders retain their bundled license files.
The PDF.js worker and pdf-lib distributions contain upstream bundled dependencies.
Original upstream distribution notices have been retained. No external fonts are
needed by the application UI; it uses Windows system fonts.

Build tools are development-only: @electron/asar 3.4.1 (MIT), resedit 2.0.3 (MIT),
pe-library (MIT), prettier 3.6.2 (MIT), and Electron's installer dependencies.
See package-lock.json for the exact dependency graph and integrity hashes.

Official project references:
- https://www.electronjs.org/docs/latest/tutorial/security
- https://github.com/mozilla/pdf.js
- https://github.com/Hopding/pdf-lib
- https://github.com/jet2jet/resedit-js

Folio does not execute external PDF actions or PDF JavaScript. Preserved actions
remain part of the original PDF and may be acted upon by other PDF readers.

## Native components in 0.3

CPython 3.12.10 (PSF), pypdfium2 5.13.0 (Apache-2.0) with PDFium and its BSD-style/component licenses, RapidOCR 3.9.2 (Apache-2.0), ONNX Runtime 1.30.0 (MIT), and their dependencies are bundled. Original package notices remain in native/licenses and runtime/Lib/site-packages. Exact wheel hashes and versions are in native/runtime-lock.json. Native dependencies include NumPy, OpenCV, Pillow, Shapely/GEOS, Pyclipper, OmegaConf, ANTLR and PyYAML.

PP-OCRv6 small, PP-OCRv5 mobile and PP-OCRv4 orientation models use the PaddleOCR/RapidOCR Apache-2.0 distribution. Upstream URLs and hashes are retained in native/models/manifest.json. ONNX Runtime telemetry is disabled before inference sessions.

Noto Sans SC / derived Folio Sans Native is licensed under SIL OFL 1.1; see native/fonts/OFL.txt and SOURCES.md. Microsoft VC x64 runtime DLLs retain Microsoft's terms in native/vcredist/LICENSE.rtf and are distributed unmodified.

PyMuPDF is used only by developer tests for independent verification; it is not included in the product runtime. Its own license applies to test users.

## Added in 0.5

- pypdf 6.10.0, BSD-3-Clause: content stream composition. License in `native/licenses/pypdf-6.10.0/LICENSE` and the bundled wheel metadata.
- OpenCC-JS 1.0.5, MIT: explicit simplified/traditional conversion. License and dictionary notices in `node_modules/opencc-js` inside app.asar, with locked npm integrity in source.
- DejaVu Sans, Bitstream Vera/DejaVu font license: fallback glyph coverage. See `native/fonts/DejaVu-LICENSE.txt`.

These additions run offline. Story/PyMuPDF is not included in the product. The simple text box uses PDFium glyph metrics and does not claim general PDF paragraph reconstruction.

## 0.7 page editor additions

- PyMuPDF 1.26.7 / MuPDF Story: **GNU AGPL v3 or later** (or a separately obtained commercial license from Artifex). This build uses the open-source AGPL distribution. Original Folio files retain their MIT notices; the combined distribution is subject to the additional AGPL obligations. Do not describe the combined 0.7 program as MIT-only. The corresponding Folio application source is delivered alongside the executable. Upstream corresponding source: https://pypi.org/project/PyMuPDF/1.26.7/#files and https://github.com/pymupdf/PyMuPDF/tree/1.26.7 ; MuPDF source/build instructions: https://mupdf.com/releases and https://github.com/ArtifexSoftware/mupdf . Full bundled license: `native/licenses/pymupdf-1.26.7.dist-info/` and the package dist-info directory in the runtime.
- RapidLayout 1.2.1 and Paddle PP-Structure PicoDet CDLA layout model: Apache 2.0. Upstream: https://github.com/RapidAI/RapidLayout and https://github.com/PaddlePaddle/PaddleOCR . Package license is retained under `native/licenses/rapid_layout-1.2.1.dist-info/`; model provenance and SHA-256 are in `native/models/manifest.json`.
- The model and both layout fonts are bundled. Runtime analysis never invokes a model downloader. ONNX Runtime telemetry is explicitly disabled before creating the layout session, as for OCR.

The legacy Chromium layout implementation remains solely for 0.6 regression fixtures. It is not the active 0.7 layout service.

## FontTools 4.61.1

FontTools is bundled as pure Python under `native/vendor/fontTools` for verified Type1 conversion, multilingual font metadata and TTC face selection. License: MIT with third-party notices; see `native/vendor/fontTools/LICENSE` and `LICENSE.external`. Original source: https://github.com/fonttools/fonttools .

The UI fallback subset `src/vendor/folio-ui.ttf` derives from the bundled Noto Sans SC variable font and follows its SIL Open Font License in `native/fonts/OFL.txt`.

## 1.1 embedded PDF decryption

- pikepdf 10.13.0.post1 (MPL-2.0), unmodified Windows CPython wheel; upstream: https://github.com/pikepdf/pikepdf . License and third-party notices are in `native/licenses/pikepdf-10.13.0.post1.dist-info/`.
- libqpdf, bundled by the pikepdf wheel (Apache-2.0); upstream source: https://github.com/qpdf/qpdf . Exact engine version is returned by the export UI and native validation report. No separate installation is required.
- lxml 6.1.3 and its bundled libxml2/libxslt: see the complete upstream notices in `native/licenses/lxml-6.1.3.dist-info/`.

All font matching runs locally on embedded and locally installed fonts. Names are display labels; recommendations use normalized outline and advance metrics. Installed fonts are not redistributed by the application.

## DOMPurify

对话框 HTML 净化使用随包 DOMPurify；版本由 package-lock.json 锁定。许可原文：`src/vendor/DOMPurify-LICENSE`（Apache-2.0 或 MPL-2.0 双许可，按组件原文适用）。

PDF MCP source extensions are supplied as `integrations/pdf-mcp-folio.patch` (batch APIs, registry, docs and regression tests) against the pinned upstream.

## 2.3 portable conversion components

These unmodified components are restored from hash-pinned official distributions by `scripts/restore-conversion.ps1`. Upstream license texts remain in their portable directories and JAR metadata. Corresponding source and build instructions are available at the linked upstream version/tag; Folio integration source is included in the companion source archive.

- Ghostscript 10.08.0: GNU AGPL-3.0-or-later. Source: https://github.com/ArtifexSoftware/ghostpdl/tree/gs10080 and https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/tag/gs10080 . The combined Folio distribution retains its existing AGPL obligations.
- LibreOffice 26.2.7: MPL-2.0 and upstream third-party licenses, preserved in `native/engines/libreoffice`. Source: https://download.documentfoundation.org/libreoffice/src/26.2.7/ ; build instructions: https://wiki.documentfoundation.org/Development/BuildingOnWindows . Administrative extraction does not install Office or change associations.
- Eclipse Temurin 21.0.13+9 JRE: GPL-2.0 with Classpath Exception and bundled third-party notices in the JRE `legal` directory. Source/release: https://github.com/adoptium/temurin21-binaries/releases/tag/jdk-21.0.13%2B9 ; OpenJDK source: https://github.com/adoptium/jdk21u/tree/jdk-21.0.13%2B9 .
- veraPDF 1.30.3: GPLv3+ / MPLv2+ dual licensing; corresponding source: https://github.com/veraPDF/veraPDF-apps/tree/v1.30.3 and https://github.com/veraPDF/veraPDF-library/tree/v1.30.3 . Dependency notices are retained inside the distributed JARs.
- pdf2docx 0.5.13 (MIT), python-docx 1.2.0 (MIT), openpyxl 3.1.5 (MIT), markdown-it-py 4.2.0 (MIT), and dependencies: exact wheels/hashes in `native/runtime-lock.json`; licenses are copied from the official wheel metadata by `scripts/stage-native.py`. PyMuPDF's AGPL notice above still applies to the conversion stack.

System fonts selected by users are not redistributed. Font embedding restrictions reported by OS/2 fsType are exposed; restricted embedding and prohibited subsetting are rejected by the engineering tool. Users remain responsible for the terms of their selected font licenses.

The conversion runtime additionally bundles FontTools 4.66.1 (MIT, with included external notices) and Brotli 1.2.0 (MIT) for font engineering and compressed font decoding. Their licenses are copied under `native/licenses` and included in the runtime distribution metadata.

## Embedded artwork engines (2.4)

PhotoCraft 0.21.0 and VectorCraft 0.22.0, copyright their contributors, are built from the exact Git commits in `integrations/creative/source-lock.json` under MIT OR Apache-2.0. Folio's source adaptations, control bridge and reference-canvas implementation are in `integrations/creative` and `scripts/patch-creative.py`. Reproduction instructions: `docs/CREATIVE-STUDIO.md`. The installed `resources/creative/{photo,vector}/licenses` directories retain upstream licenses, notices and font licenses. `build.json` records the pinned revision, adaptation fingerprint and every distributed asset hash. No third-party desktop application or second Electron runtime is included for artwork editing.
