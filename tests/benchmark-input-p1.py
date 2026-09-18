import sys,io,json,time,hashlib,logging
from pathlib import Path
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'native'))
import fitz
from fontTools.ttLib import TTFont
from fontTools import subset
from font_match import CACHE
from story import layout
logging.getLogger('fontTools').setLevel(logging.ERROR)
text='字体分析测试这是原来的中文段落。我们需要保留字体和字形以及位置。'
font=TTFont(root/'native/fonts/NotoSansSC.ttf');s=subset.Subsetter();s.populate(text=text);s.subset(font);b=io.BytesIO();font.save(b);font.close();blob=b.getvalue();key=hashlib.sha256(blob).hexdigest()[:32]
CACHE.mkdir(exist_ok=True);(CACHE/(key+'.ttf')).write_bytes(blob);(CACHE/(key+'.json')).write_text(json.dumps({'name':'QA subset','coverage':list(map(ord,text))}))
m=dict(text=text*6,fontKey=key,fontName='QA subset',pageWidth=595,pageHeight=842,frame=dict(x=50,y=50,width=470,height=650),size=12,lineHeight=1.4,align='left',color='#202020')
results=[]
for ch in ['', '新', '增','输','入','效','率']:
 m['text']+=ch;t=time.perf_counter();r=layout(m);results.append(dict(character=ch or 'initial',ms=round((time.perf_counter()-t)*1000,2),complete=r['mappingComplete'],fallback=r['fallbackCount']))
print(json.dumps(results,ensure_ascii=False))
