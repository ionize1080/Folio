from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from copy import deepcopy
from pathlib import Path
import json
root=Path(__file__).resolve().parents[1]/'native/fonts';f=TTFont(root/'NotoSansSC-variable.ttf');instantiateVariableFont(f,{'wght':400},inplace=True);order=list(f.getGlyphOrder());seen={};cmap=f.getBestCmap()
for cp,glyph in sorted(cmap.items()):
 if glyph in seen:
  name=f'folio.uni{cp:06X}';f['glyf'][name]=deepcopy(f['glyf'][glyph]);f['hmtx'][name]=f['hmtx'][glyph]
  if 'vmtx' in f:f['vmtx'][name]=f['vmtx'][glyph]
  order.append(name)
  for t in f['cmap'].tables:
   if t.isUnicode() and cp in t.cmap:t.cmap[cp]=name
 else:seen[glyph]=cp
f.setGlyphOrder(order)
for nid,value in [(1,'Folio Sans Native'),(3,'FolioSansNative-Regular-0.3'),(4,'Folio Sans Native Regular'),(6,'FolioSansNative-Regular'),(16,'Folio Sans Native'),(17,'Regular')]:f['name'].setName(value,nid,3,1,1033)
f.save(root/'NotoSansSC.ttf');(root/'codepoints.json').write_text(json.dumps(sorted(cmap)));print('Prepared font:',len(cmap),'characters')
