# Folio PDF Studio 1.7.3

This release improves automatic contents recognition for textbooks, technical manuals and statistical yearbooks.

- Smart contents recognition is directly accessible from the main toolbar. Contents OCR and the slower body-page OCR have separate visible switches.
- Read two-column contents in column order; carry hierarchy across continuation pages; recognize textbook units, lessons and nested works, and preserve numbered manual chapters.
- Preserve unnumbered section headings and entries whose scanned page numbers were missed. These remain reviewable rather than silently disappearing.
- Retry the folio margin at higher resolution when dense scanned contents lose small page numbers. Keep OCR confidence and manual review requirements.
- Match textbook headings despite lesson numbers, decorative marks and author credits. Prefer exact numbered titles and avoid treating table cells or organization credits as high-confidence headings.
- Use font-family evidence for unindented yearbook hierarchy. Unchecked parents no longer attach selected children to an unrelated preceding chapter.
- Cache normalized body text to reduce repeated matching work.

Validated on a private local corpus of three Chinese textbooks, two technical manuals and four yearbooks, plus automated regression, browser and packaged native OCR tests. The validation attachment records the exact tested application hashes. Third-party sample PDFs are not included.

Recognition is not a guarantee of a complete outline. Repeated headings, poor scans, bilingual rows and complex yearbook hierarchy still require review. Full-body OCR is optional and can be slow; narrow its page range first. Original bookmark trees were used only as an independent evaluation reference, not as algorithm input.

Download the portable Windows x64 archive, extract the entire folder and run Folio.exe. English, Simplified Chinese and Traditional Chinese interfaces are included.
