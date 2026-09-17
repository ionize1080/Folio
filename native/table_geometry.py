"""Ruled table geometry; merged cells keep their original rectangle and borders."""
def inspect_tables(data, number):
    import fitz
    with fitz.open(stream=data,filetype='pdf') as doc:
        page=doc[number-1];result=[]
        drawings=page.get_drawings()
        for i,t in enumerate(page.find_tables().tables):
            # At least a two-dimensional grid; prose aligned in columns is not a table.
            if t.row_count<2 or t.col_count<2:continue
            cells=[];seen=set()
            for row,r in enumerate(t.rows):
                for col,box in enumerate(r.cells):
                    if box is None or tuple(box) in seen:continue
                    seen.add(tuple(box))
                    fills=[d for d in drawings if d.get('fill') and d['rect'].contains(fitz.Rect(box))]
                    fill=min(fills,key=lambda d:d['rect'].get_area())['fill'] if fills else None
                    borders=[d for d in drawings if d.get('color') and fitz.Rect(t.bbox).intersects(d['rect']+(-.5,-.5,.5,.5))]
                    border=borders[0] if borders else {}
                    cells.append({'id':f't{i}-r{row}-c{col}','row':row,'column':col,'bounds':list(box),'fill':list(fill) if fill else None,'stroke':list(border.get('color') or (0,0,0)),'borderWidth':border.get('width',.5)})
            styles={(tuple(round(v,4) for v in d['color']),round(d.get('width',.5),3),d.get('dashes','[] 0')) for d in borders}
            result.append({'structureSupported':len(styles)<=1 and all(d.get('dashes','[] 0') in ('[] 0','[] 0.0') for d in borders),'id':f't{i}','bounds':list(t.bbox),'rows':t.row_count,'columns':t.col_count,'cells':cells})
        return result
