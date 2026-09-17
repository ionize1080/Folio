from pathlib import Path
import sys,time,json,fitz
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'native'));import worker
out=root/'tests/output';out.mkdir(exist_ok=True);checks=[]
def check(s):checks.append(s);print('PASS',s,flush=True)
# Reproducible scan fixture, no private document required.
d=fitz.open();font=fitz.Font(fontfile=str(root/'native/fonts/NotoSansSC.ttf'))
for i in range(4):
 p=d.new_page(width=595,height=842);w=fitz.TextWriter(p.rect);w.append((45,65),f'第{i+1}章  测试标题',font=font,fontsize=20);w.append((45,110),'离线识别与书签定位测试',font=font,fontsize=14);w.append((45,145),'项目名称：农业基础设施建设',font=font,fontsize=14);w.append((45,180),'贷款余额 123456.78 万元',font=font,fontsize=14);w.write_text(p)
d.save(out/'v4-text.pdf');scan=fitz.open()
for page in d:
 p=scan.new_page(width=595,height=842);p.insert_image(p.rect,stream=page.get_pixmap(matrix=fitz.Matrix(2,2)).tobytes('png'))
scan.save(out/'v4-scan.pdf');scan.close()
blocks=[];times=[]
for page in [1,2,3,4]:
 r=worker.run({'command':'ocr','input':str(out/'v4-scan.pdf'),'page':page,'profile':'v6','threads':2});blocks+=r['blocks'];times.append(r['timing']);assert len(r['blocks'])>=3
assert '测试标题' in ''.join(b['text'] for b in blocks);check('Four Chinese scan pages recognized using actual bundled ONNX models')
assert times[1]['load']<times[0]['load'];check('Warm model and PDF reused across pages')
worker.run({'command':'apply','input':str(out/'v4-scan.pdf'),'output':str(out/'v4-searchable.pdf'),'ocr':blocks})
a=fitz.open(out/'v4-scan.pdf');b=fitz.open(out/'v4-searchable.pdf')
for i in range(4):
 assert '测试标题' in ''.join(b[i].get_text().split());assert a[i].get_pixmap().samples==b[i].get_pixmap().samples
check('Four-page hidden text output searchable; original scan pixels unchanged')
r=worker.run({'command':'inspect','input':str(root/'assets/Folio-Sample.pdf'),'page':1});obj=next(o for o in r['objects'] if o['type']=='text' and o['editable']);worker.run({'command':'apply','input':str(root/'assets/Folio-Sample.pdf'),'output':str(out/'v4-edit.pdf'),'edits':[{**obj,'page':1,'text':'中文内容修改'}]});assert '中文内容修改' in fitz.open(out/'v4-edit.pdf')[0].get_text();check('Existing object editing remains functional')
(out/'v4-native-report.json').write_text(json.dumps({'checks':checks,'timing':times,'environment':'Linux CPU; RapidOCR 3.9.2 / ONNX Runtime 1.30.0 / pypdfium2 5.3.0; no Windows launch validation'},ensure_ascii=False,indent=2))
