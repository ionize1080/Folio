"""Recover cell geometry from repeated, segmented horizontal table rules.

Some HTML exporters paint white vertical borders. The visible-grid detector
misses them, but repeated horizontal segment endpoints retain cell boundaries.
No page-wide text-table guess is made; inferred borders are never redrawn.
"""
from statistics import median

def candidates(page,drawings,existing):
    if len(drawings)>5000 or sum(len(d.get("items",[])) for d in drawings)>20000:return []
    rows=[]
    for d in drawings:
        for item in d.get('items',[]):
            if item[0]!='l':continue
            a,b=item[1:3]
            if abs(a.y-b.y)>.3 or abs(a.x-b.x)<10:continue
            y=(a.y+b.y)/2;l,r=sorted((a.x,b.x))
            row=next((v for v in rows if abs(v['y']-y)<.5),None)
            if row is None:row={'y':y,'segments':[]};rows.append(row)
            row['segments'].append((l,r,d.get('color')))
    rules=[]
    for row in rows:
        parts=sorted(row['segments'],key=lambda x:x[0]);groups=[]
        for l,r,color in parts:
            if not groups or l>groups[-1]['right']+1.5:groups.append({'left':l,'right':r,'ends':[l,r],'colors':[color]})
            else:
                groups[-1]['right']=max(groups[-1]['right'],r);groups[-1]['ends']+=[l,r];groups[-1]['colors'].append(color)
        for g in groups:
            if g['right']-g['left']>page.rect.width*.25:rules.append({**g,'y':row['y']})
    groups=[]
    for rule in sorted(rules,key=lambda x:x['y']):
        group=next((g for g in groups if abs(g[-1]['left']-rule['left'])<2 and abs(g[-1]['right']-rule['right'])<2 and 0<rule['y']-g[-1]['y']<144),None)
        if group is None:groups.append([rule])
        else:group.append(rule)
    result=[]
    for group in groups:
        if len(group)<4:continue
        x0=median(g['left'] for g in group);x1=median(g['right'] for g in group)
        ys=[g['y']for g in group];box=[x0,ys[0],x1,ys[-1]]
        if any(min(box[2],b['bounds'][2])>max(box[0],b['bounds'][0]) and min(box[3],b['bounds'][3])>max(box[1],b['bounds'][1]) for b in existing):continue
        if not any(c and min(c)<.8 for g in group for c in g['colors']):continue
        endpoints=[]
        for ri,g in enumerate(group):
            for x in g['ends']:
                e=next((v for v in endpoints if abs(v['x']-x)<1),None)
                if e is None:e={'x':x,'rows':set()};endpoints.append(e)
                e['rows'].add(ri)
        xs=sorted(e['x']for e in endpoints if len(e['rows'])>=max(3,len(group)*.8))
        if len(xs)<3 or len(xs)>20 or abs(xs[0]-x0)>2 or abs(xs[-1]-x1)>2 or min(b-a for a,b in zip(xs,xs[1:]))<14:continue
        words=page.get_text('words',clip=box)
        if not words or any(w[0]<x<w[2] for w in words for x in xs[1:-1]):continue
        cells=[];ident='sparse'+str(len(result))
        for ri,(top,bottom) in enumerate(zip(ys,ys[1:])):
            for ci,(left,right) in enumerate(zip(xs,xs[1:])):
                cells.append({'id':f'{ident}-r{ri}-c{ci}','row':ri,'column':ci,'bounds':[left,top,right,bottom],
                    'fill':None,'stroke':[0,0,0],'borderWidth':0,'inferred':True})
        result.append({'id':ident,'bounds':box,'rows':len(ys)-1,'columns':len(xs)-1,'cells':cells,'structureSupported':False,'inferred':True})
    return result
