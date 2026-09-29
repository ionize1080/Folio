"""Whitespace-only column/section ordering; ambiguous overlaps stay in row order."""
def reading_order(blocks):
    pages={}
    for b in blocks:
        xs=[p[0] for p in b['quad']];ys=[-p[1] for p in b['quad']]
        pages.setdefault(b['page'],[]).append(dict(b=b,x0=min(xs),x1=max(xs),y0=min(ys),y1=max(ys)))
    def cut(items,depth=0):
        if len(items)<2 or depth>32:return items
        heights=sorted(i['y1']-i['y0'] for i in items);em=max(2,heights[len(heights)//2])
        for lo,hi,threshold in [('x0','x1',em*1.5),('y0','y1',em*.85)]:
            ordered=sorted(items,key=lambda i:i[lo]);end=ordered[0][hi];best=0;at=0
            for j,item in enumerate(ordered[1:],1):
                gap=item[lo]-end
                if gap>threshold and gap>best:best=gap;at=j
                end=max(end,item[hi])
            if at:return cut(ordered[:at],depth+1)+cut(ordered[at:],depth+1)
        return sorted(items,key=lambda i:(i['y0'],i['x0']))
    return [i['b'] for page in sorted(pages) for i in cut(pages[page])]
