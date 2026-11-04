"""Low-level PDF object and tree access complementing the complete upstream API."""
import base64,json,math,subprocess,tempfile
from pathlib import Path
import pymupdf

OPERATIONS = {
 'document.info': {}, 'document.trailer': {}, 'document.catalog': {},
 'object.read': {'xref': 1}, 'object.keys': {'xref': 1},
 'object.get': {'xref': 1, 'key': 'Type'},
 'object.set': {'xref': 1, 'key': 'Key', 'value': 'null'},
 'object.replace': {'xref': 1, 'pdf': '<< /Type /Example >>'},
 'object.create': {'pdf': '<< >>'},
 'stream.read': {'xref': 1, 'offset': 0, 'limit': 65536},
 'stream.write': {'xref': 1, 'base64': '...'},
 'outline.read': {}, 'outline.write': {'toc': [[1, 'Chapter', 1]]},
 'page.labels.read': {}, 'page.labels.write': {'labels': []},
 'page.boxes': {'page': 1}, 'page.box.set': {'page': 1, 'box': 'crop', 'rect': [0, 0, 595, 842]},
 'page.render': {'page':1,'purpose':'classify','region':[0,0,1,1]},
 'page.rotation': {'page': 1, 'rotation': 90},
 'page.links.read': {'page': 1}, 'page.links.insert': {'page': 1, 'link': {'kind': 1, 'from': [10, 10, 80, 30], 'page': 0, 'to': [0, 0]}},
 'page.links.update': {'page': 1, 'link': {}}, 'page.links.delete': {'page': 1, 'link': {}},
 'attachments.list': {}, 'attachments.read': {'name': 'example.txt'},
 'attachments.add': {'name': 'example.txt', 'base64': 'SGVsbG8='}, 'attachments.delete': {'name': 'example.txt'},
 'metadata.xml.read': {}, 'metadata.xml.write': {'xml': '<metadata/>'},
}
READ = {op for op in OPERATIONS if op.endswith(('.read', '.list', '.info', '.trailer', '.catalog', '.boxes', '.keys', '.get'))}
READ.add('page.render')
def install(mcp):
 @mcp.tool()
 def pdf_local_ocr(path: str, page: int, threshold: float = .95) -> dict:
    """Local Paddle OCR, preferred before external vision. File-backed single-page extraction supports large PDFs. Low-confidence words retain original confidence; threshold 0..1, default .95."""
    if not 0<=threshold<=1: raise ValueError('threshold must be 0..1')
    here=Path(__file__).resolve()
    candidates=[here.parent.parent/'native',here.parent.parent.parent/'native']
    native=next((p for p in candidates if (p/'worker.py').exists()),None)
    if native is None: raise ValueError('Folio local Paddle runtime not found')
    with pymupdf.open(path) as doc, tempfile.TemporaryDirectory(prefix='folio-paddle-') as tmp:
        if not 1<=page<=len(doc): raise ValueError('Invalid page')
        single=pymupdf.open();single.insert_pdf(doc,from_page=page-1,to_page=page-1)
        file=Path(tmp)/'page.pdf';single.save(file);single.close()
        request={'command':'ocr','input':str(file),'page':1,'profile':'v6','skipText':False}
        run=subprocess.run([str(native/'runtime/python.exe'),str(native/'worker.py')],input=json.dumps(request)+'\n',text=True,capture_output=True,timeout=180)
        if run.returncode: raise ValueError('Local Paddle process failed')
        result=json.loads(run.stdout.strip().splitlines()[-1])
        if result.get('error'): raise ValueError(result['error'])
        result=result['result']
        for block in result['blocks']: block['page']=page
        return {**result,'threshold':threshold,'lowConfidence':[b for b in result['blocks'] if b.get('confidence',0)<threshold]}
 @mcp.tool()
 def pdf_object_help(operation: str = '') -> dict:
    """Discover low-level PDF objects, streams, outlines, page boxes, links and embedded files."""
    return {'operations': OPERATIONS if not operation else {operation: OPERATIONS[operation]}, 'guide': 'All writes require a new output path; input is preserved. xref is the PDF object number. object.set supports nested PDF keys and raw PDF syntax; null removes a key. Page arguments are 1-based; link destination page is PyMuPDF 0-based. Coordinates in this API use PyMuPDF top-left page coordinates; Folio bookmark destinations use PDF coordinates. All operations are local-only.'}
 @mcp.tool()
 def pdf_object_operation(path: str, operation: str, options: dict, output: str = '', password: str = '') -> dict:
    """Read/edit any PDF dictionary or stream and complete outline trees. Query pdf_object_help first."""
    if operation not in OPERATIONS: raise ValueError('Unknown operation')
    if operation not in READ and not output: raise ValueError('New output path required')
    source=Path(path).resolve()
    if output and Path(output).resolve()==source: raise ValueError('Input overwrite is not allowed')
    def binary(raw):
        if len(raw)>4*1024*1024: raise ValueError('Binary output exceeds 4 MB; read a stream slice')
        return {'base64':base64.b64encode(raw).decode(), 'bytes':len(raw)}
    with pymupdf.open(str(source)) as doc:
        if doc.needs_pass and not doc.authenticate(password): raise ValueError('PDF password required')
        o=options;result={};xref=o.get('xref')
        if xref is not None and (not isinstance(xref,int) or xref<1 or xref>=doc.xref_length()): raise ValueError('Invalid xref')
        if operation=='page.render':
            number=o.get('page',1)
            if not isinstance(number,int) or not 1<=number<=len(doc): raise ValueError('Invalid page')
            page=doc[number-1];region=o.get('region') or [0,0,1,1]
            if len(region)!=4 or any(not isinstance(n,(int,float)) or not math.isfinite(n) or n<0 or n>1 for n in region): raise ValueError('Invalid region')
            x,y,w,h=region
            if w<=0 or h<=0 or x+w>1 or y+h>1: raise ValueError('Invalid region')
            purpose=o.get('purpose','classify');edge={'classify':960,'toc':1600,'locate':2200}.get(purpose)
            if not edge: raise ValueError('Unknown purpose')
            rect=page.rect;clip=pymupdf.Rect(rect.x0+x*rect.width,rect.y0+y*rect.height,rect.x0+(x+w)*rect.width,rect.y0+(y+h)*rect.height)
            scale=min(3,edge/max(clip.width,clip.height));pix=page.get_pixmap(matrix=pymupdf.Matrix(scale,scale),clip=clip,alpha=False)
            transform=pymupdf.Matrix(1/scale,0,0,1/scale,pix.x/scale,pix.y/scale)*page.derotation_matrix*~page.transformation_matrix
            meta={'page':number,'purpose':purpose,'region':region,'width':pix.width,'height':pix.height,'imageToPdf':list(transform)}
            return {'content':[{'type':'text','text':json.dumps(meta)},{'type':'image','mimeType':'image/png','data':base64.b64encode(pix.tobytes('png')).decode()}]}
        elif operation=='document.info': result={'pageCount':len(doc),'xrefCount':doc.xref_length(),'metadata':doc.metadata}
        elif operation=='document.trailer': result={'pdf':doc.pdf_trailer()}
        elif operation=='document.catalog': result={'xref':doc.pdf_catalog()}
        elif operation=='object.read': result={'pdf':doc.xref_object(xref,compressed=False)}
        elif operation=='object.keys': result={'keys':doc.xref_get_keys(xref)}
        elif operation=='object.get': result={'value':doc.xref_get_key(xref,o['key'])}
        elif operation=='object.set': doc.xref_set_key(xref,o['key'],o['value'])
        elif operation=='object.replace': doc.update_object(xref,o['pdf'])
        elif operation=='object.create':
            xref=doc.get_new_xref();doc.update_object(xref,o.get('pdf','<< >>'));result={'xref':xref}
        elif operation=='stream.read':
            offset=o.get('offset',0);limit=o.get('limit',65536)
            if not isinstance(offset,int) or offset<0 or not isinstance(limit,int) or not 1<=limit<=4*1024*1024: raise ValueError('Invalid stream range')
            raw=doc.xref_stream(xref) or b'';result={**binary(raw[offset:offset+limit]),'totalBytes':len(raw),'offset':offset}
        elif operation=='stream.write': doc.update_stream(xref,base64.b64decode(o['base64'],validate=True))
        elif operation=='outline.read': result={'toc':doc.get_toc(simple=False)}
        elif operation=='outline.write': result={'count':doc.set_toc(o['toc'])}
        elif operation=='page.labels.read': result={'labels':doc.get_page_labels()}
        elif operation=='page.labels.write': doc.set_page_labels(o['labels'])
        elif operation.startswith('page.'):
            p=o['page']
            if not isinstance(p,int) or p<1 or p>len(doc):raise ValueError('Invalid page')
            page=doc[p-1]
            if operation=='page.boxes': result={k:list(getattr(page,k+'box')) for k in ('media','crop','bleed','trim','art')}
            elif operation=='page.box.set':
                if o['box'] not in ('media','crop','bleed','trim','art'):raise ValueError('Invalid box')
                getattr(page,'set_'+o['box']+'box')(pymupdf.Rect(o['rect']))
            elif operation=='page.rotation':
                if o['rotation'] not in (0,90,180,270):raise ValueError('Invalid rotation')
                page.set_rotation(o['rotation'])
            elif operation=='page.links.read':result={'links':page.get_links()}
            else:
                link=dict(o['link'])
                if 'from' in link:link['from']=pymupdf.Rect(link['from'])
                if 'to' in link:link['to']=pymupdf.Point(link['to'])
                {'page.links.insert':page.insert_link,'page.links.update':page.update_link,'page.links.delete':page.delete_link}[operation](link)
        elif operation=='attachments.list':result={'names':doc.embfile_names()}
        elif operation=='attachments.read':result={**binary(doc.embfile_get(o['name'])),'info':doc.embfile_info(o['name'])}
        elif operation=='attachments.add':doc.embfile_add(o['name'],base64.b64decode(o['base64'],validate=True))
        elif operation=='attachments.delete':doc.embfile_del(o['name'])
        elif operation=='metadata.xml.read':result={'xml':doc.get_xml_metadata()}
        elif operation=='metadata.xml.write':doc.set_xml_metadata(o['xml'])
        if operation not in READ:
            target=Path(output).resolve()
            with target.open('xb') as stream:stream.write(doc.tobytes(garbage=0,deflate=True))
            result.update({'output':str(target),'applied':True})
        def serial(v):
            if isinstance(v,dict):return {k:serial(x) for k,x in v.items()}
            if isinstance(v,(list,tuple,pymupdf.Point,pymupdf.Rect,pymupdf.Quad)):return [serial(x) for x in v]
            return v
        return serial(result)
