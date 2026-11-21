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


# A producer may map its custom roles to standard PDF structure types. Explicit
# standard types already determine semantics and cannot be redefined by RoleMap.
STANDARD_ROLES = frozenset(
    ("/" + name) for name in
    "Document DocumentFragment Part Art Sect Div BlockQuote Caption TOC TOCI Index "
    "NonStruct Private P H H1 H2 H3 H4 H5 H6 H7 H8 H9 H10 L LI Lbl LBody Table "
    "TR TH TD THead TBody TFoot Span Quote Note Reference BibEntry Code Link Annot "
    "Ruby RB RT RP Warichu WT WP Figure Formula Form Aside FENote Title Em Strong "
    "Sub Artifact".split()
)


def block_owner(owner, role_map=None, dictionary_type=dict):
    """Find the editable paragraph owner using either pypdf or pikepdf objects."""
    if not isinstance(role_map, dictionary_type):
        role_map = None
    for _ in range(32):
        owner = dereference(owner)
        if not isinstance(owner, dictionary_type):
            return None
        if any(key in owner for key in ('/ActualText', '/Alt', '/E')):
            return None
        role = str(owner.get('/S', ''))
        visited = set()
        while role_map and role.startswith('/') and role not in STANDARD_ROLES:
            if role in visited or len(visited) >= 32:
                return None
            visited.add(role)
            role = str(role_map.get(role, ''))
        if role in ('/P', '/H', '/H1', '/H2', '/H3', '/H4', '/H5', '/H6'):
            return owner
        if role not in ('/Span', '/NonStruct'):
            return None
        # A raised footnote or another attributed inline has its own
        # layout/semantics. Its MCID must not be emptied into the paragraph.
        if '/A' in owner or '/C' in owner:
            return None
        owner = owner.get('/P')
    return None


def annotate_paragraphs(page, mapped, descriptions):
    """Mark contiguous editable segments of actual P/heading elements."""
    def contiguous():
        previous = None
        segment = -1
        for description in descriptions:
            owner = description.get('structureParagraph')
            if owner is None:
                if description.get('type') != 'text' or description.get('text', '').strip():
                    previous = None
                continue
            if owner != previous:
                segment += 1
            description['structureOwner'] = owner
            description['structureParagraph'] = segment
            previous = owner
    document=page.pdf or getattr(page.indirect_reference,'pdf',None)
    root=document.root_object if document is not None else {}
    tree=dereference(root.get('/StructTreeRoot',{}))
    if not isinstance(tree,dict):return
    parents=number_tree(tree.get('/ParentTree'),page.get('/StructParents'))
    if not isinstance(parents,(list,tuple)):
        hints={int(a):int(b) for a,b in page.get('/FolioInspectionParagraphs',[])}
        for entry,description in zip(mapped,descriptions):
            tags=entry.get('structureScopes',[])
            if len(tags)==1 and not entry.get('semanticScopes') and description.get('flowEditable') and tags[0]['mcid'] in hints:
                description['structureParagraph']=hints[tags[0]['mcid']]
        contiguous();return
    owners={}
    for entry,description in zip(mapped,descriptions):
        tags=entry.get('structureScopes',[])
        if len(tags)!=1 or entry.get('semanticScopes') or not description.get('flowEditable'):continue
        mcid=tags[0]['mcid']
        if not 0<=mcid<len(parents):continue
        owner=block_owner(parents[mcid], dereference(tree.get('/RoleMap', {})))
        if owner is None:continue
        key=id(owner)
        if key not in owners:owners[key]=len(owners)
        description['structureParagraph']=owners[key]
    contiguous()


def validate_scopes(page, stream, raw_objects, mapped, sources, model=None, descriptions=None):
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
    # A producer may use one MCID for several visually separate paragraphs.
    # Replacing a contiguous subset is safe when the replacement stays inside
    # the existing wrapper and contains exactly the selected source text. No
    # tag, ownership or neighbouring text is removed or relocated in this case.
    partial=False
    if len(scopes)==1 and model and descriptions:
        scope=scopes[0];first=min(selected);last=max(selected)
        compact=lambda text: ''.join(text.split())
        original=(model.get('originalLayout') or {}).get('text','')
        captured=''.join(descriptions[s['index']].get('text','') for s in sources)
        partial=bool(original and compact(original)==compact(captured)) and all(
            entry.get('end') is not None and scope['at']<entry['end']<scope['end'] for entry in entries)
        partial=partial and not any(entry['type']=='text' and entry['at'] not in selected and not harmless(entry)
            for entry in raw_objects if first<=entry['at']<=max(e['end'] for e in entries))
    for scope in scopes:
        members = [entry for entry in raw_objects if scope['at'] < entry['at'] < scope['end']]
        if len(members) != scope['count'] or (not partial and any(entry['at'] not in selected and not harmless(entry) for entry in members)):
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
        owner = block_owner(parents[mcid], dereference(tree.get('/RoleMap', {})))
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
