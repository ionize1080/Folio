# Embedded editing engines

Folio builds PhotoCraft 0.21.0 and VectorCraft 0.22.0 from the immutable revisions in `source-lock.json`. Both are copyright their respective contributors and licensed under MIT OR Apache-2.0. Copies of LICENSE-MIT, LICENSE-APACHE, NOTICE and asset attribution accompany each embedded build. The page API in `photo-api.rs` is adapted from VectorCraft's `apps/vectorcraft-web/src/api.rs` at the pinned revision.

Folio additions expose PhotoCraft's existing control channel in WebAssembly, retain imports and exports in the embedding page, add export without altering the document save target, and expose the actual canvas rectangle. The engines run inside the Folio document workspace and share their live document with manual controls and MCP. No companion desktop editor is launched.

The original project icons and trademarks are not used as Folio branding. The embedded host uses Folio's own UI and loading page. Engine credits remain available with these notices.
