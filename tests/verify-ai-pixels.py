from pathlib import Path
import io, json, sys
import fitz
import numpy as np
from PIL import Image
from pypdf import PdfReader

root=Path('tests/output')
def gray(pdf):
    with fitz.open(pdf) as doc:
        p=doc[0].get_pixmap(colorspace=fitz.csGRAY,alpha=False)
        return np.frombuffer(p.samples,np.uint8).reshape(p.height,p.width).copy()

def verify_scan(file):
    base=gray(root/'faded-scan.pdf')
    updated=gray(file)
    assert base.shape==updated.shape
    before=float(np.percentile(base,99.5)-np.percentile(base,.5))
    after=float(np.percentile(updated,99.5)-np.percentile(updated,.5))
    assert after>before*1.3,(after,before)
    with fitz.open(file) as pdf: text=pdf[0].get_text().lower()
    assert 'aes' in text and ('standard' in text or 'encryption' in text),text[:300]
    return dict(beforeContrastSpan=before,afterContrastSpan=after,searchable=True)

def verify_patch(file):
    with fitz.open(file) as pdf:
        images=pdf[0].get_images(full=True)
        candidates=[np.array(Image.open(io.BytesIO(pdf.extract_image(i[0])['image'])).convert('RGB')) for i in images]
    src=np.array(Image.open(root/'faded-source.png').convert('RGB'))
    height,width=src.shape[:2]
    inside=np.zeros((height,width),bool)
    inside[:int(np.ceil(height*.25)),:int(np.ceil(width*.25))]=True
    for im in candidates:
        if im.shape!=src.shape:continue
        if np.array_equal(im[~inside],src[~inside]) and np.any(im[inside]!=src[inside]):
            assert im[4,4,1]>im[4,4,0]*2
            return dict(outsidePixelsIdentical=True,changedPixels=int(np.any(im!=src,axis=2).sum()))
    raise AssertionError('Expected replacement patch and original source pixels outside it')

def verify_vector(file):
    reader=PdfReader(file)
    vector=[o.get_object() for o in reader.pages[0]['/Resources']['/XObject'].values() if o.get_object().get('/FolioLayerKind')=='/Vector']
    assert len(vector)==1 and vector[0]['/Subtype']=='/Form'
    assert 'Publish' in vector[0]['/FolioSVG']
    with fitz.open(file) as pdf:
        assert len(pdf[0].get_drawings())>=4
        assert 'Publish' in pdf[0].get_text()
    return dict(vectorForm=True,editableSource=True,textAndPaths=True)

def verify_color(file):
    def render(path):
        with fitz.open(path) as pdf:
            pix=pdf[0].get_pixmap(matrix=fitz.Matrix(4,4),alpha=False)
            pixels=np.frombuffer(pix.samples,np.uint8).reshape(pix.height,pix.width,3).astype(float)
            return pixels,pdf[1].get_pixmap().samples,[(i[2],i[3]) for i in pdf[0].get_images(full=True)]
    before,neighbor,_=render(root/'color-proof.pdf')
    after,control,sizes=render(file)
    assert neighbor==control and before.shape==after.shape and (2400,1600) in sizes
    delta=(after-before).mean(axis=(0,1))
    assert delta[0]>delta[2] and np.abs(after-before).mean()>2
    return dict(fullSize=[2400,1600],meanRGBDelta=delta.round(2).tolist(),neighborPageIdentical=True)

if __name__=='__main__':
    print(json.dumps({'scan':verify_scan,'patch':verify_patch,'vector':verify_vector,'color':verify_color}[sys.argv[1]](sys.argv[2])))
