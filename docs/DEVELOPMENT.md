# Build and test Folio 2.8.4

Use Windows x64, Node.js 24, Python 3.12, Git and a full 7-Zip installation with NSIS support. Building both embedded studios also requires Rust 1.95 with `wasm32-unknown-unknown`. End users only need the complete portable ZIP. The [workbench action](../.github/actions/setup-workbench/action.yml) pins setup. The [2.8.4 release workflow](../.github/workflows/release-284.yml) invokes the [shared acceptance workflow](../.github/workflows/release-283.yml) before publishing.

## Checkout and native dependencies

```powershell
git clone --recurse-submodules https://github.com/ionize1080/Folio.git
cd Folio
git checkout v2.8.4
git submodule update --init --recursive
npm ci
python scripts/restore-conversion-python.py
$env:FOLIO_PYTHON = "$PWD/native/runtime/python.exe"
$env:PYTHONUTF8 = "1"
./scripts/restore-conversion.ps1
python scripts/restore-assets.py
```

The Python runtime is restored from [runtime-lock.json](../native/runtime-lock.json); OCR models use the pinned manifest. Conversion restoration supplies the separate Office-to-PDF and conformance engines. Word/Excel export uses the bundled Python libraries locally. Do not substitute unpinned native packages into a release build.

For the development test interpreter, follow the exact additional pip and vendored-fontTools steps in the workbench action. The test interpreter and bundled product runtime serve different purposes; installing test dependencies does not update the packaged runtime lock.

## Chatbox and embedded editors

```powershell
python scripts/prepare-ai-ci.py
python scripts/build-creative.py photo
python scripts/build-creative.py vector
python scripts/verify-creative.py
npm start
```

The Chatbox preparer verifies the [source pin](../integrations/chatbox/upstream.json) and builds its renderer and services with the pin's toolchain. Creative builders use the [source lock](../integrations/creative/source-lock.json) and select wasm-bindgen from each Cargo.lock. Follow [the studio build guide](CREATIVE-STUDIO.md) for source and output details. Allow the initial downloads and builds to finish before testing the corresponding feature.

## Choose the relevant validation

| Command | Scope |
| --- | --- |
| `node --test tests/incremental-compatibility.test.mjs tests/tagged-paragraph-284.test.mjs` | Cross-reference chains, identifiers, linearized trailers and measured paragraph widths around raised footnotes |
| `python tests/tagged-paragraph-284.py` | Tagged paragraph owners and inline boundaries |
| `python tests/shared-line-site-284.py` | Inherited PDF text state when adjacent lines share a text object |
| `python tests/story-aliases-284.py` | Exact punctuation when a font has multiple Unicode mappings |
| `node tests/ui-polish-284.cjs` | Command palette, search results, reading tones and the OCR and bookmark workbenches |
| `npm run test:quick` | Unit contracts, source archive and release transport |
| `node scripts/acceptance.mjs native` | Native PDF, font, geometry and save regressions |
| `npm run test:full` | Quick, native and browser suites; needs the test dependencies and compatible Chromium |
| `node tests/preferences-ui-283.cjs` | Preference controls, validation and themes |
| `node tests/surfaces-ui-283.cjs` | Current workbenches and compact windows |
| `node tests/reader-ui-283.cjs` | Reading controls and immediate bookmark target markers |
| `node tests/performance-ui-283.cjs` | Bounded performance observations and redundant refresh checks |
| `npm run build:win` then `npm run test:package` | Package preparation and resource validation |

Generate fixtures using the workbench action's fixture step and any inputs named by the selected test. Use `FOLIO_TEST_PROFILE` and `FOLIO_CHATBOX_PROFILE` for isolated desktop profiles. Set `FOLIO_EXE` to an absolute packaged executable for packaged tests. For real-provider acceptance, supply `FOLIO_QWEN_API_KEY` and `FOLIO_QWEN_API_URL` via the environment; never commit them or copy the user's normal Chatbox profile. Some scripts also accept `FOLIO_QWEN_MODEL`.

## Documentation screenshots

[Screenshot provenance](SCREENSHOTS.md) identifies the source version, demo document and capture method for each gallery. The 2.8.4 UI smoke test opens the [generated PDF](examples/Folio-Demo.pdf) and captures the command palette, reading tones, search and workbenches as it tests their controls. The 2.8.3 gallery is reproducible with `native/runtime/python.exe scripts/docs-fixtures.py` and `node scripts/docs-screenshots.cjs` after preparing the native and studio dependencies. Use isolated profiles and inspect captures for private information before publishing.

## Release evidence

The 2.8.4 [main release runs](https://github.com/ionize1080/Folio/actions/workflows/release-284.yml?query=branch%3Amain) bind source acceptance, the six packaged test groups and the actual ZIP update test to a single source revision. The [release](https://github.com/ionize1080/Folio/releases/tag/v2.8.4) provides the Windows portable ZIP, source ZIP, SHA-256 list and validation JSON. Use the JSON’s `sourceCommit` and `windowsActionsRun` to locate the exact build. The documentation on `main` can advance after a release. [CI architecture](ci-architecture.md) · [Validation](VALIDATION.md)
