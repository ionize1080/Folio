"""Pinned RapidOCR 3.9 adapter: retain pre-filter evidence and retry line crops.
No generated text. Ambiguous alternatives require explicit review before writeback.
"""
import copy
import time
import numpy as np

SCHEMA = 1


def oriented_quad(box, tall=False, upside_down=False):
    # get_rotate_crop_image rotates tall crops CCW; follow the text's actual axes.
    q = [list(map(float,p)) for p in box]
    if tall:q = [q[1],q[2],q[3],q[0]]
    if upside_down:q = [q[2],q[3],q[0],q[1]]
    return q


def choose_candidate(original, alternate):
    a, b = original, alternate
    # Confidence alone cannot beat a longer plausible result. Keep disagreement
    # observable even when proposing the more complete candidate.
    if b['text'].strip() and b['score'] >= .65 and len(b['text']) >= max(3, len(a['text']) * 1.6) and b['score'] >= a['score'] - .18:
        return b
    if not a['text'].strip() and b['score'] >= .65:return b
    return a


def crosses_rule(crop):
    import cv2
    h,w = crop.shape[:2]
    if h < 12 or w < h * 1.5:return False
    gray=cv2.cvtColor(crop,cv2.COLOR_BGR2GRAY) if crop.ndim==3 else crop
    ink=(gray < 100).astype('uint8')
    # A cell separator spans almost the full crop height, unlike normal strokes.
    lines=cv2.morphologyEx(ink,cv2.MORPH_OPEN,np.ones((max(8,int(h*.85)),1),np.uint8))
    margin=max(3,int(h*.25))
    return bool(np.any(lines[:,margin:w-margin].sum(axis=0) >= h*.85))


def recognize_with_evidence(engine, image):
    from rapidocr.utils.process_img import map_boxes_to_original
    started=time.perf_counter()
    ori=engine.load_img(image);img,op=engine.preprocess_img(ori)
    det,cls,rec,crops=engine.run_ocr_steps(img,op)
    if det.boxes is None:return [], {'detected':0,'retried':0,'seconds':time.perf_counter()-started}
    boxes=map_boxes_to_original(det.boxes.copy(),copy.deepcopy(op),*ori.shape[:2])
    texts=list(rec.txts or []);scores=list(rec.scores or []);classes=cls.cls_res or []
    outputs=[];retried=0
    for i,box in enumerate(boxes):
        label,score=classes[i] if i<len(classes) else ('0',0)
        rotated='180' in str(label) and score > engine.text_cls.cls_thresh
        initial={'text':str(texts[i]) if i<len(texts) else '', 'score':float(scores[i]) if i<len(scores) else 0., 'rotation':180 if rotated else 0}
        candidates=[initial];chosen=initial;reasons=[];crop=crops[i] if i<len(crops) else None
        if not initial['text'].strip():reasons.append('empty')
        elif initial['score'] < engine.text_score:reasons.append('filtered-low-score')
        ratio=crop.shape[1]/max(1,crop.shape[0]) if crop is not None else 1
        if ratio > 5 and len(initial['text'].strip()) < ratio*.45:reasons.append('short-result')
        if crop is not None and crosses_rule(crop):reasons.append('cross-cell-rule')
        # Retry inverted classifications as well as empty/short/low results. Each
        # crop is bounded and detection is never repeated for this comparison.
        if crop is not None and (rotated or reasons or float(score)<.8):
            other_rotation=0 if rotated else 180
            other=crop if not other_rotation else np.rot90(crop,2).copy()
            alt=engine.recognize_txt([other]);retried+=1
            candidate={'text':str((alt.txts or [''])[0]),'score':float((alt.scores or [0])[0]),'rotation':other_rotation}
            candidates.append(candidate);chosen=choose_candidate(initial,candidate)
            if candidate['text'] != initial['text'] and candidate['score'] >= .65:
                reasons.append('direction-conflict')
        width=max(np.linalg.norm(box[0]-box[1]),np.linalg.norm(box[2]-box[3]))
        height=max(np.linalg.norm(box[0]-box[3]),np.linalg.norm(box[1]-box[2]))
        tall=int(height)/max(1,int(width)) >= 1.5
        for c in candidates:c['quad']=oriented_quad(box,tall,c['rotation']==180)
        outputs.append({'text':chosen['text'],'confidence':chosen['score'],'quad':chosen['quad'],
                        'needsReview':bool(reasons),'reviewAccepted':False,
                        'diagnostic':{'schema':SCHEMA,'detectedQuad':box.tolist(),'classifier':{'label':str(label),'score':float(score)},
                                      'threshold':float(engine.text_score),'reasons':reasons,'candidates':candidates,
                                      'chosenRotation':chosen['rotation']}})
    return outputs, {'detected':len(boxes),'retried':retried,'seconds':time.perf_counter()-started,
                     'stages':{'detect':float(det.elapse or 0),'classify':float(cls.elapse or 0),'recognize':float(rec.elapse or 0)}}
