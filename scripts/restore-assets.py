from pathlib import Path
import urllib.request,hashlib,json,concurrent.futures
root=Path(__file__).resolve().parents[1];root.joinpath('native/models').mkdir(exist_ok=True,parents=True)
models=[('multi_PP-OCRv6_det_small','PP-OCRv6','det','PP-OCRv6_det_small','090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f'),('multi_PP-OCRv6_rec_small','PP-OCRv6','rec','PP-OCRv6_rec_small','6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884'),('ch_PP-OCRv5_det_mobile','PP-OCRv5','det','ch_PP-OCRv5_det_mobile','4d97c44a20d30a81aad087d6a396b08f786c4635742afc391f6621f5c6ae78ae'),('ch_PP-OCRv5_rec_mobile','PP-OCRv5','rec','ch_PP-OCRv5_rec_mobile','5825fc7ebf84ae7a412be049820b4d86d77620f204a041697b0494669b1742c5'),('ch_ppocr_mobile_v2.0_cls_mobile','PP-OCRv4','cls','ch_ppocr_mobile_v2.0_cls_mobile','e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c')]
def download(m):
 name,version,task,file,sha=m;url=f'https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/{version}/{task}/{file}.onnx';p=root/'native/models'/f'{name}.onnx'
 if not p.exists() or hashlib.sha256(p.read_bytes()).hexdigest()!=sha:
  with urllib.request.urlopen(url,timeout=180) as r:data=r.read()
  assert hashlib.sha256(data).hexdigest()==sha,name;p.write_bytes(data)
 print(name,flush=True);return {'name':name,'version':version,'task':task,'url':url,'sha256':sha,'bytes':p.stat().st_size}
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:manifest=list(pool.map(download,models))
(root/'native/models/manifest.json').write_text(json.dumps(manifest,indent=2))
for name,url in [('NotoSansSC-variable.ttf','https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf'),('OFL.txt','https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/OFL.txt')]:
 with urllib.request.urlopen(url,timeout=120) as r:(root/'native/fonts'/name).write_bytes(r.read())
