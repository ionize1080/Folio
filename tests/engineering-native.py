import sys,pathlib,base64,io,json
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'native'))
import fitz,pikepdf
from font_tools import process as font
from document_utilities import process
OUT=ROOT/'tests/output';OUT.mkdir(exist_ok=True)
def call(action,path,**options):return process({'input':str(path),'action':action,'options':options})
def save(r,name):
 p=OUT/name;p.write_bytes(base64.b64decode(r['bytes']));return p
checks=[]
key='builtin-latin';info=font({'action':'inspect','options':{'fontKey':key}});assert info['glyphs']>100
assert font({'action':'coverage','options':{'fontKey':key,'text':'Hello'}})['complete']
assert not font({'action':'coverage','options':{'fontKey':key,'text':'汉'}})['complete']
before=font({'action':'metrics','options':{'fontKey':key,'text':'Hello'}})
sub=font({'action':'subset','options':{'fontKey':key,'text':'Hello'}})
after=font({'action':'metrics','options':{'fontKey':sub['fontKey'],'text':'Hello'}})
assert [x['advance'] for x in before['glyphs']]==[x['advance'] for x in after['glyphs']]
assert font({'action':'outlines','options':{'fontKey':key,'text':'A'}})['glyphs'][0]['path']
assert base64.b64decode(font({'action':'preview','options':{'fontKey':key,'text':'Hello'}})['image']).startswith(b'\x89PNG')
gid=before['glyphs'][0]['glyphId'];repair=font({'action':'repair-cmap','options':{'fontKey':key,'mapping':{'65':gid}}})
assert font({'action':'metrics','options':{'fontKey':repair['fontKey'],'text':'A'}})['glyphs'][0]['advance']==before['glyphs'][0]['advance']
checks.append('font coverage, metrics, outlines, preview, subset and cmap preserve advances')
source=OUT/'engineering-source.pdf';d=fitz.open();d.new_page().insert_text((60,70),'Visible layer content');d.new_page().insert_text((60,70),'Page two');d.save(source);d.close()
layered=save(call('layers',source,operation='create',name='Review layer',pages=[1]),'engineering-layers.pdf')
layers=call('layers',layered)['layers'];assert len(layers)==1;lid=layers[0]['id']
hidden=save(call('layers',layered,operation='configure',changes=[{'id':lid,'visible':False,'name':'Hidden review'}]),'engineering-hidden.pdf')
assert not call('layers',hidden)['layers'][0]['visible']
visible=call('render-page',layered,page=1,dpi=72);invisible=call('render-page',hidden,page=1,dpi=72)
assert visible['image']!=invisible['image']
override=call('render-page',layered,page=1,dpi=72,layers={lid:False});assert override['image']==invisible['image']
crop=call('render-page',layered,page=1,dpi=144,region=[0,0,.5,.5]);assert abs(crop['width']-visible['width'])<=1
checks.append('OCG creation/state persisted, hidden pixels disappear, region rendering and override verified')
with pikepdf.open(source) as p:
 root=p.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.StructTreeRoot));p.Root.StructTreeRoot=root
 first=p.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.StructElem,S=pikepdf.Name.Figure,P=root,Pg=p.pages[0].obj,K=0))
 second=p.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.StructElem,S=pikepdf.Name.P,P=root,Pg=p.pages[1].obj,K=0))
 root.K=pikepdf.Array([first,second]);p.Root.MarkInfo=pikepdf.Dictionary(Marked=True);p.save(OUT/'engineering-tagged.pdf')
tagged=OUT/'engineering-tagged.pdf';tree=call('tags',tagged);assert any(x['code']=='missing-alt' for x in tree['issues'])
figure=next(x for x in tree['nodes'] if x['role']=='Figure')
patched=save(call('tags',tagged,operation='patch',language='en-US',title='Accessible test',changes=[{'id':figure['id'],'alt':'A layer test'}]),'engineering-tagged-patched.pdf')
assert not call('tags',patched)['issues']
nodes=call('tags',patched)['nodes'];root=nodes[0]
reordered=save(call('tags',patched,operation='reorder',parent=root['id'],ids=list(reversed(root['children']))),'engineering-reordered.pdf')
assert call('tags',reordered)['nodes'][1]['role']=='P'
ua=call('validate-pdfua',patched,standard='ua1');assert not ua['compliant'] and ua['standard']=='PDF/UA-1' and ua['failures']
checks.append('tag attributes/language/title/reordering persist; invalid tagged document fails independent PDF/UA')
for standard in ('x1a','x3','x4'):
 r=call('pdfx',source,standard=standard);assert r['validation']['preflightPassed'] and r['validation']['compliant'] is None
 save(r,'engineering-'+standard+'.pdf');checks.append('PDF/X '+standard+' generation and partial preflight')
assert not call('preflight-pdfx',source)['preflightPassed']
(OUT/'engineering-native-report.json').write_text(json.dumps({'status':'passed','checks':checks},ensure_ascii=False,indent=2),encoding='utf-8')
print('PASS',*checks,sep='\n')
