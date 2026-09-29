"""Bounded, instance-local expansion of ordinary page wrapper Forms.

This is a deliberately limited compatibility path, not general Form editing.
Keep transparency/optional content/tagged containers opaque. Each expanded Do
gets its own resource namespace; never modify a shared Form stream or dictionary.
ISO 32000-1 8.10: implicit save/restore, Matrix, BBox and local resources.
"""
import io, math
from pypdf import PdfReader
from pypdf.generic import ContentStream, NameObject, DictionaryObject, FloatObject

MAX_DEPTH = 16
MAX_OPERATIONS = 200000
MAX_INSTANCES = 256
WRAPPER_OPS = {b'q', b'Q', b'cm', b'Do', b'BT', b'ET', b'Td', b're', b'W', b'n'}
PROTECTED = ('/Group', '/OC', '/Ref', '/StructParent', '/StructParents', '/OPI', '/PS')


def plain(form):
    return form.get('/Subtype') == '/Form' and not any(k in form for k in PROTECTED)


def balanced(ops, foreign=False, orphan_mcids=False):
    depth = text = marked = 0
    for args, op in ops:
        if op == b'q': depth += 1
        elif op == b'Q':
            depth -= 1
            if depth < 0: return False
        elif op == b'BT':
            if text: return False
            text = 1
        elif op == b'ET':
            if not text: return False
            text = 0
        elif op in (b'BDC', b'BMC'):
            protected = ('/Alt','/E') if orphan_mcids else ('/Alt','/E','/MCID')
            if foreign and (not args or args[0] == '/OC' or (op == b'BDC' and (len(args) < 2 or not isinstance(args[1], dict) or any(k in args[1] for k in protected)))): return False
            marked += 1
        elif op == b'EMC':
            marked -= 1
            if marked < 0: return False
        elif op in (b'Tj', b'TJ', b"'", b'"') and not text: return False
        elif op == b'INLINE IMAGE' and foreign: return False  # Inline CS names need a separate parser.
    return not (depth or text or marked)


def expand_page(page, *, foreign=True):
    from content_layers import eligible, RESOURCE_OPERATORS
    from content import raw_strings
    resources = page.get('/Resources', DictionaryObject()).get_object()
    original = ContentStream(page.get('/Contents'), page.pdf)
    if len(original.operations) > MAX_OPERATIONS or not balanced(original.operations): return False
    # External expansion only starts at a page containing ordinary wrapper calls.
    # Mixed pages retain their original foreign containers; own layers still reopen.
    wrappers = foreign and '/StructTreeRoot' not in page.pdf._root_object and not any(k in page for k in ('/StructParents', '/StructParent')) and all(op in WRAPPER_OPS for _, op in original.operations)
    destination = DictionaryObject(dict(resources))
    serial = 0
    budget = len(original.operations)

    def emit(ops, scope, ancestors, depth, allow_external=False):
        nonlocal serial, budget
        out = []; text = 0
        xs = scope.get('/XObject', {})
        xs = xs.get_object() if hasattr(xs, 'get_object') else xs
        for args, op in ops:
            if op == b'BT': text += 1
            elif op == b'ET': text -= 1
            ref = xs.get(args[0]) if op == b'Do' and args else None
            form = ref.get_object() if ref is not None else None
            owned = form is not None and eligible(form)
            external = allow_external and form is not None and plain(form) and '/FolioLayerKind' not in form
            identity = (ref.idnum, ref.generation) if hasattr(ref, 'idnum') else id(form)
            if not (owned or external) or text or depth >= MAX_DEPTH or serial >= MAX_INSTANCES or identity in ancestors:
                out.append((args, op)); continue
            matrix = list(form.get('/Matrix', [1,0,0,1,0,0])); box = list(form.get('/BBox', []))
            if len(matrix) != 6 or len(box) != 4 or not all(math.isfinite(float(v)) for v in matrix + box):
                out.append((args, op)); continue
            a,b,c,d,_,_ = map(float, matrix)
            if abs(a*d-b*c) < 1e-12 or float(box[2]) <= float(box[0]) or float(box[3]) <= float(box[1]):
                out.append((args, op)); continue
            local = form.get('/Resources', scope).get_object()
            colors = local.get('/ColorSpace', {})
            colors = colors.get_object() if hasattr(colors, 'get_object') else colors
            if any(k in colors for k in ('/DefaultRGB', '/DefaultCMYK', '/DefaultGray')):
                out.append((args, op)); continue
            content = ContentStream(form, page.pdf)
            # External expansion requires an untagged document/page and plain
            # Forms at every level. MCIDs here have no structure-tree owner.
            # Drop only these unlinked identifiers in the expanded copy; retain
            # marked-content boundaries, language and ActualText semantics.
            orphan_mcids = external and wrappers
            if budget + len(content.operations) + 7 > MAX_OPERATIONS or not balanced(content.operations, foreign=external, orphan_mcids=orphan_mcids):
                out.append((args, op)); continue
            # A retained resource-less child would inherit renamed page resources.
            # Reject this scope instead of silently resolving it against another Form.
            child_xs = local.get('/XObject', {})
            child_xs = child_xs.get_object() if hasattr(child_xs, 'get_object') else child_xs
            if any(o == b'Do' and ar and ar[0] in child_xs and child_xs[ar[0]].get_object().get('/Subtype') == '/Form' and '/Resources' not in child_xs[ar[0]].get_object() for ar,o in content.operations):
                out.append((args, op)); continue
            serial += 1; instance = serial; budget += len(content.operations) + 7
            renames = {}
            for kind, values in local.items():
                values = values.get_object()
                if not isinstance(values, dict): continue
                old = destination.get(kind, {})
                old = old.get_object() if hasattr(old, 'get_object') else old
                dest = DictionaryObject(dict(old)); destination[kind] = dest
                for name, value in values.items():
                    stem = '/FolioP7_%d_%s' % (instance, str(name).lstrip('/'))
                    candidate = NameObject(stem); suffix = 0
                    while candidate in dest:
                        suffix += 1; candidate = NameObject(stem + '_' + str(suffix))
                    dest[candidate] = value; renames[(str(kind), str(name))] = candidate
            # Recursion only through another wrapper scope; arbitrary inner groups
            # remain intact. Rename outer operators before appending inner results.
            nested = external and all(o in WRAPPER_OPS for _,o in content.operations)
            rewritten = []
            for values, operator in content.operations:
                values = list(values)
                if orphan_mcids and operator == b'BDC' and len(values) > 1 and isinstance(values[1], dict) and '/MCID' in values[1]:
                    values[1] = DictionaryObject({k:v for k,v in values[1].items() if k != '/MCID'})
                if operator in RESOURCE_OPERATORS:
                    kind, index = RESOURCE_OPERATORS[operator]
                    if (len(values) > index if index >= 0 else bool(values)) and isinstance(values[index], NameObject):
                        values[index] = renames.get((kind, str(values[index])), values[index])
                rewritten.append((values, operator))
            out.extend([([], b'q'), ([FloatObject(v) for v in matrix], b'cm'),
                ([FloatObject(box[0]), FloatObject(box[1]), FloatObject(box[2]-box[0]), FloatObject(box[3]-box[1])], b're'), ([], b'W'), ([], b'n')])
            # The renamed scope resolves calls deterministically; all resource
            # dictionaries are local copies, including repeated same-page calls.
            out.extend(emit(rewritten, destination, ancestors + (identity,), depth + 1, nested))
            out.append(([], b'Q'))
        return out

    output = emit(original.operations, resources, (), 0, wrappers)
    if not serial: return False
    original.operations = [([raw_strings(v) for v in values], op) for values,op in output]
    page[NameObject('/Resources')] = destination
    page[NameObject('/Contents')] = page.pdf._add_object(original)
    return True


def reopen(data, numbers):
    from pdf_writer import clone_document
    reader = PdfReader(io.BytesIO(data))
    # Avoid a full clone for ordinary PDFs without eligible page-level calls.
    wanted = sorted(set(n for n in numbers if isinstance(n,int) and 1 <= n <= len(reader.pages)))
    selected = []
    from content_layers import eligible
    for n in wanted:
        pg = reader.pages[n-1]; scope = pg.get('/Resources', {})
        scope = scope.get_object() if hasattr(scope,'get_object') else scope
        xs = scope.get('/XObject', {}); xs = xs.get_object() if hasattr(xs,'get_object') else xs
        if any(eligible(ref.get_object()) or plain(ref.get_object()) for ref in xs.values()): selected.append(n)
    if not selected: return data
    writer = clone_document(reader); changed = False
    for n in selected: changed = expand_page(writer.pages[n-1]) or changed
    if not changed: return data
    output = io.BytesIO(); writer.write(output); return output.getvalue()
