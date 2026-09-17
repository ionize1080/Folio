from pathlib import Path
import sys,json,time,fitz
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'native'));import worker
out=root/'tests/output';out.mkdir(exist_ok=True);checks=[]
def check(s):checks.append(s);print('PASS',s,flush=True)
sample=root/'assets/Folio-Sample.pdf';r=worker.run({'command':'inspect','input':str(sample),'page':1});t=next(o for o in r['objects'] if o['type']=='text' and o['editable']);p=next(o for o in r['objects'] if o['type']=='path' and o['editable']);edits=[{**t,'page':1,'text':'Folio 中文编辑测试'},{**p,'page':1,'fill':[220,35,50,255]}];worker.run({'command':'apply','input':str(sample),'output':str(out/'v3-objects.pdf'),'edits':edits});a=fitz.open(sample);b=fitz.open(out/'v3-objects.pdf');assert '中文编辑测试' in b[0].get_text() and t['text'] not in b[0].get_text();assert a[0].get_pixmap().samples!=b[0].get_pixmap().samples;assert a[1].get_pixmap().samples==b[1].get_pixmap().samples;check('Native text/path edit; unchanged page pixel preservation')
try:worker.run({'command':'apply','input':str(sample),'edits':[{**edits[0],'signature':'bad'}]});raise AssertionError('Expected stale identity rejection')
except ValueError:pass
check('Stale object identity rejected')
ref=root.parent/'upload/20_WD_2025002892_国民经济行业分类-original.pdf';d=fitz.open(ref);scan=fitz.open();p=scan.new_page(width=595,height=842);p.insert_image(p.rect,stream=d[8].get_pixmap(matrix=fitz.Matrix(2,2)).tobytes('png'));scan.save(out/'v3-scan.pdf');scan.close();assert worker.run({'command':'ocr','input':str(ref),'page':9,'skipText':True})['skipped'];check('Existing searchable text skipped')
t0=time.perf_counter();r=worker.run({'command':'ocr','input':str(out/'v3-scan.pdf'),'page':1,'profile':'v6'});seconds=time.perf_counter()-t0;assert len(r['blocks'])>20;assert '国民经济行业分类' in ''.join(b['text'] for b in r['blocks']);check(f'Offline OCR: {len(r["blocks"])} lines, {seconds:.1f}s')
worker.run({'command':'apply','input':str(out/'v3-scan.pdf'),'output':str(out/'v3-searchable.pdf'),'ocr':r['blocks']});a=fitz.open(out/'v3-scan.pdf');b=fitz.open(out/'v3-searchable.pdf');assert '国民经济行业分类' in ''.join(b[0].get_text().split());assert a[0].get_pixmap(matrix=fitz.Matrix(2,2)).samples==b[0].get_pixmap(matrix=fitz.Matrix(2,2)).samples;check('Dual-layer search works and scan pixels are unchanged')
hits=b[0].search_for('国民经济行业分类');assert hits and abs(hits[0].x0-min(p[0] for p in r['blocks'][0]['quad']))<25;check('Searchable text aligns with native OCR coordinates')
worker.run({'command':'apply','input':str(out/'v3-scan.pdf'),'output':str(out/'v3-corrected.pdf'),'ocr':[{**r['blocks'][0],'text':'已人工校对的标题'}]});b=fitz.open(out/'v3-corrected.pdf');assert '已人工校对的标题' in b[0].get_text();check('Corrected text written into hidden layer')
(out/'v3-native-report.json').write_text(json.dumps({'checks':checks,'ocr_seconds':seconds,'ocr_lines':len(r['blocks']),'environment':'Linux CPU, PDFium 5.13.0, RapidOCR 3.9.2, ORT 1.30.0'},ensure_ascii=False,indent=2))
