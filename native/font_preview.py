"""Small, cached name-only font previews; never send a whole CJK font per row."""
import base64,io,sys
from pathlib import Path
from functools import lru_cache
sys.path.insert(0,str(Path(__file__).parent/'vendor'))

@lru_cache(maxsize=96)
def preview_font(path,label):
    from fontTools import subset
    from fontTools.ttLib import TTFont
    font=TTFont(path)
    options=subset.Options()
    options.layout_features=[]
    options.name_IDs=[1,2,4,6]
    sub=subset.Subsetter(options=options)
    sub.populate(text=label)
    sub.subset(font)
    buf=io.BytesIO();font.save(buf);font.close()
    return base64.b64encode(buf.getvalue()).decode()
