"""One-page font discovery for the disposable, low-priority idle worker."""
from pathlib import Path
import io

_document=None
_identity=None
_seen=set()


def scan(args):
    import pikepdf
    from font_match import inspect_fonts
    from pypdf.generic import ContentStream
    global _document,_identity,_seen
    path=Path(args['input']);stat=path.stat();identity=(str(path),stat.st_mtime_ns,stat.st_size)
    if _identity!=identity:
        if _document is not None:_document.close()
        _document=pikepdf.open(path);_identity=identity;_seen=set()
    page=int(args.get('page',1))
    if not 1<=page<=len(_document.pages):raise ValueError('页码无效')
    refs={};visited=set()
    def discover(resources,depth=0):
        if depth>32:return
        for font in resources.get('/Font',{}).values():
            if font.objgen!=(0,0):refs[font.objgen]=font
        for obj in resources.get('/XObject',{}).values():
            if obj.get('/Subtype')!=pikepdf.Name.Form or obj.objgen in visited:continue
            visited.add(obj.objgen);discover(obj.get('/Resources',{}),depth+1)
    discover(_document.pages[page-1].resources)
    fonts=[]
    if refs.keys()-_seen:
        # Copy only font resources into a blank page. A scanned page may have
        # hundreds of MB of images: never decode or copy those for font warmup.
        # Include sibling Type3 subsets so its canonical font key matches edit.
        with pikepdf.Pdf.new() as selected:
            pg=selected.add_blank_page();table=pikepdf.Dictionary()
            for i,font in enumerate(refs.values()):table[f'/F{i}']=selected.copy_foreign(font)
            pg.obj.Resources=pikepdf.Dictionary(Font=table)
            buffer=io.BytesIO();selected.save(buffer);raw=buffer.getvalue()
        fonts=list(inspect_fonts(raw,1,[],[],ContentStream(None,None)).values())
        _seen.update(refs)
    from worker import sample_memory
    return {'fonts':fonts,'pages':len(_document.pages),'memoryBytes':sample_memory()}


def warm(args):
    from font_similarity import recommend,trim_cache
    from worker import sample_memory
    fonts=recommend(args.get('fontKey'),'中' if args.get('script')=='cjk' else '')
    if fonts:
        from system_fonts import select_font
        selected=select_font(fonts[0]['id'])
        # Persist browser-compatible outlines too; glyph sanitizing a full CJK
        # face must not be repeated in the foreground when editing starts.
        from fast_layout import font_data
        font_data(selected['fontKey'])
    trim_cache()
    return {'fonts':fonts,'memoryBytes':sample_memory()}
