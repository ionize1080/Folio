# Folio PDF Studio 2.0.2

- Build pinned Chatbox source and share Folio’s Electron, removing the duplicated runtime.
- Remove empty Folio Qwen presets; preserve real provider settings and chats in a stable user profile across upgrades.
- Show local progress without extra model tokens; fix menus/save dialogs covered by AI and approval state after chat reload.
- Preserve input drafts during rapid window changes and immediate reloads, including clearing a draft.
- Prefer direct local calibration, margins, partial bookmark edits and TOC recognition; review ambiguous evidence only. Add explicit image coordinate guidance, OCR/snapshot caching and bounded text/object results.
- Extend upstream PDF MCP source with single-open batch reads and atomic batch edits: 62 file tools, new-file output, rollback on failure and source-hash checks.
- Refine toolbar alignment, icon proportions, neutral selected states and keyboard menus across three languages and both themes. AI stays neutral; only automatic approval is red.

Local acceptance includes real Qwen, native mouse/keyboard interaction and 10 real PDF samples. Windows Actions rebuilds from source and requires regression, real API, portable package and updater checks before publishing. Validation reports and checksums are included. Windows 10 21H1 has not been separately verified.

Settings live at `%APPDATA%/Folio/Chatbox`. First upgrade copies the old versioned profile and retains it for rollback.
