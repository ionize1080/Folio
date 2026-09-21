"""Bounded sfnt normalization without rewriting glyph outlines or hint programs.

PDF embedded programs need not have the tables required by a browser font.
Keep PDF character/CID/GID maps separate from the Unicode cmap built for editing.
"""
import math
import struct

MAGIC = (b'\0\1\0\0', b'OTTO', b'true')

def checksum(data):
    data += b'\0' * (-len(data) % 4)
    return sum(struct.unpack('>%dI' % (len(data) // 4), data)) & 0xffffffff

def tables(blob):
    if len(blob) < 12 or blob[:4] not in MAGIC:
        raise ValueError('字体不是有效的 OpenType/TrueType 数据')
    n = struct.unpack_from('>H', blob, 4)[0]
    if not 1 <= n <= 256 or 12 + 16*n > len(blob):
        raise ValueError('字体表目录不完整')
    out = {}
    for i in range(n):
        tag, _, offset, length = struct.unpack_from('>4sIII', blob, 12+16*i)
        if tag in out or offset < 12+16*n or offset+length > len(blob):
            raise ValueError('字体表范围无效')
        out[tag] = blob[offset:offset+length]
    return out

def build(version, parts):
    parts = dict(parts)
    if b'head' not in parts or len(parts[b'head']) < 54:
        raise ValueError('字体 head 表无效')
    parts[b'head'] = parts[b'head'][:8] + b'\0'*4 + parts[b'head'][12:]
    n = len(parts); power = 1 << (n.bit_length()-1); offset = 12+16*n
    directory = []; chunks = []; head = None
    for tag, data in sorted(parts.items()):
        directory.append(struct.pack('>4sIII', tag, checksum(data), offset, len(data)))
        if tag == b'head': head = offset
        padded = data + b'\0'*(-len(data) % 4); chunks.append(padded); offset += len(padded)
    out = bytearray(version + struct.pack('>HHHH', n, power*16, int(math.log2(power)), n*16-power*16) + b''.join(directory) + b''.join(chunks))
    struct.pack_into('>I', out, head+8, (0xb1b0afba-checksum(bytes(out))) & 0xffffffff)
    return bytes(out)

def normalize(blob):
    parts = tables(blob)
    required = {b'head', b'hhea', b'maxp', b'hmtx', b'cmap', b'name'}
    missing = required - parts.keys()
    if missing:
        raise ValueError('字体缺少必要表：'+', '.join(t.decode('ascii') for t in sorted(missing)))
    if len(parts[b'head'])<54:raise ValueError('字体 head 表无效')
    changed = False
    if b'post' not in parts:
        # Format 3 carries metrics, without a glyph-name array. PDF.js also
        # constructs this format for embedded fonts. No glyph indices change.
        italic = bool(struct.unpack_from('>H', parts[b'head'], 44)[0] & 2)
        parts[b'post'] = struct.pack('>IihhIIIII', 0x00030000, -12*65536 if italic else 0, 0, 0, 0, 0, 0, 0, 0)
        changed = True
    if len(parts[b'hhea']) < 36 or len(parts[b'maxp']) < 6:
        raise ValueError('字体度量表不完整')
    count = struct.unpack_from('>H', parts[b'maxp'], 4)[0]
    metrics = struct.unpack_from('>H', parts[b'hhea'], 34)[0]
    if not 1 <= metrics <= count or len(parts[b'hmtx']) < 4*metrics+2*(count-metrics):
        raise ValueError('字体字宽数量不一致')
    maximum = max(struct.unpack_from('>H', parts[b'hmtx'], 4*i)[0] for i in range(metrics))
    if b'OS/2' not in parts:
        # PDF subsets may omit Windows metadata. Recover conservative metrics
        # from existing head/hhea/hmtx; never change outline or advance tables.
        # OpenType OS/2 v4 layout: Microsoft OpenType specification.
        head=parts[b'head'];units=struct.unpack_from('>H',head,18)[0]
        style=struct.unpack_from('>H',head,44)[0];ascent,descent,gap=struct.unpack_from('>hhh',parts[b'hhea'],4)
        ymin,ymax=struct.unpack_from('>h',head,38)[0],struct.unpack_from('>h',head,42)[0]
        widths=[struct.unpack_from('>H',parts[b'hmtx'],4*i)[0]for i in range(metrics)]
        widths += [widths[-1]]*(count-metrics);nonzero=[w for w in widths if w]
        average=min(32767,round(sum(nonzero)/len(nonzero))) if nonzero else 0
        os2=bytearray(96)
        struct.pack_into('>HhHHH',os2,0,4,average,700 if style&1 else 400,5,0)
        values=[.65,.6,0,.14,.65,.6,0,.48,.05,.25,0]
        struct.pack_into('>11h',os2,10,*(max(-32768,min(32767,round(v*units)))for v in values))
        os2[58:62]=b'FOLI'
        selection=(32 if style&1 else 0)|(1 if style&2 else 0)
        struct.pack_into('>HHHhhhHH',os2,62,selection or 64,0,65535,ascent,descent,gap,min(65535,max(0,ascent,ymax)),min(65535,max(0,-descent,-ymin)))
        struct.pack_into('>hhHHH',os2,86,0,max(0,ascent),0,0,1)
        parts[b'OS/2']=bytes(os2);changed=True
    if struct.unpack_from('>H', parts[b'hhea'], 10)[0] < maximum:
        header = bytearray(parts[b'hhea']); struct.pack_into('>H', header, 10, maximum)
        parts[b'hhea'] = bytes(header); changed = True
    return build(b'\0\1\0\0' if blob[:4] == b'true' else blob[:4], parts) if changed or blob[:4] == b'true' else blob
