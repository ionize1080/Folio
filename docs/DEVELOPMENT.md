# Build and test Folio 2.1.0

Use Windows x64, Git, Node.js 24, Python 3.12 and a full 7-Zip installation with NSIS extraction support. These steps use the repository checkout, including its Git submodule metadata. The release job checks out the PDF MCP submodule, verifies native models, compiles the pinned Chatbox community source and packages the resulting runtime. End users can run the portable ZIP directly. [Windows release workflow](../.github/workflows/release-210.yml)

## From a clean checkout

```powershell
git clone --recurse-submodules https://github.com/ionize1080/Folio.git
cd Folio
git checkout v2.1.0
git submodule update --init --recursive
npm ci
python -m pip install PyMuPDF==1.26.6 pypdf==6.10.0 pypdfium2==5.13.0 pikepdf==10.13.0.post1 fonttools==4.61.1 Pillow numpy
python -m pip install --target native/vendor fonttools==4.61.1
python scripts/restore-assets.py
```

For a clean build, copy the installed fontTools license into the vendored package as the workflow does. Then run the preparer with 7-Zip available. It verifies the official Chatbox distribution, builds the pinned source and prepares the PDF MCP environment. The Chatbox sub-build selects the Node and pnpm versions specified in its pin. [Chatbox source pin](../integrations/chatbox/upstream.json) · [Runtime preparation](../scripts/prepare-ai-ci.py)

```powershell
$license = Get-ChildItem native/vendor/fonttools-4.61.1.dist-info -Recurse -File -Filter LICENSE | Select-Object -First 1
Copy-Item -LiteralPath $license.FullName -Destination native/vendor/fontTools/LICENSE
python scripts/prepare-ai-ci.py
npm start
```

## Choose the right test

| Test | What it establishes |
| --- | --- |
| `npm run test:quick` | Unit contracts, source-archive and release-transport checks |
| `node scripts/acceptance.mjs native` | PDF editing, font and geometry preservation with independent PDF engines |
| `npm run test:full` | Quick, native and browser acceptance. Install the browser test dependencies from `tests/requirements.txt` and a Playwright-compatible Chromium first. |
| `node tests/chrome-202.cjs` and `node tests/ai-hosted.cjs` | Control layout across languages and appearances, Chatbox drafts, progress and overlays |
| `node tests/ai-live-202.cjs` | Real Qwen requests through hosted Chatbox and MCP, including the cases imported from `tests/ai-live-workflows.cjs` |
| `node tests/workspace-210.cjs` | Multi-select open, tab switching, dirty close/cancel, shared preferences and reopening after the last close |
| `npm run build:win` then `npm run test:package` | Portable application and packaged-resource checks |

Before running desktop or live tests, create the fixtures in the **Restore pinned models and acceptance fixtures** step, including `tests/output/modes.pdf`, `python tests/ai-fixtures.py` and `python tests/ai-public-fixtures.py`. The public sample is NIST FIPS 197. The latter script verifies its source hash and creates a faded scan, replacement patch and full-resolution color target.

For live acceptance, supply `FOLIO_QWEN_API_KEY` and `FOLIO_QWEN_API_URL` through your test environment or CI secrets. `FOLIO_QWEN_MODEL` optionally selects the model. Test profiles are separate from regular editing sessions. For the packaged workspace test, set `FOLIO_EXE` to the absolute path of the newly built `dist/Folio-PDF-Studio-win-x64/Folio.exe`.

Folio stores Chatbox settings and conversations under `%APPDATA%/Folio/Chatbox`. On first migration the integration can copy data from the earlier versioned profile. Live release tests use their own profiles and test credentials.

## Release verification

The Windows job also runs upstream MCP regression tests, starts the packaged application and Chatbox, checks the updater, creates the portable and source ZIPs, and installs from the exact portable ZIP. The publisher checks the reports, verifies the executable and application archive against the ZIP and uploads the validation JSON and SHA-256 list. The published 2.1.0 build is commit `12eb72559979ed87e04a89e7b7bbedae92462206`. [Successful release job](https://github.com/ionize1080/Folio/actions/runs/41994404438) · [Published artifacts](https://github.com/ionize1080/Folio/releases/tag/v2.1.0)
