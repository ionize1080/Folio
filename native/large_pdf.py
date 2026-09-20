"""File-backed outline editing. Preserve existing action dictionaries verbatim.
Save a disk copy incrementally: no full PDF byte array or image re-encoding.
"""
import os, shutil, base64, math
import fitz


def open_document(args):
    doc=fitz.open(args['input'])
    if doc.needs_pass and not doc.authenticate(args.get('password','')):
        doc.close();raise ValueError('需要正确的文档密码')
    return doc


def outline_info(doc):
    toc=doc.get_toc(simple=False);refs=doc.get_outline_xrefs()
    return [{'id':str(ref),'level':r[0],'title':r[1],'page':r[2],
             'targetEditable':r[2]>0 and r[3].get('kind')==fitz.LINK_GOTO}
            for r,ref in zip(toc,refs)]


def process(args):
    with open_document(args) as doc:
        if args['command'] in ('large-page','large-text'):
            page=args.get('page')
            if not isinstance(page,int) or not 1<=page<=len(doc):raise ValueError('页码无效')
            p=doc[page-1]
            text=p.get_text('blocks')
            lines=[{'text':b[4], 'x':b[0], 'y':b[1]} for b in text if len(b)>6 and b[6]==0]
            result={'page':page,'width':p.rect.width,'height':p.rect.height,'lines':lines}
            if args['command']=='large-page':
                scale=float(args.get('scale',1.5))
                if not math.isfinite(scale) or not .1<=scale<=6:raise ValueError('缩放无效')
                scale=min(scale,math.sqrt(16000000/max(1,p.rect.width*p.rect.height)))
                pix=p.get_pixmap(matrix=fitz.Matrix(scale,scale),alpha=False)
                result.update(image=base64.b64encode(pix.tobytes('png')).decode(),pixelWidth=pix.width,pixelHeight=pix.height,scale=scale)
            return result
        original=outline_info(doc)
        if args['command']=='large-info':
            return {'pages':len(doc),'outlines':original,'incremental':doc.can_save_incrementally(),'encrypted':bool(doc.is_encrypted)}
        rows=args.get('outlines')
        if not isinstance(rows,list) or len(rows)>100000:raise ValueError('书签数量无效')
        known={r['id']:r for r in original};seen=set();previous=0
        for row in rows:
            level=row.get('level');page=row.get('page');ident=row.get('id')
            if not isinstance(level,int) or not 1<=level<=previous+1 or level>64:raise ValueError('书签层级无效')
            previous=level
            if not isinstance(row.get('title'),str) or len(row['title'])>10000:raise ValueError('书签标题无效')
            if not isinstance(ident,str) or ident in seen:raise ValueError('书签身份重复')
            seen.add(ident)
            old=known.get(ident)
            if not old or page!=old['page']:
                if not isinstance(page,int) or not 1<=page<=len(doc):raise ValueError('目标页码无效')
            if not old and not ident.startswith('new-'):raise ValueError('原始书签身份已失效')
        if not doc.can_save_incrementally():raise ValueError('此文件需要完整重写，当前大文件书签通道不支持；原件未改变')
    if os.path.realpath(args['input'])==os.path.realpath(args['output']):raise ValueError('请另存为副本')
    shutil.copyfile(args['input'],args['output'])
    with open_document({**args,'input':args['output']}) as doc:
        root_key=doc.xref_get_key(doc.pdf_catalog(),'Outlines')
        if root_key[0]=='xref':root=int(root_key[1].split()[0])
        else:
            root=doc.get_new_xref();doc.update_object(root,'<< /Type /Outlines >>')
            doc.xref_set_key(doc.pdf_catalog(),'Outlines',f'{root} 0 R')
        children={root:[]};stack=[root];allocated=[]
        for row in rows:
            old=known.get(row['id']);ref=int(row['id']) if old else doc.get_new_xref()
            if not old:doc.update_object(ref,'<< >>')
            doc.xref_set_key(ref,'Title',fitz.get_pdf_str(row['title']))
            if not old or row['page']!=old['page']:
                doc.xref_set_key(ref,'A','null');doc.xref_set_key(ref,'Dest',f'[{doc.page_xref(row["page"]-1)} 0 R /XYZ null null null]')
            stack=stack[:row['level']];parent=stack[-1];stack.append(ref)
            children.setdefault(parent,[]).append(ref);children.setdefault(ref,[])
            doc.xref_set_key(ref,'Parent',f'{parent} 0 R');allocated.append(ref)
        def descendants(ref):return sum(1+descendants(c) for c in children[ref])
        for ref,siblings in children.items():
            old_count=doc.xref_get_key(ref,'Count');collapsed=old_count[0]=='int' and int(old_count[1])<0
            for key,value in [('First',f'{siblings[0]} 0 R' if siblings else 'null'),('Last',f'{siblings[-1]} 0 R' if siblings else 'null')]:doc.xref_set_key(ref,key,value)
            # Count should be the number of visible descendants; retain collapse
            # state while recomputing hierarchy after edits.
            def visible(r):
                total=0
                for c in children[r]:
                    total+=1
                    count=doc.xref_get_key(c,'Count')
                    if count[0]!='int' or int(count[1])>=0:total+=visible(c)
                return total
            count=descendants(ref) if collapsed else visible(ref)
            doc.xref_set_key(ref,'Count',str(-count if collapsed else count))
            for i,child in enumerate(siblings):
                doc.xref_set_key(child,'Prev',f'{siblings[i-1]} 0 R' if i else 'null')
                doc.xref_set_key(child,'Next',f'{siblings[i+1]} 0 R' if i+1<len(siblings) else 'null')
        doc.saveIncr()
    with open_document({**args,'input':args['output']}) as check:
        actual=outline_info(check)
        if [(r['level'],r['title'],r['page']) for r in actual] != [(r['level'],r['title'],r['page']) for r in rows]:
            raise ValueError('书签写回校验失败，未替换目标文件')
    return {'verified':True,'bookmarks':len(rows),'bytes':os.path.getsize(args['output'])}
