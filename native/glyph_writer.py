"""Batch positioned Unicode glyphs into one content stream.

The fonts, outlines and anchors are unchanged. Avoid one new PDF stream,
resource lookup, width-array walk and compression operation per character.
"""
import math


def number(value):
    return format(float(value),'.8f').rstrip('0').rstrip('.') or '0'


class GlyphWriter:
    def __init__(self,page):
        self.page=page;self.fonts={};self.parts=['q\nBT\n']

    def add(self,text,actual,path,x,y,size,color,scale=1,angle=0,bold=False,italic=False,stroke=0):
        import fitz
        if path not in self.fonts:
            name='F'+str(len(self.fonts));face=fitz.Font(fontfile=path)
            self.page.insert_font(fontname=name,fontfile=path)
            self.fonts[path]=(name,face)
        name,face=self.fonts[path]
        gids=[face.has_glyph(ord(ch)) for ch in text]
        if any(not 0<gid<=65535 for gid in gids):raise ValueError('排版字体缺少可写入字形')
        c=round(math.cos(math.radians(-angle)),12);s=round(math.sin(math.radians(-angle)),12);k=.22 if italic else 0
        matrix=(scale*c,scale*s,k*c-s,k*s+c,x,self.page.rect.height-y)
        rgb=' '.join(number(v) for v in color)
        semantic='FEFF'+actual.encode('utf-16-be').hex()
        encoded=''.join(f'{gid:04x}' for gid in gids)
        self.parts.append(f'/{name} {number(size)} Tf\n'+ ' '.join(map(number,matrix))+' Tm\n'+
                          f'{rgb} rg {rgb} RG {2 if bold else 0} Tr {number((stroke or size*.025) if bold else 0)} w 1 M\n'+
                          f'/Span << /ActualText <{semantic}> >> BDC\n<{encoded}> Tj\nEMC\n')

    def finish(self):
        doc=self.page.parent;ref=doc.get_new_xref();doc.update_object(ref,'<<>>')
        doc.update_stream(ref,(''.join(self.parts)+'ET\nQ\n').encode('ascii'),compress=False)
        self.page.set_contents(ref)
