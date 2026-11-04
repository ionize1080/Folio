# Folio 2.0.0 — Chatbox and PDF AI

Folio now includes Chatbox 1.20.3 as a sidebar with an optional separate window. The main toolbar has one AI button with a distinct chat icon; click it again to collapse the sidebar. The properties button restores the properties panel. OCR confidence, approval and display settings are grouped under Preferences → AI document assistance. API keys, providers and model selection use native Chatbox settings. The initial model is qwen3.8-flash; no API key is included.

## Capabilities

- Four on-demand MCP entry points expose 23 Folio document/bookmark operations and 60 PDF tools. The complete pinned Apache-2.0 PDF MCP registry is included, plus 29 low-level PDF object operations and local Paddle OCR. Read full schemas with help before calling an operation.
- Full bookmark tree reads/replacement, creation, deletion, subtree moves/copies, hierarchy and target changes, regex generation/splitting, whitespace and calibration reuse Folio's editing engines. Current-document writes check revisions and support undo.
- Local Paddle OCR runs first. The confidence threshold defaults to 95% and is adjustable. Selected low-confidence content, complex pages, TOCs, page numbers and title locations can use the selected vision model. Purpose-aware rendering sends whole pages or cropped regions at suitable resolutions, with explicit pixel-to-PDF coordinate transforms.
- Manual approval is the default on every launch. Automatic approval requires two confirmations and turns the Folio AI and Chatbox approval icons red. Chatbox provides quick approval and docking controls aligned with its native input toolbar.
- MCP uses stdio; the application bridge uses an authenticated Windows named pipe. The packaged application does not open a TCP listening port. PDF tools cannot make network connections; external model assistance uses Chatbox. Provider SDK headers pass through Node fetch unchanged, without Electron request headers. Chatbox's own updater and reporting are disabled.
- Managed disk caches default to 2048 MB (2 GB), adjustable in Preferences. Active sources, snapshots and atomic writes are protected and temporarily raise the effective budget for large tasks. Releasable caches rotate afterwards. User files, chat history, bundled models and unsaved recovery drafts are protected data, not disposable caches.

## Validation on Windows x64

- 268 unit checks and 7 source/archive/transport checks passed. Existing native editing and browser acceptance suites passed.
- Upstream PDF MCP: 277 passed, 2 skipped, 1 deselected (a platform-specific working-directory assertion). This is not a claim that every upstream function was exercised with a real-world document.
- All 31 PDFs in the local sample corpus passed portable stdio document information, full outline, page rendering and text-block reads. The largest sample was 712,285,016 bytes / 806 pages; its page 12 also passed local Paddle OCR (119 blocks, 27 below the 95% threshold). Original documents were not changed.
- Ten selected real documents passed Folio operation workflows. Local OCR was also checked on Newsweek, a Chinese energy yearbook and a BRICS document.
- Five real qwen3.8-flash workflows ran through the actual Chatbox provider and Folio MCP: Chinese textbook TOC-to-parent/child bookmarks, bank-standard TOC/target/5 mm spacing, English report TOC/title positioning, scanned Newsweek OCR/crop review, and financial report whole-page/crop visual number checks.
- Saved PDFs were independently reopened: all five destination pages matched; the textbook hierarchy matched; three explicit XYZ title destinations had vertical error below 4 pt against extracted title bounds, including the requested margin. This is a small acceptance sample, not a general accuracy guarantee.
- Native provider request headers contained the Chatbox AI SDK identifiers and Bearer authorization, with no Electron user agent. Page images were sent as vision attachments, not Base64 tool text.
- The portable package started Chatbox and all 60 PDF tools, rendered a PDF without an external Python installation, used the 2 GB default and had zero TCP listeners. Production ignored the development debugging-port environment switch.
- Settings tests covered English, Simplified Chinese and Traditional Chinese, light/dark themes, supported narrow/wide layouts, persisted OCR/cache values, session-only approval and double confirmation. Desktop inspection verified high-DPI sidebar placement and settings-dialog visibility.

## Limits and redistribution

AI may misread page labels, small numbers, unusual fonts or complex layouts. Review generated bookmarks and destinations. An OCR confidence score is not an accuracy guarantee; model corrections do not overwrite the original confidence score. Full-document editing/reflow limitations from 1.9.1 still apply.

PDF MCP file operations are separate from the live editor: save pending changes or use a snapshot, request a new output path and reopen the result. Large-file workspaces use file-based PDF tools and must save pending bookmark edits before sharing their path. Remote PDF-MCP LLM backends and remote timestamp requests are disabled; use Chatbox for external assistance.

The package includes the original Chatbox GPL-3.0 license, pinned upstream source ZIP and patch hashes, PDF MCP Apache-2.0 notices and other component licenses. The source attachment includes Folio adapters, the pinned PDF MCP source and Chatbox source ZIP. Rebuilding the AI runtime requires the official Chatbox installer and the documented preparation steps. Test keys, profiles, private documents, extracted text, chats and rendered test pages are excluded.

Extract the entire portable ZIP and run Folio.exe. Do not copy the executable alone. The SHA256 attachment covers the downloads; the validation attachment records the source commit and tested application hashes. See [the AI guide](AI.md) for setup, operation examples and build instructions.
