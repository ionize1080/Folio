"""Read-only PDFium Form evidence, bounded by depth and total visited objects."""
import ctypes as C

def annotate(r,page,objects):
    remaining=10000
    for item in objects:
        if item['type']!='form':continue
        counts={'text':0,'image':0,'form':0};deepest=0;truncated=False
        def walk(obj,depth,ancestors):
            nonlocal remaining,deepest,truncated
            ptr=C.cast(obj,C.c_void_p).value
            if depth>16 or remaining<=0 or ptr in ancestors:truncated=True;return
            remaining-=1;deepest=max(deepest,depth)
            typ=r.FPDFPageObj_GetType(obj)
            if typ==1:counts['text']+=1
            elif typ==3:counts['image']+=1
            elif typ==5:
                counts['form']+=1
                for i in range(max(0,r.FPDFFormObj_CountObjects(obj))):
                    if remaining<=0:truncated=True;break
                    walk(r.FPDFFormObj_GetObject(obj,i),depth+1,ancestors+(ptr,))
        walk(r.FPDFPage_GetObject(page,item['index']),0,())
        item['nestedContent']={**counts,'depth':deepest,'truncated':truncated}
        item['reason']=('复合对象内含 %d 个文字对象；透明度、标签或嵌套作用域尚不支持安全替换'%counts['text'] if counts['text'] else '复合图形对象，保留原容器；可添加文字或局部 OCR')+('（已到分析预算）' if truncated else '')
