"""Independent PDF style audit for retained characters in a UI-edited paragraph.

Reads the saved PDF with MuPDF and fontTools, never the editor's/native inspect
style model. New/deleted characters are excluded. Ambiguous font resources are
reported as unavailable for outline comparison rather than guessed.
"""
import hashlib
import io
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path

import fitz

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "native/vendor"))
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.ttLib import TTFont


def compact(text):
    return "".join(ch for ch in text if not ch.isspace())


def font_name(name):
    return re.sub(r"[^a-z0-9]", "", re.sub(r"^[A-Z]{6}\+", "", name).lower())


def glyph_signature(font, gid):
    order = font.getGlyphOrder()
    if not 0 <= gid < len(order):
        return None
    glyphs = font.getGlyphSet()
    pen = DecomposingRecordingPen(glyphs)
    glyphs[order[gid]].draw(pen)
    upem = font["head"].unitsPerEm

    def normalized(value):
        if isinstance(value, (int, float)):
            return round(value / upem, 5)
        if isinstance(value, (list, tuple)):
            return tuple(normalized(v) for v in value)
        return value

    return hashlib.sha256(repr(normalized(pen.value)).encode()).hexdigest()


class PDFStyles:
    def __init__(self, raw, page):
        self.doc = (
            fitz.open(stream=raw, filetype="pdf")
            if isinstance(raw, (bytes, bytearray))
            else fitz.open(raw)
        )
        self.page = self.doc[page - 1]
        self.fonts = {}
        self.by_name = {}
        self.signatures = {}
        for resource in self.page.get_fonts(full=True):
            xref = resource[0]
            try:
                extracted, _, _, blob = self.doc.extract_font(xref)
                if not blob:
                    continue
                key = hashlib.sha256(blob).hexdigest()
                if key not in self.fonts:
                    self.fonts[key] = TTFont(io.BytesIO(blob), lazy=True)
                face = self.fonts[key]
                names = [resource[3], extracted]
                if "name" in face:
                    names += [face["name"].getDebugName(n) or "" for n in (4, 6)]
                for name in names:
                    if name:
                        self.by_name.setdefault(font_name(name), set()).add(key)
            except Exception:
                # Unsupported CFF containers and ambiguous aliases are not
                # evidence of an outline match.
                continue
        traces = {}
        for span in self.page.get_texttrace():
            if span["type"] not in (0, 1):
                continue
            for codepoint, gid, origin, _ in span["chars"]:
                if codepoint < 0:
                    continue
                anchor = (chr(codepoint), round(origin[0], 4), round(origin[1], 4))
                traces.setdefault(anchor, []).append((span["font"], gid, span["type"]))
        self.characters = []
        for block in self.page.get_text("rawdict")["blocks"]:
            if block.get("type") != 0:
                continue
            for line in block["lines"]:
                for span in line["spans"]:
                    for char in span["chars"]:
                        for scalar in char["c"]:
                            if scalar.isspace():
                                continue
                            anchor = (scalar, round(char["origin"][0], 4), round(char["origin"][1], 4))
                            evidence = traces.get(anchor, [])
                            sources = {(font_name(name), gid) for name, gid, _ in evidence}
                            self.characters.append({
                                "text": scalar,
                                "bold": bool(span["flags"] & 16) or any(t == 1 for _, _, t in evidence),
                                "italic": bool(span["flags"] & 2),
                                "size": span["size"],
                                "outlineSource": next(iter(sources)) if len(sources) == 1 else None,
                            })

    def paragraph(self, text):
        expected = compact(text)
        if not expected:
            raise AssertionError("Cannot audit an empty paragraph")
        page_text = "".join(c["text"] for c in self.characters)
        matches = [m.start() for m in re.finditer(re.escape(expected), page_text)]
        if len(matches) != 1:
            raise AssertionError("Edited paragraph must have exactly one PDF text match")
        return self.characters[matches[0]:matches[0] + len(expected)]

    def outline(self, character):
        source = character["outlineSource"]
        if source is None:
            return None
        name, gid = source
        matches = self.by_name.get(name, set())
        if len(matches) != 1:
            return None
        key = next(iter(matches))
        cache_key = (key, gid)
        if cache_key not in self.signatures:
            try:
                self.signatures[cache_key] = glyph_signature(self.fonts[key], gid)
            except Exception:
                self.signatures[cache_key] = None
        return self.signatures[cache_key]

    def close(self):
        for font in self.fonts.values():
            font.close()
        self.doc.close()


def audit_retained_styles(original, edited, page, old_text, new_text):
    """Return numeric checks only; neither PDF text nor local paths are included."""
    before = PDFStyles(original, page)
    after = PDFStyles(edited, page)
    try:
        old = before.paragraph(old_text)
        new = after.paragraph(new_text)
        result = {
            "retainedCharacters": 0,
            "boldCharacters": 0,
            "italicCharacters": 0,
            "boldDifferences": 0,
            "italicDifferences": 0,
            "sizeDifferences": 0,
            "outlineCharacters": 0,
            "outlineUnavailableCharacters": 0,
            "outlineDifferences": 0,
        }
        matcher = SequenceMatcher(None, compact(old_text), compact(new_text), autojunk=False)
        for start, end, count in matcher.get_matching_blocks():
            for offset in range(count):
                left, right = old[start + offset], new[end + offset]
                result["retainedCharacters"] += 1
                result["boldCharacters"] += left["bold"]
                result["italicCharacters"] += left["italic"]
                result["boldDifferences"] += left["bold"] != right["bold"]
                result["italicDifferences"] += left["italic"] != right["italic"]
                result["sizeDifferences"] += abs(left["size"] - right["size"]) > 0.02
                first, second = before.outline(left), after.outline(right)
                if first is None or second is None:
                    result["outlineUnavailableCharacters"] += 1
                else:
                    result["outlineCharacters"] += 1
                    result["outlineDifferences"] += first != second
        return result
    finally:
        before.close()
        after.close()


def assert_retained_styles(original, edited, page, old_text, new_text):
    result = audit_retained_styles(original, edited, page, old_text, new_text)
    assert result["retainedCharacters"] > 0, "No retained paragraph characters checked"
    assert not any(result[k] for k in (
        "boldDifferences", "italicDifferences", "sizeDifferences", "outlineDifferences"
    )), result
    return result
