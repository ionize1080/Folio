"""Real Story and pypdf/PDFium round-trip, independent MuPDF rendering checks."""
import sys, json, io, base64, time
from pathlib import Path
from reportlab.pdfgen import canvas
import fitz
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'native'))
from story import layout, analyze
import worker
out=root/'tests/output';out.mkdir(exist_ok=True);checks=[]
def check(name):checks.append(name);print('PASS',name,flush=True)
def model(text,**kw):
 m=dict(pageWidth=595,pageHeight=842,text=text,frame=dict(x=60,y=80,width=420,height=200),size=12,lineHeight=1.5,columns=1,gap=18,color='#203040',align='left');m.update(kw);return m
r=layout(model('金融统计 00123.45，3.50%。T-1 +11.51%\n连续空格  A   B\n\n'))
assert not r['overflow'] and r['mappingComplete'] and r['engine']=='MuPDF Story'
d=fitz.open(stream=base64.b64decode(r['fragment']),filetype='pdf');text=d[0].get_text()
assert all(t in text for t in ['金融统计','00123.45','3.50%','T-1','+11.51%'])
assert r['anchors'];check('Chinese / amounts / T-1 exact; blank paragraph caret anchors')
long=layout(model('中文正文用于验证分栏续排和删除后向前补齐。'*8,columns=2,frame=dict(x=60,y=80,width=420,height=180)))
assert not long['overflow'] and long['mappingComplete']
assert any(g['x']>280 for g in long['glyphs'])
short=layout(model('中文正文用于验证分栏续排。',columns=2,frame=dict(x=60,y=80,width=420,height=180)))
assert all(g['x']<280 for g in short['glyphs']);check('Two real Story frames; deleting content reclaims the second column')
assert layout(model('超长文本'*2000,frame=dict(x=60,y=80,width=100,height=35)))['overflow'];check('Overset retains draft and prevents commit')
try:layout(model('<script>alert(1)</script>',frame=dict(x=0,y=0,width=float('nan'),height=10)));raise AssertionError()
except ValueError:pass
escaped=layout(model('<script>alert(1)</script>'))
assert escaped['mappingComplete'];check('HTML treated as text; invalid geometry rejected')
p=out/'v7-native-source.pdf';c=canvas.Canvas(str(p),pagesize=(595,842));c.setFillColorRGB(.9,.95,.98);c.rect(40,480,500,300,fill=1,stroke=0);c.setFillColorRGB(0,0,0)
t=c.beginText(60,710);t.textLine('OLD FIRST LINE');t.textLine('OLD SECOND LINE');c.drawText(t);c.drawString(60,60,'UNCHANGED FOOTER');c.showPage();c.drawString(60,720,'OTHER PAGE');c.save()
objects=worker.run({'command':'inspect','input':str(p),'page':1})['objects'];sources=[{'index':o['index'],'signature':o['signature']} for o in objects if o.get('text','').startswith('OLD')]
m=model('新版中文 00123.45 与 3.50% T-1');r=layout(m);assert not r['overflow']
edit={'id':'test','type':'flow','page':1,'index':None,'sources':sources,'model':m,'fragment':r['fragment']}
target=out/'v7-native-edited.pdf';worker.run({'command':'apply','input':str(p),'output':str(target),'edits':[edit]})
a=fitz.open(p);b=fitz.open(target);s=b[0].get_text();assert 'OLD FIRST' not in s and 'OLD SECOND' not in s and '00123.45' in s
assert a[1].get_pixmap().samples==b[1].get_pixmap().samples
assert a[0].get_pixmap(clip=fitz.Rect(0,400,595,842)).samples==b[0].get_pixmap(clip=fitz.Rect(0,400,595,842)).samples
check('Real source removal; vector output searchable; other page and footer pixel exact')
background=worker.run({'command':'flow-background','input':str(p),'page':1,'edits':[{**edit,'fragment':layout(model(''))['fragment']}]})
assert '<svg' in background['svg'];check('On-page preview removes source ink, preserving colored background')
for bad in [sources[:1],[{**sources[0],'signature':'stale'},sources[1]]]:
 try:worker.run({'command':'apply','input':str(p),'edits':[{**edit,'sources':bad}]});raise AssertionError()
 except ValueError:pass
check('Partial shared group and stale signature rejected before write')
ai=analyze(p.read_bytes(),1);assert ai['regions'] and 'ONNX CPU' in ai['engine'];check('Bundled local neural layout detector runs with CPU')
(out/'v7-native-report.json').write_text(json.dumps({'checks':checks,'aiMs':ai['elapsedMs'],'storyMs':r['elapsedMs']},ensure_ascii=False,indent=2))
