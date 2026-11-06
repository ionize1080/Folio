"""OCG and tagged-PDF operations. Preserve existing content and indirect identities."""
import base64, io, re
import pikepdf as p


def ident(obj): return '%d:%d' % obj.objgen
def array(obj): return list(obj) if isinstance(obj,p.Array) else [] if obj is None else [obj]
def saved(pdf, **info):
    out=io.BytesIO();pdf.save(out);data=out.getvalue()
    with p.open(io.BytesIO(data)) as check:
        if len(check.pages)!=len(pdf.pages): raise ValueError('页数校验失败')
    if len(data)>80*1024**2: raise ValueError('结果超过 80 MB')
    return {'bytes':base64.b64encode(data).decode(),'extension':'pdf','size':len(data),**info}


def layers(args):
    o=args.get('options') or {}; action=o.get('operation','inspect')
    with p.open(args['input']) as pdf:
        props=pdf.Root.get('/OCProperties'); groups=list(props.get('/OCGs',[])) if props else []
        byid={ident(g):g for g in groups}
        if action=='inspect':
            default=props.get('/D',p.Dictionary()) if props else p.Dictionary(); off={ident(g) for g in default.get('/OFF',[])}; on={ident(g) for g in default.get('/ON',[])}
            return {'layers':[{'id':ident(g),'name':str(g.get('/Name','')),'visible':ident(g) in on or (str(default.get('/BaseState','/ON'))!='/OFF' and ident(g) not in off),
                               'intent':str(g.get('/Intent','/View')),'locked':any(ident(x)==ident(g) for x in default.get('/Locked',[]))} for g in groups],
                    'configurations':[{'name':str(c.get('/Name','')),'index':i} for i,c in enumerate(props.get('/Configs',[]) if props else [])]}
        if not props:
            props=p.Dictionary(OCGs=p.Array(),D=p.Dictionary(BaseState=p.Name.ON,Order=p.Array(),ON=p.Array(),OFF=p.Array()));pdf.Root.OCProperties=props
        default=props.get('/D',p.Dictionary());props.D=default
        if action=='create':
            name=o.get('name','')
            if not isinstance(name,str) or not 1<=len(name)<=256: raise ValueError('请填写图层名称')
            group=pdf.make_indirect(p.Dictionary(Type=p.Name.OCG,Name=name));props.OCGs.append(group);groups.append(group)
            default.Order=p.Array([*array(default.get('/Order')),group]);target=ident(group)
            # Wrap complete pages without altering the content's internal nesting.
            pages=o.get('pages',[])
            if not isinstance(pages,list) or len(pages)>100: raise ValueError('一次最多指定 100 页')
            for number in dict.fromkeys(pages):
                if type(number)!=int or not 1<=number<=len(pdf.pages): raise ValueError('页码无效')
                page=pdf.pages[number-1];resources=p.Dictionary(page.get('/Resources',p.Dictionary()));page.Resources=resources
                properties=p.Dictionary(resources.get('/Properties',p.Dictionary()));resources.Properties=properties
                key=p.Name('/FolioOC'+str(group.objgen[0]));properties[key]=group
                page.Contents=p.Array([pdf.make_stream(('/OC '+str(key)+' BDC\n').encode()),*array(page.get('/Contents')),pdf.make_stream(b'\nEMC\n')])
            if o.get('visible') is False:default.OFF=p.Array([*array(default.get('/OFF')),group])
            return saved(pdf,layerId=target)
        if action=='configure':
            changes=o.get('changes',[])
            if not isinstance(changes,list) or not 1<=len(changes)<=1000: raise ValueError('图层修改列表无效')
            for change in changes:
                group=byid.get(change.get('id'))
                if group is None: raise ValueError('图层 ID 已失效')
                if 'name' in change:
                    if not isinstance(change['name'],str) or not 1<=len(change['name'])<=256: raise ValueError('图层名无效')
                    group.Name=change['name']
                for flag,key in [('visible',None),('locked','/Locked')]:
                    if flag not in change:continue
                    if type(change[flag])!=bool:raise ValueError('图层状态须为布尔值')
                    if key:
                        default[key]=p.Array([g for g in default.get(key,[]) if ident(g)!=ident(group)]+([group] if change[flag] else []))
                    else:
                        for target in ('/ON','/OFF'):
                            default[target]=p.Array([g for g in default.get(target,[]) if ident(g)!=ident(group)]+([group] if (target=='/ON')==change[flag] else []))
                for event in ('View','Print','Export'):
                    flag=event.lower()
                    if flag in change:
                        if type(change[flag])!=bool:raise ValueError('图层用途须为布尔值')
                        usage=group.get('/Usage',p.Dictionary());group.Usage=usage
                        usage['/'+event]=p.Dictionary({('/'+event+'State'):p.Name.ON if change[flag] else p.Name.OFF})
                        applications=array(default.get('/AS'));applications.append(p.Dictionary(Event=p.Name('/'+event),Category=p.Array([p.Name('/'+event)]),OCGs=p.Array([group])));default.AS=p.Array(applications)
            return saved(pdf,changed=len(changes))
        if action=='order':
            ids=o.get('ids',[])
            if len(ids)!=len(groups) or len(set(ids))!=len(ids) or set(ids)!=set(byid):raise ValueError('排序必须包含每个图层且不能重复')
            default.Order=p.Array([byid[x] for x in ids]);return saved(pdf)
        if action=='assign':
            group=byid.get(o.get('id'))
            if group is None:raise ValueError('图层 ID 无效')
            refs=o.get('objects',[])
            if not isinstance(refs,list) or not 1<=len(refs)<=1000:raise ValueError('请指定图像或 Form XObject 的对象 ID')
            for ref in refs:
                if not re.fullmatch(r'\d+:\d+',str(ref)):raise ValueError('对象 ID 无效')
                obj=pdf.get_object(tuple(map(int,ref.split(':'))))
                if not isinstance(obj,p.Stream) or str(obj.get('/Subtype')) not in ('/Image','/Form'):raise ValueError('只能给图像或 Form XObject 分配图层')
                obj.OC=group
            return saved(pdf,changed=len(refs))
        raise ValueError('未知图层操作')


def tree(pdf):
    root=pdf.Root.get('/StructTreeRoot'); rows=[]; objects={}; seen=set()
    pageids={ident(page.obj):i+1 for i,page in enumerate(pdf.pages)}
    def walk(node,parent=None,page=None,depth=0):
        if depth>128 or len(rows)>=20000:raise ValueError('结构树超过安全遍历预算')
        if not isinstance(node,p.Dictionary) or str(node.get('/Type','')) not in ('/StructElem','/StructTreeRoot'):return
        key=ident(node)
        if key in seen:raise ValueError('结构树包含循环或重复父引用')
        seen.add(key);objects[key]=node
        page=pageids.get(ident(node.Pg),page) if '/Pg' in node else page
        kids=array(node.get('/K'))
        rows.append({'id':key,'parent':parent,'role':str(node.get('/S','/StructTreeRoot')).lstrip('/'),'page':page,
                     'language':str(node.get('/Lang','')),'alt':str(node.get('/Alt','')),'actualText':str(node.get('/ActualText','')),'title':str(node.get('/T','')),
                     'mcids':[int(k) for k in kids if type(k)==int], 'children':[ident(k) for k in kids if isinstance(k,p.Dictionary) and str(k.get('/Type',''))=='/StructElem']})
        for kid in kids:walk(kid,key,page,depth+1)
    if root:walk(root)
    return rows,objects


def tags(args):
    o=args.get('options') or {};action=o.get('operation','inspect')
    with p.open(args['input']) as pdf:
        rows,objects=tree(pdf)
        if action=='inspect':
            offset=o.get('offset',0);limit=o.get('limit',200)
            if type(offset)!=int or offset<0 or type(limit)!=int or not 1<=limit<=1000:raise ValueError('结构树分页无效')
            issues=[]
            if not rows:issues.append({'code':'missing-tags','message':'没有标签结构树'})
            if not pdf.Root.get('/Lang'):issues.append({'code':'missing-language','message':'没有文档语言'})
            for row in rows:
                if row['role']=='Figure' and not row['alt']:issues.append({'code':'missing-alt','id':row['id'],'page':row['page'],'message':'图形缺少替代文字'})
            return {'tagged':bool(pdf.Root.get('/MarkInfo',{}).get('/Marked',False)), 'language':str(pdf.Root.get('/Lang','')),
                    'nodes':rows[offset:offset+limit],'total':len(rows),'hasMore':offset+limit<len(rows),'issues':issues[:1000],
                    'scope':'结构检查；不等于 PDF/UA 合规验证。阅读顺序及替代文字质量仍需人工复核。'}
        if action=='patch':
            changes=o.get('changes',[])
            if not isinstance(changes,list) or len(changes)>1000:raise ValueError('结构修改列表无效')
            for c in changes:
                obj=objects.get(c.get('id'))
                if obj is None or str(obj.get('/Type',''))!='/StructElem':raise ValueError('标签 ID 无效')
                for field,key in [('alt','/Alt'),('actualText','/ActualText'),('title','/T'),('language','/Lang'),('role','/S')]:
                    if field not in c:continue
                    value=c[field]
                    if value is None and field=='role':raise ValueError('标签角色不能删除')
                    if value is None:
                        if key in obj:del obj[key]
                    elif not isinstance(value,str) or len(value)>16000:raise ValueError('标签属性无效')
                    elif field=='role':
                        if not re.fullmatch(r'[A-Za-z][A-Za-z0-9]{0,63}',value):raise ValueError('标签角色无效')
                        obj[key]=p.Name('/'+value)
                    else:obj[key]=value
            if 'language' in o:
                if not re.fullmatch(r'[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*',o['language']):raise ValueError('请使用 BCP 47 语言标签，例如 zh-CN')
                pdf.Root.Lang=o['language']
            if 'title' in o:
                if not isinstance(o['title'],str) or len(o['title'])>16000:raise ValueError('标题无效')
                pdf.docinfo.Title=o['title']
                with pdf.open_metadata(set_pikepdf_as_editor=False,update_docinfo=False) as xmp:xmp['dc:title']=o['title']
                prefs=pdf.Root.get('/ViewerPreferences',p.Dictionary());prefs.DisplayDocTitle=True;pdf.Root.ViewerPreferences=prefs
            return saved(pdf,changed=len(changes),note='标签修改不自动声明 PDF/UA 合规；请运行独立验证。')
        if action=='reorder':
            parent=objects.get(o.get('parent'));ids=o.get('ids',[])
            if parent is None:raise ValueError('父标签 ID 无效')
            kids=array(parent.get('/K'));elements={ident(k):k for k in kids if isinstance(k,p.Dictionary) and str(k.get('/Type',''))=='/StructElem'}
            if len(ids)!=len(elements) or len(set(ids))!=len(ids) or set(ids)!=set(elements):raise ValueError('必须按顺序提供该父标签的全部直接子标签')
            iterator=iter(ids);parent.K=p.Array([elements[next(iterator)] if isinstance(k,p.Dictionary) and str(k.get('/Type',''))=='/StructElem' else k for k in kids])
            return saved(pdf)
        raise ValueError('未知标签操作')


def render(args):
    import fitz, math
    o=args.get('options') or {};number=o.get('page',1);dpi=o.get('dpi',144);region=o.get('region',[0,0,1,1])
    if type(number)!=int or type(dpi) not in (float,int) or not math.isfinite(dpi) or not 36<=dpi<=600:raise ValueError('页码或 DPI 无效')
    if not isinstance(region,list) or len(region)!=4 or any(type(x) not in (float,int) or not math.isfinite(x) or not 0<=x<=1 for x in region):raise ValueError('region 须为归一化 [左,上,宽,高]')
    x,y,w,h=region
    if w<=0 or h<=0 or x+w>1 or y+h>1:raise ValueError('渲染区域超出页面')
    with fitz.open(args['input']) as source:
        doc=source
        if not 1<=number<=len(doc):raise ValueError('页码无效')
        states=o.get('layers')
        if states is not None:
            if not isinstance(states,dict) or len(states)>1000:raise ValueError('图层状态无效')
            groups=doc.get_ocgs();on=[];off=[]
            for key,value in states.items():
                if not re.fullmatch(r'\d+:0',key) or int(key.split(':')[0]) not in groups or type(value)!=bool:raise ValueError('图层 ID 或状态无效')
            for ref,group in groups.items():
                (on if states.get(str(ref)+':0',group['on']) else off).append(ref)
            doc.set_layer(-1,on=on,off=off)
            # MuPDF's renderer must reopen to observe changed default states.
            data=doc.tobytes();doc=fitz.open(stream=data,filetype='pdf')
        page=doc[number-1];r=page.rect;clip=fitz.Rect(r.x0+x*r.width,r.y0+y*r.height,r.x0+(x+w)*r.width,r.y0+(y+h)*r.height)
        if math.ceil(clip.width*dpi/72)*math.ceil(clip.height*dpi/72)>12_000_000:raise ValueError('单次渲染最多 1200 万像素，请降低 DPI 或缩小区域')
        pix=page.get_pixmap(matrix=fitz.Matrix(dpi/72,dpi/72),clip=clip,alpha=False,annots=o.get('annotations',True) is not False)
        data=pix.tobytes('png');matrix=fitz.Matrix(72/dpi,0,0,72/dpi,pix.x*72/dpi,pix.y*72/dpi)*page.derotation_matrix*~page.transformation_matrix
        output={'image':base64.b64encode(data).decode(),'mimeType':'image/png','page':number,'dpi':dpi,'width':pix.width,'height':pix.height,'region':region,'imageToPdf':list(matrix),'renderer':'MuPDF'}
        if doc is not source:doc.close()
        return output
