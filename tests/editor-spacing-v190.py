"""Legal CJK half-width punctuation tracking and negative-advance boundaries."""
from pathlib import Path
import sys,json,copy,base64
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'tests'),str(ROOT/'native'),str(ROOT/'native/vendor')]
import fitz
from story import layout
from p8_helpers import save,models,OUT
checks=[]
def model(size,spacing,text='中文：标点；压缩'):
    return dict(text=text,softBreaks=[],sources=[],pageWidth=400,pageHeight=300,
        frame=dict(x=30,y=30,width=330,height=200),size=size,lineHeight=1.4,paragraphGap=0,
        columns=1,gap=18,align='left',color='#202020',font='sans',layoutMode='reflow',
        runs=[dict(start=2,end=3,size=size,charSpacing=spacing),dict(start=5,end=6,size=size,charSpacing=spacing)])
doc=fitz.open();doc.new_page(width=400,height=300);raw=doc.tobytes();doc.close()
for size in [10.5,24]:
    m=model(size,-size/2);r=layout(m);assert r['mappingComplete'] and not r['overflow']
    saved=save(raw,m,result=r)
    with fitz.open(stream=saved,filetype='pdf')as pdf:assert ''.join(pdf[0].get_text().split())==m['text']
    _,ms=models(saved);assert any(p['text']==m['text'] for p in ms)
    checks.append('CJK punctuation at %s pt accepts -0.5 em spacing and saves/reopens exact text'%size)
for bad in [float('nan'),float('inf'),-1000,31]:
    try:layout(model(10.5,bad))
    except ValueError:pass
    else:raise AssertionError('invalid tracking accepted: '+str(bad))
checks.append('nonfinite and out-of-range tracking remains rejected')
m=model(10.5,-10.5,'ABiDEF');m['runs']=[dict(start=2,end=3,size=10.5,charSpacing=-10.5)]
try:layout(m)
except ValueError as error:assert '字符宽度' in str(error),str(error)
else:raise AssertionError('negative used-glyph advance silently clamped')
checks.append('tracking that would make a used glyph advance negative is rejected')
report={'checks':checks,'errors':[]};(OUT/'v190-spacing-report.json').write_text(json.dumps(report,indent=2),encoding='utf8')
print(json.dumps(report))
