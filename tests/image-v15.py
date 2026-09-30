"""Large-source preview latency, source-resolution export and geometry contracts."""
from pathlib import Path
import sys,io,json,time,base64,statistics,math
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'native'))
import fitz,numpy as np
from PIL import Image
from worker import run
from image_adjustments import preview,process
from image_geometry import rectify
from image_color import curve_lut
out=root/'tests/output';out.mkdir(exist_ok=True);checks=[]
w,h=4000,3000
a=np.empty((h,w,3),dtype=np.uint8);a[:,:,0]=np.arange(w,dtype=np.uint32)%256;a[:,:,1]=np.arange(h,dtype=np.uint32)[:,None]%256;a[:,:,2]=120
image=Image.fromarray(a);buf=io.BytesIO();image.save(buf,format='JPEG',quality=88)
pdf=fitz.open();page=pdf.new_page(width=600,height=500);xref=page.insert_image(fitz.Rect(30,30,570,435),stream=buf.getvalue());page.insert_text((35,460),'Foreground text remains vector');page.draw_rect(fitz.Rect(100,100,180,160),fill=(0,0,1),overlay=True)
page=pdf.new_page(width=600,height=500);page.insert_image(fitz.Rect(30,30,570,435),xref=xref)
file=out/'v15-images.pdf';pdf.save(file);pdf.close()
args={'input':str(file),'page':1};obj=next(o for o in run({'command':'inspect',**args})['objects'] if o['type']=='image')
p={'index':obj['index'],**args};cold=preview({**p,'adjustments':{'gamma':1.2}})
timings=[]
for value in [1+i/100 for i in range(1,51)]:
 start=time.perf_counter();r=preview({**p,'adjustments':{'gamma':value,'saturation':10}});timings.append(round((time.perf_counter()-start)*1000,1));assert r['cacheHit'] and r['proxy'];assert (r['width'],r['height'])==(w,h)
assert statistics.median(timings)<1500,(timings,'proxy preview exceeded budget')
assert max(Image.open(io.BytesIO(base64.b64decode(r['preview']))).size)<=1200
checks.append('12 MP input: repeated adjustments reuse bounded decoded proxy; warm median below 1500 ms')
edit={'page':1,'type':'image','index':obj['index'],'signature':obj['signature'],'matrix':obj['matrix'],'adjustments':{'gamma':1.3}}
start=time.perf_counter();composite=run({'command':'flow-background',**args,'edits':[edit],'imagePreviews':{str(obj['index']):r['preview']}});composite_ms=round((time.perf_counter()-start)*1000,1)
small=fitz.open(stream=base64.b64decode(composite['pdf']),filetype='pdf');assert small[0].get_images()[0][2]<=1200;assert 'Foreground' in small[0].get_text();small.close();checks.append('Composed page uses processed proxy once and removes unused full-size resources without flattening text')
start=time.perf_counter();full=run({'command':'apply',**args,'edits':[edit]});full_ms=round((time.perf_counter()-start)*1000,1)
saved=out/'v15-full-resolution.pdf';saved.write_bytes(base64.b64decode(full['bytes']))
with fitz.open(saved) as doc:
 assert any(x[2:4]==(w,h) for x in doc[0].get_images());assert 'Foreground' in doc[0].get_text()
 with fitz.open(file) as original:
  assert doc[1].get_pixmap().samples==original[1].get_pixmap().samples
checks.append('Applied image retains 4000 × 3000 source resolution; untouched shared sibling renders identically')
ramp=Image.fromarray(np.tile(np.arange(256,dtype=np.uint8),(10,1))).convert('RGB')
negative=process(ramp,{'outputBlack':255,'outputWhite':0});assert negative.getpixel((0,0))==(255,255,255) and negative.getpixel((255,0))==(0,0,0)
curve=curve_lut([[30,10],[220,240]],True);assert curve[0]==10 and curve[255]==240
free=process(ramp,{'curveTables':{'rgb':list(reversed(range(256)))}});assert free.tobytes()==negative.tobytes();checks.append('Input endpoints clamp outside range; output handles invert; pencil 256-entry table survives native processing')
rgba=Image.new('RGBA',(320,240),(200,90,40,150));perspective=[[.1,.05],[.95,.15],[.8,.95],[.2,.85]]
warped=rectify(rgba,perspective);assert 'A' in warped.getbands() and warped.getchannel('A').getextrema()==(150,150)
try:rectify(rgba,[[0,0],[1,1],[1,0],[0,1]]);raise AssertionError('crossed quadrilateral accepted')
except ValueError:pass
geometry={**edit,'crop':[10,10,15,15],'perspective':perspective}
result=run({'command':'apply',**args,'edits':[geometry]});geo=fitz.open(stream=base64.b64decode(result['bytes']),filetype='pdf');assert 'Foreground' in geo[0].get_text();geo.close();checks.append('Perspective crop preserves alpha and PDF foreground; crossed corners rejected before export')
report={'platform':sys.platform,'checks':checks,'errors':[],'performance':{'sourcePixels':w*h,'proxyLimit':1200,'coldPreviewMs':cold['milliseconds'],'warmPreviewMs':timings,'warmMedianMs':statistics.median(timings),'warmP95Ms':sorted(timings)[math.ceil(len(timings)*.95)-1],'warmMaxMs':max(timings),'composeMs':composite_ms,'fullResolutionApplyMs':full_ms}}
(out/'v15-native-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False))
