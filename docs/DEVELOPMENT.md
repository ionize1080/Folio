# Build and test Folio 2.8.3

Use Windows x64, Node.js 24, Python 3.12, Git and a full 7-Zip installation with NSIS support. Building both embedded studios also requires Rust 1.95 with `wasm32-unknown-unknown`. End users only need the complete portable ZIP. The authoritative setup is the [workbench action](../.github/actions/setup-workbench/action.yml); publication is defined by [release-283.yml](../.github/workflows/release-283.yml).

## Checkout and native dependencies

```powershell
git clone --recurse-submodules https://github.com/ionize1080/Folio.git
cd Folio
git checkout v2.8.3
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

Use a current `main` checkout for documentation capture; these scripts were added after the 2.8.3 release tag. Run `native/runtime/python.exe scripts/docs-fixtures.py`, then `node scripts/docs-screenshots.cjs` from the repository root with the native and studio dependencies prepared. Review every output before publishing. [Provenance and review rules](SCREENSHOTS.md). The capture task does not invoke a model provider.

## Release evidence

The published 2.8.3 binary is bound to commit `fe5b6a7b52350e908da9009142bb68129f7f09c2` and [Windows run 43830775610](https://github.com/ionize1080/Folio/actions/runs/43830775610). The exact portable ZIP passed 38 acceptance scripts across six packaged jobs, followed by release verification. [Validation report and checksums](https://github.com/ionize1080/Folio/releases/tag/v2.8.3) · [CI architecture](ci-architecture.md).

Documentation changes after that release do not rebuild or recertify its binary. For a new release, use evidence from the same source commit, run and final archive; never relabel older results.
