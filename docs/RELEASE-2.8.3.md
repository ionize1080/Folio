# Folio PDF Studio 2.8.3

Fixes preferences that appeared not to select when clicked. The checked state was changing, but a generic focus style covered the checkbox background and hid its white checkmark. Mouse, label and Space-key interaction now keep the selected state visible in light and dark themes. OCR and reader checkboxes also retain their intended square size.

Preferences now validate required numeric values, ranges and integers before applying, prevent duplicate submissions, and avoid refreshing the PDF or rewriting device settings when nothing changed. Bookmark target markers respond immediately to visibility and color changes. Smaller windows have more usable preferences, OCR and rule-editor layouts; search closes with Escape and restores focus.

Local validation covered all seven preference categories, ten checkboxes, 23 dropdown choices, twelve theme/palette combinations, 58 panel states, nine zoom choices and five reader layouts. Performance checks exercise 10,000 bookmarks, 24 ribbon switches, scrolling, zooming and repeated dialog cycles. Unchanged preferences cause zero PDF refreshes; timings are recorded as observations rather than universal speed guarantees. Initial dialog and editing setup can still produce brief long tasks. See the [detailed audit](UI-AUDIT-2026-11-16.zh-Hans.md) for scope and limits.

GitHub Actions rebuilds the complete Windows package and runs the existing native, editing, save-integrity, AI and updater gates alongside the new UI checks. The exact portable ZIP must pass 38 acceptance scripts across six parallel jobs before publication. Release attachments include the source archive, commit-bound validation evidence and SHA-256 checksums. CI uses generated or public fixtures; private user documents are not uploaded.
