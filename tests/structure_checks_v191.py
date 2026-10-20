"""Independent tagged-PDF graph and page-MCID checks for corpus verification."""
import hashlib, io, json
from collections import Counter
from pypdf import PdfReader
from pypdf.generic import ContentStream, IndirectObject, NameObject


def structure_fingerprint(raw):
    reader = PdfReader(io.BytesIO(raw))
    root = reader.trailer['/Root']
    if '/StructTreeRoot' not in root:
        return None
    pages = {(p.indirect_reference.idnum, p.indirect_reference.generation): i for i, p in enumerate(reader.pages)}
    seen = {}
    def normalize(value):
        if isinstance(value, IndirectObject):
            key = (value.idnum, value.generation)
            if key in pages:
                return {'page': pages[key]}
            if key in seen:
                return {'reference': seen[key]}
            serial = len(seen)
            seen[key] = serial
            return {'object': serial, 'value': normalize(value.get_object())}
        if isinstance(value, dict):
            return {str(k): normalize(value.raw_get(k)) for k in sorted(value)}
        if isinstance(value, list):
            return [normalize(v) for v in value]
        if isinstance(value, bytes):
            return {'bytes': bytes(value).hex()}
        if value is None or isinstance(value, (str, int, float, bool)):
            return value
        return str(value)
    graph = normalize(root.raw_get('/StructTreeRoot'))
    return hashlib.sha256(json.dumps(graph, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def page_mcids(raw):
    reader = PdfReader(io.BytesIO(raw))
    result = []
    for page in reader.pages:
        ids = Counter()
        properties = page.get('/Resources', {}).get('/Properties', {})
        properties = properties.get_object() if hasattr(properties, 'get_object') else properties
        for args, op in ContentStream(page.get('/Contents'), reader).operations:
            if op != b'BDC' or len(args) < 2:
                continue
            prop = properties.get(args[1], {}) if isinstance(args[1], NameObject) else args[1]
            prop = prop.get_object() if hasattr(prop, 'get_object') else prop
            if isinstance(prop, dict) and '/MCID' in prop:
                ids[int(prop['/MCID'])] += 1
        result.append({'StructParents': page.get('/StructParents'), 'MCIDs': dict(ids)})
    return result


def assert_tag_structure_preserved(before, after):
    original = structure_fingerprint(before)
    assert structure_fingerprint(after) == original, 'StructTreeRoot / ParentTree graph changed'
    assert page_mcids(before) == page_mcids(after), 'page MCID identity, multiplicity or StructParents changed'
    return {'tagged': original is not None, 'structureFingerprint': original, 'pageMCIDsPreserved': True}
