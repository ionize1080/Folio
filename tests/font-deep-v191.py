"""Read-only corpus survey and substantial embedded-font editing regressions."""
import sys, json, base64, time, copy, subprocess, hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'native'),str(ROOT/'native/vendor')]
sys.stdout.reconfigure(encoding='utf-8')
import fitz, worker
from font_match import load_font
from story import layout

OUT=ROOT/'tests/output/deep-edit-v191-fonts'
OUT.mkdir(parents=True,exist_ok=True)
PAGES=[8,10,12,15,20,25,30,40,55,70]

def js(code,data):
    return json.loads(subprocess.check_output(['node','--input-type=module','-e',"let s='';for await(const c of process.stdin)s+=c;const v=JSON.parse(s);"+code],input=json.dumps(data).encode(),cwd=ROOT))

def inspect(raw):
    t=time.perf_counter();r=worker.run({'command':'inspect','bytes':base64.b64encode(raw).decode(),'page':1})
    models=js("import{pageCandidates}from'./src/flow-page-model.mjs';console.log(JSON.stringify(pageCandidates(v.objects,...v.size,[],v.tables).map(c=>c.model)))",r)
    return r,models,round(1000*(time.perf_counter()-t),2)

def survey():
    path=next(Path(r'D:\APP\PDF Samples').glob('*语文五年级下册.pdf'))
    original=path.read_bytes();rows=[]
    for n in PAGES:
        with fitz.open(stream=original,filetype='pdf') as source:
            d=fitz.open();d.insert_pdf(source,from_page=n-1,to_page=n-1);raw=d.tobytes();d.close()
        r,models,elapsed=inspect(raw)
        fonts={o.get('fontName'):{k:o.get(k) for k in ('fontKey','fontResolution','fontFallback','fontEmbedded')} for o in r['objects'] if o['type']=='text'}
        row={'page':n,'inspectMs':elapsed,'objects':len(r['objects']),'models':len(models),'fonts':fonts}
        rows.append(row)
        (OUT/f'p{n}-inspect.json').write_text(json.dumps(r,ensure_ascii=False),encoding='utf8')
        (OUT/f'p{n}-models.json').write_text(json.dumps(models,ensure_ascii=False),encoding='utf8')
        (OUT/f'p{n}-source.pdf').write_bytes(raw)
        print(json.dumps(row,ensure_ascii=False),flush=True)
    (OUT/'survey.json').write_text(json.dumps({'sha256':hashlib.sha256(original).hexdigest(),'pages':rows},ensure_ascii=False,indent=2),encoding='utf8')

def edit_model(m, text):
    return js("import{editStyles,editSoftBreaks}from'./src/flow-style.mjs';let m=v.model;const old=m.text;m.runs=editStyles(m.runs||[],old,v.text,m);m.softBreaks=editSoftBreaks(m.softBreaks||[],old,v.text);m.text=v.text;console.log(JSON.stringify(m));",{'model':m,'text':text})

def compact(text):return ''.join(text.split())

def edits():
    report={'scope':'10 original textbook pages; three independent page positions, four substantial operations per position. Original source files are never overwritten. Layout overflow and fallback are reported, never treated as exact-font preservation.','cases':[]}
    for n in PAGES:
        raw=(OUT/f'p{n}-source.pdf').read_bytes()
        allmodels=json.loads((OUT/f'p{n}-models.json').read_text(encoding='utf8'))
        candidates=[m for m in allmodels if len(m['text'])>=8 and m.get('fontName') and not str(m.get('writingMode','')).startswith('vertical')]
        selected=[candidates[0],candidates[len(candidates)//2],candidates[-1]]
        # Include previously unsupported original font faces even in short headings.
        if n==12:selected[0]=next(m for m in allmodels if m.get('fontName')=='FZKTK--GBK1-0')
        if n==15:selected[0]=next(m for m in allmodels if m.get('fontName')=='FZS3K--GBK1-0')
        if n==20:selected[0]=next(m for m in allmodels if m.get('fontName')=='FZHTJW--GB1-0')
        for pos,source in enumerate(selected):
            original=source['text'];start=max(0,min(len(original)-1,len(original)//3));count=min(18,max(1,len(original)//3))
            changes=[('insert-short',original[:start]+'补充'+original[start:]),
                     ('insert-long',original[:start]+'这段补充文字用于检查原文的字体、字号和段落位置。'+original[start:]),
                     ('delete-short',original[:start]+original[start+1:]),
                     ('delete-long',original[:start]+original[start+count:])]
            for operation,text in changes:
                case={'page':n,'position':pos,'operation':operation,'font':source.get('fontName'),'originalLength':len(original),'editedLength':len(text),'sourceText':original,'editedText':text}
                report['cases'].append(case)
                try:
                    model=edit_model(copy.deepcopy(source),text)
                    start_time=time.perf_counter();r=layout(model);case['layoutMs']=round(1000*(time.perf_counter()-start_time),2)
                    case.update({k:r.get(k) for k in ('mappingComplete','overflow','frameOverset','fallbackCount','fallbackDetails','layoutMode','engine','mappingReason')})
                    if not r.get('mappingComplete'):case['status']='mapping-incomplete';continue
                    # A fragment is a useful typography test even if added text cannot
                    # fit its original frame. Full-document save is tested only when it fits.
                    fragment=base64.b64decode(r['fragment'])
                    with fitz.open(stream=fragment,filetype='pdf') as d:
                        actual=compact(d[0].get_text())
                        case['fragmentTextExact']=actual==compact(text)
                        case['outputFonts']=sorted(set(f[3] for f in d[0].get_fonts()))
                    if not case['fragmentTextExact']:case['status']='fragment-text-mismatch';continue
                    if r.get('overflow'):case['status']='protected-overflow';continue
                    start_time=time.perf_counter()
                    result=worker.run({'command':'apply','bytes':base64.b64encode(raw).decode(),'edits':[{'page':1,'type':'flow','sources':model['sources'],'model':model,'fragment':r['fragment']}]})
                    saved=base64.b64decode(result['bytes']);case['saveMs']=round(1000*(time.perf_counter()-start_time),2)
                    ri,ms,reopen_ms=inspect(saved);case['reopenMs']=reopen_ms
                    case['reopenExact']=any(m['text']==text for m in ms)
                    case['status']='saved' if case['reopenExact'] else 'reopen-text-mismatch'
                    destination=OUT/f'p{n}-{pos}-{operation}.pdf';destination.write_bytes(saved)
                    if n in [12,15,20] and operation=='delete-short' and pos==0:
                        with fitz.open(stream=saved,filetype='pdf') as d:d[0].get_pixmap(matrix=fitz.Matrix(1.5,1.5)).save(str(destination.with_suffix('.png')))
                except Exception as error:case.update(status='error',error=type(error).__name__+': '+str(error))
                finally:
                    print(json.dumps({k:v for k,v in case.items() if k not in ('fallbackDetails','sourceText','editedText','outputFonts')},ensure_ascii=False),flush=True)
                    (OUT/'editing-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    from collections import Counter
    print(json.dumps({'total':len(report['cases']),'status':Counter(c['status'] for c in report['cases'])},ensure_ascii=False))

if __name__=='__main__':
    if '--edits' in sys.argv:edits()
    else:survey()
