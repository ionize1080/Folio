"""Validate a contiguous tagged-text replacement without rewriting the tag tree.

Word may give every font/script run its own MCID inside one P or heading.
The replacement uses a paragraph-owned MCID at its original logical position
when available. Other selected scopes remain empty, retaining ParentTree links.
"""
def dereference(value):
    return value.get_object() if hasattr(value, 'get_object') else value


def number_tree(node, key, seen=None):
    node = dereference(node)
    seen = set() if seen is None else seen
    if not isinstance(node, dict) or id(node) in seen:
        return None
    seen.add(id(node))
    values = dereference(node.get('/Nums', []))
    for i in range(0, len(values) - 1, 2):
        if values[i] == key:
            return dereference(values[i + 1])
    for child in dereference(node.get('/Kids', [])):
        result = number_tree(child, key, seen)
        if result is not None:
            return result
    return None


def block_owner(owner):
    seen = set()
    for _ in range(32):
        owner = dereference(owner)
        if not isinstance(owner, dict) or id(owner) in seen:
            return None
        seen.add(id(owner))
        if any(key in owner for key in ('/ActualText', '/Alt', '/E')):
            return None
        role = str(owner.get('/S', ''))
        if role in ('/P', '/H', '/H1', '/H2', '/H3', '/H4', '/H5', '/H6'):
            return owner
        # A link, formula, list item or another block is a real semantic
        # boundary. Only plain inline spans may lead to a common owner.
        if role != '/Span':
            return None
        owner = owner.get('/P')
    return None


def validate_scopes(page, stream, raw_objects, mapped, sources):
    from content import decoded_texts
    entries = [mapped[s['index']] for s in sources]
    scopes = {}
    for entry in entries:
        tags = entry.get('structureScopes', [])
        if len(tags) != 1:
            raise ValueError('标签文字须在完整且不嵌套的 MCID 范围内编辑，草稿已保留')
        scope = tags[0]
        scopes[(scope['at'], scope['end'], scope['mcid'])] = scope
    scopes = sorted(scopes.values(), key=lambda s: s['at'])
    selected = {entry['at'] for entry in entries}
    decoded = decoded_texts(page, stream)
    harmless = lambda entry: entry['type'] == 'text' and not decoded.get(entry['at'], '?').strip()
    for scope in scopes:
        members = [entry for entry in raw_objects if scope['at'] < entry['at'] < scope['end']]
        if len(members) != scope['count'] or any(entry['at'] not in selected and not harmless(entry) for entry in members):
            raise ValueError('带标签文字需选择完整 MCID 范围，草稿已保留')
    if len(scopes) == 1:
        return scopes, scopes[0]
    if any(a['end'] >= b['at'] for a, b in zip(scopes, scopes[1:])):
        raise ValueError('嵌套 MCID 范围需分别编辑，草稿已保留')
    if any(entry['at'] not in selected and not harmless(entry) for entry in raw_objects
           if scopes[0]['at'] < entry['at'] < scopes[-1]['end']):
        raise ValueError('MCID 范围之间含其他内容，需分别编辑，草稿已保留')
    languages = set()
    for scope in scopes:
        args, op = stream.operations[scope['at']]
        properties = args[1] if op == b'BDC' and len(args) > 1 else {}
        if isinstance(properties, str):
            properties = dereference(page['/Resources'].get('/Properties', {})).get(properties, {})
        properties = dereference(properties)
        if any(key in properties for key in ('/ActualText', '/Alt', '/E')):
            raise ValueError('替代文字语义范围需分别编辑，草稿已保留')
        languages.add(str(properties.get('/Lang', '')))
    root = page.pdf.root_object
    # Extracted pages sometimes retain MCIDs after their entire tag tree was
    # removed. They have no structure owner to transfer or invalidate; keep the
    # identifiers and wrappers, still requiring complete contiguous text.
    if '/StructTreeRoot' not in root and '/StructParents' not in page and not dereference(root.get('/MarkInfo', {})).get('/Marked'):
        if len(languages) != 1:
            raise ValueError('不同语言标记范围需分别编辑，草稿已保留')
        return scopes, scopes[0]
    tree = dereference(root.get('/StructTreeRoot', {}))
    parents = number_tree(tree.get('/ParentTree'), page.get('/StructParents'))
    if not isinstance(parents, list):
        raise ValueError('标签 ParentTree 无法验证，草稿已保留')
    owners = []
    for scope in scopes:
        mcid = scope['mcid']
        if not 0 <= mcid < len(parents):
            raise ValueError('标签 MCID 缺少 ParentTree 所有权，草稿已保留')
        owner = block_owner(parents[mcid])
        if owner is None:
            raise ValueError('链接、替代文字或复杂标签范围需分别编辑，草稿已保留')
        owners.append(owner)
    if any(owner is not owners[0] for owner in owners[1:]):
        raise ValueError('多个 MCID 不属于同一语义段落，需分别编辑，草稿已保留')
    # Prefer a run owned directly by P/H rather than an inline English Span
    # containing just a section number. All other runs become empty; the whole
    # replacement inherits the original paragraph's semantic role/language.
    direct = next((s for s in scopes if dereference(parents[s['mcid']]) is owners[0]), None)
    if direct is None and len(languages) != 1:
        raise ValueError('不同语言标记范围需分别编辑，草稿已保留')
    return scopes, direct or scopes[0]
