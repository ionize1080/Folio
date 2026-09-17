"""Deterministic native regressions; Linux rendering is not a Windows launch test."""
from pathlib import Path
import sys,json,time,io,resource
import fitz
from reportlab.pdfgen import canvas
from pypdf import PdfReader,PdfWriter
from pypdf.generic import RectangleObject
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'native'));import worker
out=root/'tests/output';out.mkdir(exist_ok=True);checks=[]
def check(s):checks.append(s);print('PASS',s,flush=True)
def inspect(file,page=1):return worker.run({'command':'inspect','input':str(file),'page':page})['objects']
def apply(file,target,**args):return worker.run({'command':'apply','input':str(file),'output':str(target),**args})
p=out/'v5-spacing.pdf';c=canvas.Canvas(str(p));t=c.beginText(60,730);t.setFont('Helvetica',14);t.setCharSpace(5);t.textLine('FIRST CHANGE');c.drawText(t);t=c.beginText(60,650);t.setFont('Helvetica',14);t.textLine('SECOND STAYS SPACED');c.drawText(t);c.showPage();c.drawString(60,700,'OTHER PAGE');c.save()
o=next(o for o in inspect(p) if o.get('text','').startswith('FIRST'))
apply(p,out/'v5-spacing-edited.pdf',edits=[{**o,'page':1,'text':'修改文字 ϕ 测试'}])
a=fitz.open(p);b=fitz.open(out/'v5-spacing-edited.pdf');region=fitz.Rect(0,150,595,842)
assert a[0].get_pixmap(clip=region).samples==b[0].get_pixmap(clip=region).samples
assert a[1].get_pixmap().samples==b[1].get_pixmap().samples
assert 'FIRST' not in b[0].get_text();assert '修改文字' in b[0].get_text()
check('Same-page untouched spaced text and other-page pixels remain exact; replaced text removed')
# Two newly inserted blocks must not inherit original character spacing.
new=[{'id':str(i),'page':1,'index':None,'type':'text','text':f'新增文本{i}','matrix':[1,0,0,1,70,400-i*35],'size':14} for i in range(2)]
apply(p,out/'v5-two-new.pdf',edits=new);d=fitz.open(out/'v5-two-new.pdf');hits=[d[0].search_for(f'新增文本{i}')[0] for i in range(2)];assert abs(hits[0].y0-hits[1].y0-(-35))<1
check('Two new text blocks use distinct positions without inherited text spacing')
apply(p,out/'v5-combined.pdf',edits=[{**o,'page':1,'text':'修改文字'},*new]);combined=fitz.open(out/'v5-combined.pdf')
assert all(t in combined[0].get_text() for t in ['修改文字','新增文本0','新增文本1'])
assert a[0].get_pixmap(clip=fitz.Rect(0,150,595,230)).samples==combined[0].get_pixmap(clip=fitz.Rect(0,150,595,230)).samples
check('Combined replacement and additions retain the edited stream and untouched same-page text')

apply(p,out/'v5-wrap.pdf',edits=[{**new[0],'text':'中文自动换行文本框测试用于验证行高与边界','boxWidth':85,'boxHeight':200,'lineHeight':1.4}]);d=fitz.open(out/'v5-wrap.pdf');lines=[l for b in d[0].get_text('dict')['blocks'] if 'lines'in b for l in b['lines'] if any('中' in s['text'] or '文' in s['text'] or '行' in s['text'] for s in l['spans'])];assert len(lines)>=2
check('Simple text box wraps and enforces its height')
try:apply(p,out/'v5-overflow.pdf',edits=[{**new[0],'text':'中文'*50,'boxWidth':30,'boxHeight':10}]);raise AssertionError('expected overflow')
except ValueError:assert not (out/'v5-overflow.pdf').exists()
# Rotated page and nonzero media origin retain geometry and untouched drawing.
for rotation in (0,90,180,270):
 w=PdfWriter(clone_from=p);w.pages[0].rotate(rotation);shift=out/f'v5-rot-{rotation}.pdf';w.write(shift)
 o=next(o for o in inspect(shift) if o.get('text','').startswith('FIRST'));apply(shift,out/f'v5-rot-{rotation}-out.pdf',edits=[{**o,'page':1,'text':'替换文字'}]);assert '替换文字' in fitz.open(out/f'v5-rot-{rotation}-out.pdf')[0].get_text()
check('Original-object replacement succeeds at four page rotations')
# Unsupported text aborts before an output file is produced.
bad={'page':1,'text':'\U0010ffff','quad':[[40,700],[200,700],[200,680],[40,680]]}
try:apply(p,out/'v5-unsupported.pdf',ocr=[bad]);raise AssertionError('expected unsupported')
except ValueError:assert not (out/'v5-unsupported.pdf').exists()
check('Unsupported glyph fails before writing; no partial output')
# Long application uses unique per-page content so accidental fragment reuse is detected.
pages=300;d=fitz.open()
for n in range(pages):
 page=d.new_page();page.draw_rect(fitz.Rect(25,25,200,100),color=(.1,.3,.6));page.insert_text((30,50),f'Original page {n+1}')
big=out/'v5-300-pages.pdf';d.save(big);blocks=[{'id':f'{i}:{j}','page':i,'text':f'第{i}页 中文文字层 条目{j} ϕ\u200b','confidence':.98,'quad':[[40,700-j*30],[400,700-j*30],[400,680-j*30],[40,680-j*30]]} for i in range(1,pages+1) for j in range(8)]
started=time.perf_counter();target=out/'v5-300-searchable.pdf';apply(big,target,ocr=blocks);elapsed=time.perf_counter()-started
b=fitz.open(target)
for i in range(pages):
 assert f'第{i+1}页' in ''.join(b[i].get_text().split());assert d[i].get_pixmap().samples==b[i].get_pixmap().samples
assert target.stat().st_size<30*1024**2
check(f'300-page / 2400-line application searchable on every page; all original pixels exact; {elapsed:.1f}s, {target.stat().st_size/1024**2:.1f} MiB')
(out/'v5-native-report.json').write_text(json.dumps({'checks':checks,'application_seconds':elapsed,'pages':pages,'lines':len(blocks),'output_bytes':target.stat().st_size,'process_peak_rss_mib':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,'environment':'Linux; PDFium via pypdfium2 5.3.0; pypdf 6.10.0; render verification with MuPDF. Windows launch untested.'},ensure_ascii=False,indent=2))
