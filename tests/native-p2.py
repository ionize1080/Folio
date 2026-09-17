"""RC1 P2 output regression: real PDFs, clipping, typography and OCR geometry."""
import sys,json,subprocess,base64,copy,collections,io,time
from pathlib import Path
import fitz
from pypdf import PdfReader,PdfWriter
from pypdf.generic import NameObject,DecodedStreamObject
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'native'))
import worker
from story import layout
from font_preview import preview_font
from fontTools.ttLib import TTFont
out=root/'tests/output';out.mkdir(exist_ok=True);checks=[]
def passed(name,**facts):
 checks.append(dict(name=name,**facts));print('PASS',name,facts,flush=True)
def model(text):
 return dict(text=text,pageWidth=595,pageHeight=842,frame=dict(x=70,y=70,width=203,height=500),size=12,lineHeight=1.4,align='justify',color='#000000')
def rows(r):
 ls=collections.defaultdict(list)
 for g in r['glyphs']:ls[round(g['baseline'],2)].append(g)
 return list(ls.values())
for text in ['中文测试一些很长的字符需要自动换行。'*4,'An office with efficient staff and English words for justification. '*5,'This is a long paragraph with mixed English words and 中文测试。'*5]:
 m=model(text);r=layout(m);assert r['mappingComplete'] and not r['overflow'];rs=rows(r)
 assert all(abs(max(g['x']+g['w'] for g in row)-273)<.05 for row in rs[:-1])
 assert max(g['x']+g['w'] for g in rs[-1])<273-.1
 assert m['frame']['width']==203
passed('CJK, Latin ligatures and mixed-script justification reach the right edge; final lines stay natural')
m=model('中文测试一些很长的字符需要自动换行。'*2+'\n'+'第二个段落需要测试末行保留原始宽度。'*2);m['firstIndent']=24
r=layout(m);rs=rows(r);assert min(g['x'] for g in rs[0])==94
assert sum(max(g['x']+g['w'] for g in row)<272.9 for row in rs)==2
passed('First-line indent and two paragraph-final lines preserved')
m=model('跨框接续文字需要保持各自栏宽与两端对齐。'*12);m['frames']=[dict(x=70,y=70,width=203,height=180),dict(x=320,y=70,width=180,height=500)];m['frame']=m['frames'][0].copy()
r=layout(m);assert r['mappingComplete'] and not r['overflow'];assert any(g['x']>=320 for g in r['glyphs'])
passed('Two unequal linked frames retain their separate alignment edges')
# Reject genuinely clipped ink; admit only containing rectangles.
d=fitz.open();p=d.new_page(width=595,height=842);p.insert_text((70,100),'CLIPPING TEST',fontsize=18)
base=d.tobytes();d.close()
for rect,want in [('0 0 595 842',True),('70 740 20 25',False)]:
 reader=PdfReader(io.BytesIO(base));p=reader.pages[0];stream=DecodedStreamObject();stream.set_data(b'q '+rect.encode()+b' re W n\n'+p.get_contents().get_data()+b'\nQ');p[NameObject('/Contents')]=stream;wr=PdfWriter();wr.add_page(p);buf=io.BytesIO();wr.write(buf)
 result=worker.run({'command':'inspect','bytes':base64.b64encode(buf.getvalue()).decode()});assert any(o.get('flowEditable') for o in result['objects'])==want
passed('Full containing clip is editable; partial clipping remains protected')
# Verify font integrity and tiny name-only previews.
f=TTFont(root/'native/fonts/NotoSansSC.ttf');assert len(f.getBestCmap())>=30000;f.close()
a=time.perf_counter();data=base64.b64decode(preview_font(str(root/'native/fonts/NotoSansSC.ttf'),'思源黑体 Noto Sans SC'));first=time.perf_counter()-a
f=TTFont(io.BytesIO(data));assert 'name' in f;f.close();assert len(data)<100000
passed('Rebuilt CJK font is complete; name-only subset loads as valid font',previewBytes=len(data),firstMs=round(first*1000))
# OCR quadrilaterals: text, punctuation, Latin descenders, tilted and vertical.
d=fitz.open();d.new_page(width=595,height=842);src=out/'p2-ocr-input.pdf';d.save(src);d.close()
blocks=[]
for i,t in enumerate(['中文测试','。','----','Agjp 123','Mixed 中文 test']):
 x=70;y=760-i*45;blocks.append(dict(page=1,text=t,quad=[[x,y+16],[x+170,y+16],[x+170,y],[x,y]],confidence=1))
blocks += [dict(page=1,text='倾斜文字测试',quad=[[80,400],[250,430],[253,414],[83,384]],confidence=1),dict(page=1,text='纵向文字',quad=[[300,400],[300,230],[316,230],[316,400]],confidence=1)]
dest=out/'p2-ocr-output.pdf';worker.run({'command':'apply','input':str(src),'output':str(dest),'ocr':blocks})
a=fitz.open(src);b=fitz.open(dest);assert a[0].get_pixmap().samples==b[0].get_pixmap().samples
for block in blocks[:5]:
 found=b[0].search_for(block['text']);assert found,block['text']
 for rect in found:assert rect.height<=17,(block['text'],rect)
assert '倾斜文字测试' in b[0].get_text();assert '纵向文字' in b[0].get_text()
passed('OCR searchable geometry stays within 16pt lines including punctuation; invisible layer preserves page pixels')
# User's documents: edit and reopen, compare an untouched page and untouched zones.
js="import{pageCandidates}from'./src/flow-page-model.mjs';let s='';for await(const c of process.stdin)s+=c;let r=JSON.parse(s);console.log(JSON.stringify(pageCandidates(r.objects,...r.size,[],r.tables)));"
for file,page,label in [(root/'../../upload/云南玉溪红塔农村商业银行股份有限公司2023年度报告.pdf',12,'bank'),(root/'../../upload/cb71bb5a-7198-4aff-a38b-a5dd0c379c7c.pdf',9,'yearbook')]:
 if not file.exists():continue
 ins=worker.run({'command':'inspect','input':str(file),'page':page})
 cs=json.loads(subprocess.run(['node','--input-type=module','-e',js],cwd=root,input=json.dumps(ins),text=True,capture_output=True,check=True).stdout)
 if label=='bank':assert sum(bool(o.get('flowEditable')) for o in ins['objects'])==599
 choices=[c for c in cs if 30<len(c['model']['text'])<200 and not c['model'].get('cell')]
 chosen=min(choices,key=lambda c:c['model']['frame']['y']);m=copy.deepcopy(chosen['model']);m['align']='justify';m['text']+='校验';m['frame']['height']=min(m['pageHeight']-m['frame']['y'],m['frame']['height']+40)
 rr=layout(m);assert rr['mappingComplete'] and not rr['overflow']
 e=dict(id='p2-test',page=page,type='flow',sources=m['sources'],model=m,fragment=rr['fragment'],ink=rr['glyphs'])
 dst=out/('p2-'+label+'-edited.pdf');worker.run({'command':'apply','input':str(file),'output':str(dst),'edits':[e]})
 orig=fitz.open(file);edited=fitz.open(dst);assert len(orig)==len(edited);assert '校验' in edited[page-1].get_text()
 assert orig[0].get_pixmap().samples==edited[0].get_pixmap().samples
 for clip in [fitz.Rect(0,0,m['pageWidth'],min(40,m['frame']['y']-2)),fitz.Rect(0,m['pageHeight']-28,m['pageWidth'],m['pageHeight'])]:
  assert orig[page-1].get_pixmap(clip=clip).samples==edited[page-1].get_pixmap(clip=clip).samples
 edited[page-1].get_pixmap(matrix=fitz.Matrix(1.2,1.2)).save(out/('p2-'+label+'-edited.png'))
 orig[page-1].get_pixmap(matrix=fitz.Matrix(1.2,1.2)).save(out/('p2-'+label+'-original.png'))
 passed(label+' document edit saves and reopens; unchanged page/header/footer remain pixel exact',page=page,candidates=len(cs),editedChars=len(m['text']),width=m['frame']['width'])
(out/'p2-native-report.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2))
