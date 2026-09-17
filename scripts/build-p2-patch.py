"""Rebuild the P2 overlay from the verified P1 asar, without npm/network.
Usage: python scripts/build-p2-patch.py /path/to/P1/resources/app.asar /output
"""
import sys,json,struct,hashlib,copy,zipfile,shutil
from pathlib import Path
root=Path(__file__).resolve().parents[1];base=Path(sys.argv[1]);out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
sha=lambda b:hashlib.sha256(b).hexdigest()
expected='625eeaa8773429083ba54353e5dcbd923df2fb8340ef1b76d00abdf0df4966c2'
blob=base.read_bytes();assert sha(blob)==expected,'Use the delivered RC1 P1 archive'
def unpack(blob):
 size=struct.unpack_from('<I',blob,4)[0];n=struct.unpack_from('<I',blob,12)[0];header=json.loads(blob[16:16+n]);data={}
 def walk(files,prefix=''):
  for name,v in files.items():
   rel=prefix+name
   if 'files'in v:walk(v['files'],rel+'/')
   elif 'offset'in v:
    off=8+size+int(v['offset']);data[rel]=blob[off:off+v['size']]
   else:raise ValueError('Unsupported linked/unpacked entry')
 walk(header['files']);return header,data
header,data=unpack(blob);before=data.copy()
changed=['main.cjs','native-bridge.cjs','src/flow-ui.mjs','src/flow-page-model.mjs','src/app.mjs','src/index.html','src/ocr-stream.mjs','src/ocr-ui.mjs','src/style.css']
for name in changed:data[name]=(root/name).read_bytes()
pkg=json.loads(data['package.json']);pkg['releaseChannel']='rc1-p2';data['package.json']=json.dumps(pkg,indent=2).encode();changed+=['package.json']
chunks=[];offset=0

def pack(files,prefix=''):
 global offset
 for name,v in files.items():
  rel=prefix+name
  if 'files'in v:pack(v['files'],rel+'/');continue
  b=data[rel];v['size']=len(b);v['offset']=str(offset);offset+=len(b);chunks.append(b)
  if 'integrity'in v:
   size=v['integrity'].get('blockSize',4194304)
   v['integrity']={'algorithm':'SHA256','hash':sha(b),'blockSize':size,'blocks':[sha(b[i:i+size]) for i in range(0,len(b),size)] or [sha(b'')]}
pack(header['files']);h=json.dumps(header,separators=(',',':'),ensure_ascii=False).encode();pad=(-len(h))%4
pickle=struct.pack('<II',4+len(h)+pad,len(h))+h+b'\0'*pad
archive=struct.pack('<II',4,len(pickle))+pickle+b''.join(chunks)
stage=out/'Folio-PDF-Studio-RC1-P2-patch';(stage/'resources').mkdir(parents=True,exist_ok=True)
(stage/'resources/app.asar').write_bytes(archive)
_,actual=unpack(archive);assert actual==data
for name,b in actual.items():
 if name not in changed:assert b==before[name]
 else:assert b==data[name]
native=['worker.py','story.py','justify.py','font_preview.py','system_fonts.py','fonts/NotoSansSC.ttf']
for name in native:
 dest=stage/'resources/native'/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(root/'native'/name,dest)
report={'patch':'1.0.0 RC1 P2','baseP1AsarSHA256':expected,'asarSHA256':sha(archive),'changedApplicationFiles':changed,'unchangedApplicationFilesVerified':len(data)-len(changed),'nativeFiles':{name:sha((stage/'resources/native'/name).read_bytes()) for name in native},'windowsLaunchTested':False,'fullBrowserUITested':False}
(stage/'PATCH-INFO.json').write_text(json.dumps(report,indent=2));shutil.copy2(root/'README-P2.md',stage/'README-P2.md')
for reportname in ['p2-native-report.json','p2-pdfjs-report.json','p2-core.txt','p2-native-v9.txt']:
 dest=stage/'validation'/reportname;dest.parent.mkdir(exist_ok=True);shutil.copy2(root/'tests/output'/reportname,dest)
# No user input documents are included in either deliverable.
with zipfile.ZipFile(out/'Folio-PDF-Studio-RC1-P2-patch.zip','w',zipfile.ZIP_DEFLATED,9) as z:
 for p in sorted(stage.rglob('*')):
  if p.is_file():z.write(p,p.relative_to(stage))
source=set(changed)
source.update('native/'+n for n in native)
source.update(['src/bookmark-split.mjs','src/bookmark-split-ui.mjs','README-P2.md','scripts/build-p2-patch.py','scripts/normalize-font.py','tests/native-p2.py','tests/p2-pdfjs.cjs','tests/ocr-stream-p2.test.mjs','tests/bookmark-split-p1.test.mjs'])
with zipfile.ZipFile(out/'Folio-PDF-Studio-RC1-P2-source-patch.zip','w',zipfile.ZIP_DEFLATED,9) as z:
 for name in sorted(source):z.write(root/name,name)
 z.writestr('PATCH-INFO.json',json.dumps(report,indent=2))
for name in ['Folio-PDF-Studio-RC1-P2-patch.zip','Folio-PDF-Studio-RC1-P2-source-patch.zip']:
 with zipfile.ZipFile(out/name) as z:assert z.testzip() is None
 print(json.dumps({'file':name,'size':(out/name).stat().st_size,'sha256':sha((out/name).read_bytes())}))
print(json.dumps(report,indent=2))
