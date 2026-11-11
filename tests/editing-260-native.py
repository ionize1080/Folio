"""Generated regressions for clipped tagged prose, Type3 outlines and batched ink."""
import base64,copy,io,json,pathlib,subprocess,sys,time,unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'native'),str(ROOT/'native/vendor'),str(ROOT/'tests')]
import fitz
from pypdf import PdfReader,PdfWriter
from pypdf.generic import DictionaryObject as D,NameObject as N,ArrayObject as A,NumberObject as I,FloatObject as F,BooleanObject,DecodedStreamObject,ContentStream
from p8_helpers import models,save,dump,inspect,pixels,OUT
from glyph_writer import GlyphWriter
from editing_corpus_helper_260 import edited


def tagged_fixture():
    doc=fitz.open();p=doc.new_page(width=420,height=260)
    p.insert_font(fontname='F',fontfile=str(ROOT/'native/fonts/DejaVuSans.ttf'))
    p.insert_text((30,60),'Adrian Day keeps the original paragraph',fontname='F',fontsize=12)
    p.insert_text((30,78),'and continues on the following line.',fontname='F',fontsize=12)
    p.insert_text((30,160),'Separate untouched paragraph.',fontname='F',fontsize=12)
    w=PdfWriter();w.clone_document_from_reader(PdfReader(io.BytesIO(doc.tobytes())))
    pg=w.pages[0];s=ContentStream(pg.get_contents(),w)
    # A's original outline starts at x=30.09; Chromium-style line clipping
    # cuts a small, already-observed side bearing rather than the whole letter.
    s.operations=[([N('/P'),D({N('/MCID'):I(0)})],b'BDC'),([],b'q'),([F(30.35),I(0),I(389),I(260)],b're'),([],b'W'),([],b'n')]+s.operations+[([],b'Q'),([],b'EMC')]
    pg[N('/Contents')]=w._add_object(s);pg[N('/StructParents')]=I(0)
    root=D({N('/Type'):N('/StructTreeRoot')});rr=w._add_object(root)
    block=D({N('/Type'):N('/StructElem'),N('/S'):N('/P'),N('/P'):rr,N('/Pg'):pg.indirect_reference});br=w._add_object(block)
    inline=D({N('/Type'):N('/StructElem'),N('/S'):N('/NonStruct'),N('/P'):br,N('/Pg'):pg.indirect_reference,N('/K'):I(0)});ir=w._add_object(inline)
    block[N('/K')]=A([ir]);root[N('/K')]=A([br]);root[N('/ParentTree')]=w._add_object(D({N('/Nums'):A([I(0),A([ir])])}))
    w._root_object[N('/StructTreeRoot')]=rr;w._root_object[N('/MarkInfo')]=D({N('/Marked'):BooleanObject(True)})
    return dump(w)


def type3_fixture():
    w=PdfWriter();pg=w.add_blank_page(width=300,height=200)
    def stream(data):
        s=DecodedStreamObject();s.set_data(data);return w._add_object(s)
    font=D({N('/Type'):N('/Font'),N('/Subtype'):N('/Type3'),N('/FontBBox'):A([I(0),I(0),I(600),I(700)]),N('/FontMatrix'):A([F(.001),I(0),I(0),F(.001),I(0),I(0)]),N('/FirstChar'):I(65),N('/LastChar'):I(66),N('/Widths'):A([I(600),I(600)]),N('/Encoding'):D({N('/Type'):N('/Encoding'),N('/Differences'):A([I(65),N('/A'),N('/B')])}),N('/CharProcs'):D({N('/A'):stream(b'600 0 0 0 600 700 d1 50 0 m 300 700 l 550 0 l h f'),N('/B'):stream(b'600 0 0 0 600 700 d1 50 0 450 700 re f')}),N('/Resources'):D()})
    pg[N('/Resources')]=D({N('/Font'):D({N('/F'):w._add_object(font)})})
    pg[N('/Contents')]=stream(b'BT /F 24 Tf 1 0 0 1 30 120 Tm (ABABABABABAB) Tj ET')
    return dump(w)


class Editing260(unittest.TestCase):
    def test_tagged_overhang_and_partial_scope_keep_neighbours(self):
        raw=tagged_fixture();data,ms=models(raw)
        first=next(o for o in data['objects'] if o.get('text','').startswith('Adrian'))
        self.assertTrue(first['flowEditable']);self.assertTrue(first.get('clippedOverhang'));self.assertIn('structureParagraph',first)
        # Test the useful case of one large producer MCID spanning independent
        # visual paragraphs. Drop semantic hints only in this test's selection.
        for o in data['objects']:o.pop('structureParagraph',None)
        from editing_corpus_helper_260 import candidates
        m=next(m for m in candidates(data) if m['text'].startswith('Adrian'))
        self.assertNotIn('Separate',m['text']);m=edited(m,m['text'].replace('paragraph','paragraph test'))
        m['allowOverflow']=True;changed=save(raw,m)
        self.assertEqual(pixels(raw,clip=fitz.Rect(0,145,420,190)),pixels(changed,clip=fitz.Rect(0,145,420,190)))
        _,again=models(changed);self.assertTrue(any(x['text']==m['text'] for x in again))
        reader=PdfReader(io.BytesIO(changed));self.assertEqual(reader.trailer['/Root']['/StructTreeRoot']['/K'][0].get_object()['/S'],'/P')
        (OUT/'editing-260-tagged.pdf').write_bytes(raw)
        (OUT/'editing-260-tagged-saved.pdf').write_bytes(changed)

    def test_type3_vectors_are_editable_and_repeatable(self):
        raw=type3_fixture();data,ms=models(raw);m=ms[0]
        self.assertEqual(m['fontResolution'],'embedded');self.assertEqual(m['text'],'ABABABABABAB')
        from font_match import load_font
        key=m['fontKey'];self.assertTrue({65,66}<=load_font(key)['coverage'])
        self.assertEqual(models(raw)[1][0]['fontKey'],key)
        m=edited(m,'BBABABABABAB');changed=save(raw,m)
        self.assertTrue(any(x['text']==m['text'] for x in models(changed)[1]))
        # Every unchanged outline after the corrected slot must stay identical.
        a=pixels(raw,clip=fitz.Rect(45,60,290,130));b=pixels(changed,clip=fitz.Rect(45,60,290,130))
        # Type3 paths and CFF glyphs use different antialiasing. Bound that
        # edge-only raster difference and independently verify every anchor.
        self.assertLess(sum(abs(x-y) for x,y in zip(a,b))/len(a),1)
        self.assertLess(sum(x!=y for x,y in zip(a,b))/len(a),.025)
        with fitz.open(stream=raw,filetype='pdf') as before,fitz.open(stream=changed,filetype='pdf') as after:
            def anchors(pg):return [c['origin'] for b in pg.get_text('rawdict')['blocks'] for l in b.get('lines',[]) for s in l['spans'] for c in s['chars']]
            for x,y in zip(anchors(before[0]),anchors(after[0])):
                self.assertLess(max(abs(a-b) for a,b in zip(x,y)),.001)
        (OUT/'editing-260-type3.pdf').write_bytes(raw)

    def test_batch_writer_matches_reference_pixels_and_actual_text(self):
        path=str(ROOT/'native/fonts/DejaVuSans.ttf')
        reference=fitz.open();a=reference.new_page(width=300,height=200);a.insert_font(fontname='F',fontfile=path)
        actual=fitz.open();b=actual.new_page(width=300,height=200);writer=GlyphWriter(b)
        for i,ch in enumerate('AgéΩ0123'):
            x=30+i*25;a.insert_text((x,65),ch,fontsize=18,fontname='F',color=(.1,.2,.3));writer.add(ch,ch,path,x,65,18,(.1,.2,.3))
        writer.finish();self.assertEqual(a.get_pixmap(matrix=fitz.Matrix(2,2)).samples,b.get_pixmap(matrix=fitz.Matrix(2,2)).samples)
        self.assertEqual(''.join(a.get_text().split()),''.join(b.get_text().split()))
        self.assertEqual(len(b.get_contents()),1)

    def test_generated_overflow_is_visible_and_reeditable(self):
        raw=type3_fixture();m=models(raw)[1][0];m.update(layoutMode='reflow',allowOverflow=True)
        m=edited(m,'ABABABABABABABABABABABAB');m['frame']['width']=24
        changed=save(raw,m);self.assertTrue(any(x['text']==m['text'] for x in models(changed)[1]))


if __name__=='__main__':
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Editing260))
    (OUT/'editing-260-native.json').write_text(json.dumps({'status':'passed' if result.wasSuccessful() else 'failed','checks':result.testsRun,'errors':[str(e) for _,e in result.errors+result.failures]}),encoding='utf-8')
    sys.exit(not result.wasSuccessful())
