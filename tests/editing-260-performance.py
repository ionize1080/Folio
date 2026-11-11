"""Measured latency with separate processes; timing is evidence, not a CI limit."""
import json,os,pathlib,subprocess,sys,tempfile,time
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT/'native'),str(ROOT/'native/vendor'),str(ROOT/'tests')]
sys.stdout.reconfigure(encoding='utf-8')
def query(key,missing):
    from font_similarity import recommend
    from system_fonts import select_font
    from fast_layout import font_data
    t=time.perf_counter();matches=recommend(key,missing);rank=(time.perf_counter()-t)*1000
    assert matches
    t=time.perf_counter();selected=select_font(matches[0]['id']);selection=(time.perf_counter()-t)*1000
    t=time.perf_counter();data=font_data(selected['fontKey']);browser=(time.perf_counter()-t)*1000
    return {'required':missing,'recommendMs':round(rank,2),'selectionMs':round(selection,2),'browserFontMs':round(browser,2),'fontKey':data['key'],'top':matches[0]}
if len(sys.argv)>1 and sys.argv[1]=='--query':print(json.dumps(query(*sys.argv[2:]),ensure_ascii=False))
else:
    import worker,fitz
    from glyph_writer import GlyphWriter
    from p8_helpers import models
    path=pathlib.Path(sys.argv[1]);data,paragraphs=models(path.read_bytes(),2)
    key=next(o['fontKey'] for o in data['objects'] if 'SimSun' in o.get('fontName','') and o.get('fontKey'))
    cache=tempfile.mkdtemp(prefix='folio-benchmark-260-');env={**os.environ,'PYTHONUTF8':'1','FOLIO_FONT_MATCH_CACHE':cache}
    results=[]
    for missing in ('测','试'):
        results.append(json.loads(subprocess.check_output([sys.executable,__file__,'--query',key,missing],env=env)))
    assert results[0]['top']==results[1]['top']
    font=str(ROOT/'native/fonts/DejaVuSans.ttf');timings={}
    for mode in ('perGlyph','batch'):
        doc=fitz.open();pg=doc.new_page(width=600,height=800);start=time.perf_counter()
        if mode=='batch':writer=GlyphWriter(pg)
        else:pg.insert_font(fontname='F',fontfile=font)
        for i in range(500):
            x=30+(i%40)*12;y=40+(i//40)*18;ch='Folio'[i%5]
            if mode=='batch':writer.add(ch,ch,font,x,y,12,(0,0,0))
            else:pg.insert_text((x,y),ch,fontsize=12,fontname='F')
        if mode=='batch':writer.finish()
        timings[mode]={'ms':round((time.perf_counter()-start)*1000,2),'streams':len(pg.get_contents())};doc.close()
    report={'scope':'Fresh scoring cache, same installed fonts, two independent Python processes; full font programs may already be cached. Glyph timing excludes PDF serialization.','font':results,'glyph500':timings,'cache':cache}
    (ROOT/'tests/output/editing-260-performance.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False))
