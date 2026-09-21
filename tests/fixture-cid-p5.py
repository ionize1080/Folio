"""Synthetic CID-keyed OpenType: CID 20 maps to GID 1, CID 5 maps to GID 2."""
from pathlib import Path
import io
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.cffLib import FDArrayIndex,FDSelect,FontDict
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject as D,NameObject as N,NumberObject as I,ArrayObject as A,DecodedStreamObject as S,TextStringObject as T
order=['.notdef','cid00020','cid00005'];chars={}
for i,name in enumerate(order):
 p=T2CharStringPen(600,None)
 if i:p.moveTo((50,0));p.lineTo((500,0));p.lineTo((500,500+i*100));p.lineTo((50,500+i*100));p.closePath()
 chars[name]=p.getCharString()
f=FontBuilder(1000,isTTF=False);f.setupGlyphOrder(order);f.setupCharacterMap({0x4e2d:order[1],0x6587:order[2]});f.setupHorizontalMetrics({n:(600,0)for n in order});f.setupHorizontalHeader(ascent=800,descent=-200)
f.setupNameTable({'familyName':'P5 CID Fixture','styleName':'Regular','uniqueFontIdentifier':'P5CIDFixture','fullName':'P5 CID Fixture','psName':'P5CIDFixture'});f.setupOS2(sTypoAscender=800,sTypoDescender=-200,usWinAscent=800,usWinDescent=200);f.setupPost();f.setupCFF('P5CIDFixture',{'FullName':'P5 CID Fixture','FamilyName':'P5 CID Fixture','Weight':'Regular'},chars,{})
top=f.font['CFF '].cff.topDictIndex[0];top.ROS=('Adobe','Identity',0);top.CIDCount=21;top.FDArray=FDArrayIndex();fd=FontDict();fd.Private=top.Private;top.FDArray.append(fd);del top.Private;top.FDSelect=FDSelect(format=3);top.FDSelect.gidArray=[0,0,0]
b=io.BytesIO();f.save(b);font=b.getvalue()
w=PdfWriter();page=w.add_blank_page(width=600,height=800);stream=S();stream.set_data(font);stream[N('/Subtype')]=N('/OpenType');ref=w._add_object(stream)
desc=D({N('/Type'):N('/FontDescriptor'),N('/FontName'):N('/P5CIDFixture'),N('/Flags'):I(4),N('/FontBBox'):A([I(0),I(-200),I(600),I(800)]),N('/ItalicAngle'):I(0),N('/Ascent'):I(800),N('/Descent'):I(-200),N('/CapHeight'):I(800),N('/StemV'):I(80),N('/FontFile3'):ref})
cid=D({N('/Type'):N('/Font'),N('/Subtype'):N('/CIDFontType0'),N('/BaseFont'):N('/P5CIDFixture'),N('/CIDSystemInfo'):D({N('/Registry'):T('Adobe'),N('/Ordering'):T('Identity'),N('/Supplement'):I(0)}),N('/FontDescriptor'):w._add_object(desc),N('/DW'):I(600)})
cmap=S();cmap.set_data(b'/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <ffff> endcodespacerange 2 beginbfchar <0014> <4e2d> <0005> <6587> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end')
face=D({N('/Type'):N('/Font'),N('/Subtype'):N('/Type0'),N('/BaseFont'):N('/P5CIDFixture'),N('/Encoding'):N('/Identity-H'),N('/DescendantFonts'):A([w._add_object(cid)]),N('/ToUnicode'):w._add_object(cmap)})
page[N('/Resources')]=D({N('/Font'):D({N('/F1'):w._add_object(face)})});s=S();s.set_data(b'BT /F1 24 Tf 60 700 Td <00140005> Tj ET');page[N('/Contents')]=w._add_object(s)
b=io.BytesIO();w.write(b);Path('tests/output/p5-cid.pdf').write_bytes(b.getvalue());print(len(b.getvalue()))
