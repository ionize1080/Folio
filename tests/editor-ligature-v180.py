"""A real subset with ff but no standalone f: native and browser export."""
import sys,io,json,subprocess,base64,copy
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT/'tests'),str(ROOT/'native')]
from p8_helpers import models,save,OUT
from font_match import load_font
from fast_layout import font_data
from story import layout
from fontTools.ttLib import TTFont
from fontTools import subset
import fitz
from unittest.mock import patch
from type1_restore import restore_type1
class Glyph:
 width=600
 def draw(self,pen):
  pen.moveTo((20,0));pen.lineTo((20,700));pen.lineTo((500,700));pen.lineTo((500,0));pen.closePath()
class Type1Fixture:
 def __init__(self,*args):self.font={'FontMatrix':[.001,0,0,.001,0,0],'Encoding':['.notdef']*256,'FontInfo':{}}
 def parse(self):pass
 def __getitem__(self,key):return self.font[key]
 def getGlyphSet(self):return {n:Glyph() for n in ['.notdef','ff','f']}
with patch('fontTools.t1Lib.T1Font',Type1Fixture):
 restored,coverage=restore_type1(b'fixture',{'\x0b':'ff','f':'f'},'Synthetic',pdf_encoding={'/Differences':[11,'/ff',102,'/f']})
 assert {102,0xfb00}<=coverage
 assert TTFont(io.BytesIO(restored)).getBestCmap()[0xfb00]=='ff'
font=TTFont(ROOT/'native/fonts/DejaVuSans.ttf');sub=subset.Subsetter();sub.populate(text='\ufb00xz');sub.subset(font)
buf=io.BytesIO();font.save(buf);d=fitz.open();p=d.new_page();p.insert_font(fontname='Subset',fontbuffer=buf.getvalue());p.insert_text((50,80),'\ufb00x',fontname='Subset',fontsize=20);raw=d.tobytes()
_,ms=models(raw);m=ms[0];assert m['text']=='ffx';face=load_font(m['fontKey']);assert 102 not in face['coverage'] and 0xfb00 in face['coverage']
m['text']='ffz'
for fast in [False,True]:
 model=copy.deepcopy(m)
 if fast:
  data=font_data(m['fontKey'])
  code="""import {fastLayout} from './src/fast-layout.mjs';let s='';for await(const c of process.stdin)s+=c;const {model,data}=JSON.parse(s);const result=fastLayout(model,(ch,style)=>({width:(data.advances[ch.codePointAt(0)]||0)*style.size,fontKey:data.key,fallback:!data.coverage.includes(ch.codePointAt(0))}));console.log(JSON.stringify(result));"""
  model['fastLayout']=json.loads(subprocess.check_output(['node','--input-type=module','-e',code],input=json.dumps({'model':model,'data':data}).encode(),cwd=ROOT))
 result=layout(model);assert result['mappingComplete'] and not result['overflow']
 changed=save(raw,model,result=result)
 with fitz.open(stream=changed,filetype='pdf') as output:assert ''.join(output[0].get_text().split())=='ffz'
 _,again=models(changed);assert again[0]['text']=='ffz'
print('PASS: Type1 PDF encoding overrides and subset-only ff ligature survive native/browser editing, PDF save and reopen')
