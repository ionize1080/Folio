"""Independent audit of explicit phonetic annotation attachment after PDF edits.

This checks the known Hanyu/Pinyin font family, not all nearby small type. Small
footnotes and mathematical superscripts need different semantics and are not
silently assumed to be pronunciation labels.
"""
import math,re

def phonetic_audit(original,edited,reopened,before_objects,after_objects,change):
    source_ids={s['index'] for s in original.get('sources',[])}
    h=original['pageHeight'];size=original['size'];before_glyphs=original.get('originalLayout',{}).get('glyphs',[])
    after_glyphs={g['start']:g for g in reopened.get('originalLayout',{}).get('glyphs',[])}
    annotation=lambda o:o.get('type')=='text' and re.search(r'hanyu|pinyin|phonetic',o.get('fontName',''),re.I) and o.get('text','').strip()
    center=lambda g:g['x']+g['w']/2
    checked=0;errors=[]
    for obj in before_objects:
        if obj['index'] in source_ids or not annotation(obj):continue
        left,bottom,right,top=obj['bounds'];cx=(left+right)/2;baseline=h-bottom
        candidates=[]
        for g in before_glyphs:
            text=g.get('text','')
            if not text or not ('\u3400'<=text[0]<='\u9fff'):continue
            dx=abs(center(g)-cx);dy=g['baseline']-baseline
            if dx<=size*.6 and size*.15<=dy<=size*1.55:candidates.append((dx+abs(dy-size*.75)*.25,g))
        if not candidates:continue
        g=min(candidates,key=lambda x:x[0])[1];checked+=1;offset=g['start']
        # Sample edit indices are Unicode scalar indices; convert their precise
        # splice to UTF-16 because the on-page model stores UTF-16 glyph offsets.
        pos=len(original['text'][:change['offset']].encode('utf-16-le'))//2
        removed=len(change.get('deletedText','').encode('utf-16-le'))//2
        inserted=len(change.get('insertedText','').encode('utf-16-le'))//2
        matches=[o for o in after_objects if annotation(o) and o['text']==obj['text']]
        if pos<=offset<pos+removed:
            if matches:errors.append(dict(annotation=obj['text'],character=g['text'],reason='base-character-deleted-but-pronunciation-remains'))
            continue
        new_offset=offset if offset<pos else offset+inserted-removed
        target=after_glyphs.get(new_offset)
        if target is None:
            errors.append(dict(annotation=obj['text'],character=g['text'],reason='surviving-base-glyph-not-mapped'));continue
        expected_dx=center(target)-center(g);expected_dy=target['baseline']-g['baseline']
        if not matches:
            errors.append(dict(annotation=obj['text'],character=g['text'],reason='pronunciation-disappeared'));continue
        # Select the same pronunciation occurrence by its expected moved anchor.
        expected_x=cx+expected_dx;expected_y=baseline+expected_dy
        current=min(matches,key=lambda o:math.hypot((o['bounds'][0]+o['bounds'][2])/2-expected_x,(h-o['bounds'][1])-expected_y))
        drift=math.hypot((current['bounds'][0]+current['bounds'][2])/2-expected_x,(h-current['bounds'][1])-expected_y)
        if drift>max(.75,size*.08):errors.append(dict(annotation=obj['text'],character=g['text'],reason='pronunciation-no-longer-attached-to-base',driftPoints=round(drift,3)))
    return dict(annotationsChecked=checked,lostAssociations=len(errors),examples=errors[:10])
