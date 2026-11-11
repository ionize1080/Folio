from pathlib import Path
import json
import fitz

root=Path('tests/output')
colors=[(.9,.15,.15),(.15,.7,.25),(.2,.3,.9),(.9,.6,.1),(.6,.2,.8),(.1,.7,.75),(.8,.35,.1),(.4,.4,.4)]
checks=[]
def sample(page,x,y):
    image=page.get_pixmap(matrix=fitz.Matrix(1,1),colorspace=fitz.csRGB,alpha=False)
    return image.pixel(round(x),round(y))
def color_at(page,x,y,n):
    actual=sample(page,x,y)
    expected=(255,255,255) if n is None else tuple(round(v*255) for v in colors[n-1])
    assert max(abs(a-b) for a,b in zip(actual,expected))<=4,(n,actual,expected)
with fitz.open(root/'printing-270.pdf') as doc:
    assert not doc.is_repaired and len(doc)==2
    for page in doc:
        assert abs(page.rect.width-300)<1 and abs(page.rect.height-400)<1
        c=sample(page,150,200);assert max(c)-min(c)<=1 and 10<c[0]<245,c
    checks.append('Selected pages preserve original size and are actually rendered in grayscale')
with fitz.open(root/'printing-handout-270.pdf') as doc:
    assert not doc.is_repaired and len(doc)==2
    for page in doc:
        assert abs(page.rect.width-595.28)<1 and abs(page.rect.height-841.89)<1
        samples=[sample(page,page.rect.width*x,page.rect.height*y) for y in (.25,.75) for x in (.25,.75)]
        assert all(max(c)-min(c)<=1 and 10<c[0]<245 for c in samples),samples
    # Rec.709 grayscale makes page 2 (green) lighter than page 1 (red): RTL order.
    assert sample(doc[0],149,210)[0]>sample(doc[0],446,210)[0]
    checks.append('Four-up faces contain all four grayscale pages in the requested RTL positions')
for filename,order in [('printing-booklet-270.pdf',[(8,1),(2,7),(6,3),(4,5)]),('printing-booklet-backs-270.pdf',[(5,4),(None,2)])]:
    with fitz.open(root/filename) as doc:
        assert not doc.is_repaired and len(doc)==len(order)
        for page,pair in zip(doc,order):
            assert abs(page.rect.width-841.89)<1 and abs(page.rect.height-595.28)<1
            for x,n in zip((.25,.75),pair):color_at(page,page.rect.width*x,page.rect.height*.5,n)
    checks.append(filename+': physically rendered page pairs match folding order')
(root/'printing-270-render-checks.json').write_text(json.dumps({'status':'passed','checks':checks},indent=2),encoding='utf-8')
print('PASS',checks)
