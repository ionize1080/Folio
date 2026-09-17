from pathlib import Path
import sys,json,io,base64,time
from reportlab.pdfgen import canvas
from pypdf import PdfReader,PdfWriter
import fitz
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'native'));import worker
out=root/'tests/output';checks=[]
def check(s):checks.append(s);print('PASS',s,flush=True)
p=out/'v6-flow-source.pdf';c=canvas.Canvas(str(p),pagesize=(595.28,841.89));c.setFont('Helvetica',12);t=c.beginText(60,710);t.textLine('OLD FIRST LINE');t.textLine('OLD SECOND LINE');c.drawText(t);c.drawString(60,100,'UNCHANGED FOOTER');c.showPage();c.drawString(60,700,'UNCHANGED OTHER PAGE');c.save()
objects=worker.run({'command':'inspect','input':str(p),'page':1})['objects'];sources=[{'index':o['index'],'signature':o['signature']} for o in objects if o.get('text','').startswith('OLD')];assert len(sources)==2
fragment=base64.b64encode((out/'v6-flow-fragment.pdf').read_bytes()).decode()
flow={'id':'flow1','page':1,'type':'flow','index':None,'sources':sources,'fragment':fragment}
def apply(edits,target):return worker.run({'command':'apply','input':str(p),'output':str(target),'edits':edits})
target=out/'v6-flow-edited.pdf';started=time.perf_counter();apply([flow],target);elapsed=time.perf_counter()-started
old=fitz.open(p);new=fitz.open(target);text=''.join(new[0].get_text().split());assert 'OLDFIRST' not in text and 'OLDSECOND' not in text;assert '00123.45' in text and '3.50%' in text and '金融统计' in text
assert old[0].get_pixmap(clip=fitz.Rect(0,650,595,842)).samples==new[0].get_pixmap(clip=fitz.Rect(0,650,595,842)).samples
assert old[1].get_pixmap().samples==new[1].get_pixmap().samples
check('Shared BT paragraph fully replaced; Chinese, amounts and percentage searchable; other regions/pages pixel exact')
try:apply([{**flow,'sources':sources[:1]}],out/'v6-bad.pdf');raise AssertionError('Expected shared group rejection')
except ValueError:check('Partial shared text group rejected before writing')
try:apply([{**flow,'sources':[{**sources[0],'signature':'stale'},sources[1]]}],out/'v6-stale.pdf');raise AssertionError('Expected signature rejection')
except ValueError:check('Stale source signature rejected')
apply([{**flow,'fragment':base64.b64encode((out/'v6-flow-short.pdf').read_bytes()).decode()}],out/'v6-flow-reedited.pdf');d=fitz.open(out/'v6-flow-reedited.pdf');text=d[0].get_text();assert '中文更新' in text and '00123.45' not in text
check('Re-edit rebuilt from original once; previous flow text does not remain')
(out/'v6-native-report.json').write_text(json.dumps({'checks':checks,'composeMs':elapsed*1000},ensure_ascii=False,indent=2))
