"""Independent MuPDF/PDFium audit for collapsed standalone Han glyph positions.

Use assert_cjk_glyph_geometry(pdf_bytes, one_based_page) in saved-file UI checks.
This deliberately does not reject a zero-width extraction box alone: some PDF
fonts have broken advance metadata while explicit glyph origins still render
correctly. Whitespace, newlines, variation selectors and combining marks are
excluded. Identical fill/stroke overpainting of the same character is ignored.
"""
import ctypes
import math
from pathlib import Path

import fitz
import pypdfium2 as pdfium


def han(cp):
    return 0x3400 <= cp <= 0x9fff or 0xf900 <= cp <= 0xfaff or 0x20000 <= cp <= 0x323af


def record(cp, origin, box, direction):
    return dict(cp=cp, origin=tuple(origin), box=tuple(box), direction=tuple(direction),
                em=max(abs(box[2] - box[0]), abs(box[3] - box[1]), 1.0))


def overlapping_ink(a, b):
    ax0, ay0, ax1, ay1 = a['box']
    bx0, by0, bx1, by1 = b['box']
    area = min(abs((ax1 - ax0) * (ay1 - ay0)), abs((bx1 - bx0) * (by1 - by0)))
    if area <= .01:
        return 0.0
    return max(0, min(ax1, bx1) - max(ax0, bx0)) * max(0, min(ay1, by1) - max(ay0, by0)) / area


def collapsed_pairs(glyphs, focus, require_ink):
    findings = []
    for i, a in enumerate(glyphs):
        for b in glyphs[i + 1:]:
            if focus is not None and a['cp'] not in focus and b['cp'] not in focus:
                continue
            # Repeated paint of the same glyph can be intentional synthetic bold.
            if a['cp'] == b['cp']:
                continue
            ux, uy = a['direction']
            vx, vy = b['direction']
            if ux * vx + uy * vy < .99:
                continue
            em = min(a['em'], b['em'])
            if max(a['em'], b['em']) > em * 1.5:
                continue
            dx, dy = b['origin'][0] - a['origin'][0], b['origin'][1] - a['origin'][1]
            along, across = abs(dx * ux + dy * uy), abs(-dx * uy + dy * ux)
            # This is a near-total collapse, not ordinary kerning or close lines.
            if along > max(.1, em * .12) or across > max(.1, em * .10):
                continue
            overlap = overlapping_ink(a, b)
            if require_ink and overlap < .55:
                continue
            findings.append(dict(codepoints=[a['cp'], b['cp']], originDistancePoints=round(math.hypot(dx, dy), 4),
                                 inkOverlapRatio=round(overlap, 4)))
    return findings


def audit_cjk_glyph_geometry(raw, page=1, focus_chars=None):
    if isinstance(raw, (str, Path)):
        raw = Path(raw).read_bytes()
    focus = None if focus_chars is None else {ord(c) for c in focus_chars if han(ord(c))}
    mupdf = []
    with fitz.open(stream=raw, filetype='pdf') as doc:
        for trace in doc[page - 1].get_texttrace():
            if trace['type'] == 3:
                continue
            for cp, _, origin, box in trace['chars']:
                if han(cp):
                    mupdf.append(record(cp, origin, box, trace['dir']))
    pdfium_glyphs = []
    with pdfium.PdfDocument(raw) as doc:
        pdf_page = doc[page - 1]
        text = pdf_page.get_textpage()
        for i in range(text.count_chars()):
            cp = pdfium.raw.FPDFText_GetUnicode(text, i)
            if not han(cp):
                continue
            x, y = ctypes.c_double(), ctypes.c_double()
            if not pdfium.raw.FPDFText_GetCharOrigin(text, i, ctypes.byref(x), ctypes.byref(y)):
                continue
            angle = pdfium.raw.FPDFText_GetCharAngle(text, i)
            pdfium_glyphs.append(record(cp, (x.value, y.value), text.get_charbox(i), (math.cos(angle), math.sin(angle))))
        text.close()
        pdf_page.close()
    return {
        'MuPDF': dict(checkedHanGlyphs=len(mupdf), collapsedPairs=collapsed_pairs(mupdf, focus, False)),
        'PDFium': dict(checkedHanGlyphs=len(pdfium_glyphs), collapsedPairs=collapsed_pairs(pdfium_glyphs, focus, True)),
    }


def assert_cjk_glyph_geometry(raw, page=1, focus_chars=None):
    audit = audit_cjk_glyph_geometry(raw, page, focus_chars)
    bad = {engine: row['collapsedPairs'] for engine, row in audit.items() if row['collapsedPairs']}
    assert not bad, f'Collapsed standalone Han glyphs: {bad}'
    return {engine: dict(checkedHanGlyphs=row['checkedHanGlyphs'], collapsedPairCount=0) for engine, row in audit.items()}


if __name__ == '__main__':
    import argparse
    import json
    parser = argparse.ArgumentParser()
    parser.add_argument('pdf', type=Path)
    parser.add_argument('--page', type=int, default=12)
    args = parser.parse_args()
    result = audit_cjk_glyph_geometry(args.pdf, args.page)
    print(json.dumps(result, indent=2))
    raise SystemExit(1 if any(row['collapsedPairs'] for row in result.values()) else 0)
