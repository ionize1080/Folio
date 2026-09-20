"""Resolve unembedded font names without claiming outline identity.

Exact names and matching faces precede explicit metric substitutes. Unknown names
stay unresolved; similarity matching requires embedded outlines and lives elsewhere.
"""
import re
import unicodedata
from functools import lru_cache


def normalized(name):
    name = re.sub(r'^[A-Z]{6}\+', '', str(name)).replace('#20', ' ')
    return re.sub(r'[^\w]', '', unicodedata.normalize('NFKC', name).casefold())


def face_style(name):
    n = normalized(name)
    return (any(s in n for s in ('bold', 'black', 'heavy', 'semibold', 'demi', '粗')),
            any(s in n for s in ('italic', 'oblique', '斜')))


# These are explicit substitutes, not aliases proving identical outlines.
METRIC_FAMILIES = {
    'timesnewroman': ('Times', ('tiro', 'tibo', 'tiit', 'tibi')),
    'arial': ('Helvetica', ('helv', 'hebo', 'heit', 'hebi')),
    'couriernew': ('Courier', ('cour', 'cobo', 'coit', 'cobi')),
}


@lru_cache(maxsize=256)
def resolve_name(name):
    from system_fonts import catalog, select_font
    wanted = normalized(name)
    if not wanted or wanted == 'unknown':
        return None
    style = face_style(name)
    ranked = []
    for item in catalog().values():
        names = [item.get(k, '') for k in ('name', 'family', 'postScriptName')]
        names += item.get('aliases', [])
        if wanted not in {normalized(n) for n in names if n}:
            continue
        if face_style(item.get('style', '') + ' ' + item.get('postScriptName', '')) != style:
            continue
        # Full face / PostScript name beats a family-only match.
        score = 2 if wanted in {normalized(item.get('name', '')), normalized(item.get('postScriptName', ''))} else 1
        ranked.append((score, item['id']))
    if ranked:
        for _, ident in sorted(ranked, reverse=True):
            try:
                selected = select_font(ident)
                return {**selected, 'fontResolution': 'system-name', 'fontOriginalName': name,
                        'fontFallback': '原字体未嵌入，使用本机同名同样式字体；未证明字形完全一致'}
            except (OSError, ValueError, KeyError):
                continue
    for prefix, (family, faces) in METRIC_FAMILIES.items():
        # Restrict suffixes; do not match unrelated names beginning with Arial etc.
        suffix = wanted[len(prefix):] if wanted.startswith(prefix) else None
        if suffix not in ('', 'psmt', 'mt', 'regular', 'bold', 'italic', 'bolditalic',
                          'boldmt', 'italicmt', 'bolditalicmt', 'psboldmt', 'psitalicmt', 'psbolditalicmt'):
            continue
        import fitz
        from font_match import CACHE
        import hashlib, json
        alias = faces[int(style[0]) + 2 * int(style[1])]
        font = fitz.Font(alias)
        blob = font.buffer
        key = hashlib.sha256(blob).hexdigest()[:32]
        CACHE.mkdir(parents=True, exist_ok=True)
        (CACHE / (key + '.ttf')).write_bytes(blob)
        (CACHE / (key + '.json')).write_text(json.dumps({'name': font.name, 'coverage': font.valid_codepoints()}))
        return {'fontKey': key, 'fontName': font.name, 'fontOriginalName': name,
                'fontResolution': 'metric-substitute',
                'fontFallback': '原字体未嵌入且本机未命中，使用明确的度量近似字体：' + family}
    return None
