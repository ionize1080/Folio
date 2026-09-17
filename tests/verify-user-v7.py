"""Independent whole-page pixel and text verification for user-document outputs."""
import sys,json
from pathlib import Path
import fitz
root=Path(__file__).resolve().parents[1];out=root/'tests/output';checks=[]
for filename,key in [('中国货币政策执行报告-2025年3季度.pdf','monetary'),('绿色产业指导目录.pdf','green'),('QDII额度与纳指标普产品比较_20260831.pdf','qdii')]:
 original=Path(sys.argv[1])/filename
 with fitz.open(original) as a,fitz.open(out/f'v7-{key}-edited.pdf') as b:
  assert len(a)==len(b)
  assert '页面内重排测试' in b[1].get_text()
  assert all(t in b[1].get_text() for t in ['00123.45','3.50%'])
  for page in [0,2,len(a)-1]:
   assert a[page].get_pixmap().samples==b[page].get_pixmap().samples,(filename,page)
  # Page 2 bottom 50 points is outside the edited body paragraph.
  clip=fitz.Rect(0,a[1].rect.height-50,a[1].rect.width,a[1].rect.height)
  assert a[1].get_pixmap(clip=clip).samples==b[1].get_pixmap(clip=clip).samples
  checks.append({'document':filename,'pages':len(a),'modifiedPage':2,'unchangedPagesChecked':[1,3,len(a)],'footerPixelsEqual':True,'amountsSearchable':True})
(out/'v7-documents-report.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2));print(json.dumps(checks,ensure_ascii=False))
