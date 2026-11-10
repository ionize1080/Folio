## Folio PDF Studio 2.5.0

- Page image editing keeps the original image visible under the pointer. A context menu opens quick adjustments, crop or Image Studio. Studio extraction and replacement preserve rotation, mirrors, crop paths and PDF placement.
- The artwork picker shows thumbnails, page numbers and dimensions; new artwork remains available while page objects load. Both studios default to the PDF reference background and provide direct pan, fit, canvas-size and placement controls.
- Studio menus clear their active state when dismissed. Styled dropdowns, aligned controls and host UI fonts follow Folio's language and appearance. Numeric controls retain consistent digit widths.
- **Organize → Insert Blank Pages** supports matching a reference page, standard paper or custom dimensions, portrait/landscape, multiple pages and before/after placement. Outline destinations follow the assembled page order.
- **Chatbox Settings → Image Model Provider** explicitly configures Qwen Token Plan, DashScope and compatible image APIs. Save the endpoint, model and key, then test with a visible image preview. Qwen image generation and reference-image editing are tested with the real service.
- Paragraph editing inspects only the selected page, reuses bounded inspection work and prepares it when the edit command receives focus. Original font identities remain stable. Bookmark coordinate serialization noise no longer blocks document snapshots or AI page rendering.
- Keep JPEG2000 photographs visible during paragraph previews and saved-file reopening. Avoid false overflow from trailing source spaces, and distinguish numbered headings from adjacent paragraphs.
- Windows Actions builds the two Rust/WASM engines concurrently, runs 15 acceptance suites, and retests the final executable in two isolated lanes before publishing the portable ZIP, source, checksums and validation report.

See [workflow and validation details](https://github.com/ionize1080/Folio/blob/main/docs/WORKFLOW-2.5.0.md) and [the artwork guide](https://github.com/ionize1080/Folio/blob/main/docs/CREATIVE-STUDIO.md).
