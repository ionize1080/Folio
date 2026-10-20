"""Preserve TrueType advances through PDF subsetting and subsequent editing."""
import math
import struct
import unicodedata

from font_sfnt import tables, build, MAGIC


def metrics(parts):
    count = struct.unpack_from('>H', parts[b'maxp'], 4)[0]
    number = struct.unpack_from('>H', parts[b'hhea'], 34)[0]
    raw = parts[b'hmtx']
    if not 1 <= number <= count or len(raw) < number * 4 + (count - number) * 2:
        raise ValueError('字体字宽数量不一致')
    full = [struct.unpack_from('>Hh', raw, i * 4) for i in range(number)]
    full.extend((full[-1][0], struct.unpack_from('>h', raw, number * 4 + i * 2)[0])
                for i in range(count - number))
    return full


def write_metrics(blob, parts, full):
    parts[b'hmtx'] = b''.join(struct.pack('>Hh', *pair) for pair in full)
    parts[b'hhea'] = parts[b'hhea'][:34] + struct.pack('>H', len(full)) + parts[b'hhea'][36:]
    return build(blob[:4], parts)


def expanded_metrics(blob):
    """Equivalent full hmtx avoids MuPDF clearing shared trailing advances.

    Its native subsetter empties unused glyph metrics. With compressed hmtx it
    can clear the last explicit advance even when later retained glyphs share
    it. Expand the representation before subsetting; every original advance,
    side bearing, glyph index, outline and hint remains unchanged.
    """
    if blob[:4] not in MAGIC:
        return blob
    parts = tables(blob)
    if b'glyf' not in parts:
        return blob
    if struct.unpack_from('>H', parts[b'hhea'], 34)[0] == struct.unpack_from('>H', parts[b'maxp'], 4)[0]:
        return blob
    return write_metrics(blob, parts, metrics(parts))


def subset_fonts(doc):
    """Use the fast native subsetter after making its metric input lossless."""
    seen = set()
    for xref in range(1, doc.xref_length()):
        kind, value = doc.xref_get_key(xref, 'FontFile2')
        if kind != 'xref':
            continue
        ref = int(value.split()[0])
        if ref in seen:
            continue
        seen.add(ref)
        blob = doc.xref_stream(ref)
        fixed = expanded_metrics(blob)
        if fixed != blob:
            # This full font is immediately subsetted. Deflating its megabytes
            # first adds avoidable latency; the final PDF writer compresses the
            # much smaller subset normally.
            doc.update_stream(ref, fixed, compress=False)
            doc.xref_set_key(ref, 'Length1', str(len(fixed)))
    doc.subset_fonts()


def cid_widths(cid):
    """Decode bounded PDF horizontal CID widths, including both /W forms."""
    default = float(cid.get('/DW', 1000))
    if not math.isfinite(default):
        raise ValueError('PDF 默认字宽无效')
    raw = cid.get('/W', [])
    raw = raw.get_object() if hasattr(raw, 'get_object') else raw
    if not isinstance(raw, (list, tuple)) or len(raw) > 3 * 65536:
        raise ValueError('PDF CID 字宽表过大或无效')
    def integer(value):
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError('PDF CID 必须是整数')
        return value
    widths = {}
    i = 0; budget = 0
    while i < len(raw):
        first = integer(raw[i]); value = raw[i + 1]; i += 2
        value = value.get_object() if hasattr(value, 'get_object') else value
        if isinstance(value, (list, tuple)):
            values = value
        else:
            last = integer(value)
            if not 0 <= first <= last <= 65535:
                raise ValueError('PDF CID 字宽范围无效')
            values = [raw[i]] * (last - first + 1); i += 1
        if not 0 <= first <= first + len(values) - 1 <= 65535:
            raise ValueError('PDF CID 字宽范围无效')
        budget += len(values)
        if budget > 65536:
            raise ValueError('PDF CID 字宽表重复范围过多')
        for offset, width in enumerate(values):
            width = float(width); code = first + offset
            if not math.isfinite(width) or code in widths and widths[code] != width:
                raise ValueError('PDF CID 字宽不一致')
            widths[code] = width
    return default, widths


def restore_cid_advances(blob, cid, mapping, gid_map=None):
    """Recover only unusable zero widths from authoritative PDF CID metrics.

    This repairs PDFs already emitted by the affected subsetter. No width is
    inferred from a name, bounding box or another installed font. Positive
    embedded advances and zero-width combining/control/space glyphs are kept.
    Conflicting CID widths for one GID cannot be represented by one hmtx entry
    and remain unavailable to editing instead of being guessed.
    """
    if blob[:4] not in MAGIC:
        return blob
    parts = tables(blob)
    if b'glyf' not in parts:
        return blob
    full = metrics(parts)
    wanted = {gid for cp, gid in mapping.items() if 0 < gid < len(full)
              and not full[gid][0] and unicodedata.category(chr(cp))[0] not in ('M', 'Z', 'C')}
    if not wanted:
        return blob
    default, widths = cid_widths(cid)
    candidates = {gid: set() for gid in wanted}
    if gid_map is None:
        for gid in wanted:
            candidates[gid].add(widths.get(gid, default))
    else:
        if len(gid_map) % 2 or len(gid_map) > 131072:
            raise ValueError('PDF CID 字形映射无效')
        for code in range(len(gid_map) // 2):
            gid = int.from_bytes(gid_map[2 * code:2 * code + 2], 'big')
            if gid in candidates:
                candidates[gid].add(widths.get(code, default))
    units = struct.unpack_from('>H', parts[b'head'], 18)[0]
    changed = False
    for gid, values in candidates.items():
        if len(values) != 1:
            continue
        advance = values.pop() * units / 1000
        # A PDF float must represent an integral TrueType design unit. Avoid
        # silently rounding unrelated/ambiguous PDF-only spacing into a font.
        if not 0 < advance <= 65535 or abs(advance - round(advance)) > .001:
            continue
        full[gid] = (round(advance), full[gid][1]); changed = True
    return write_metrics(blob, parts, full) if changed else blob
