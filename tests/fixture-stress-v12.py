"""Valid PDF with a reachable uncompressed 200 MiB resource, no private data."""
from pathlib import Path
import fitz
out=Path(__file__).resolve().parent/'output';out.mkdir(exist_ok=True)
with fitz.open() as doc:
 page=doc.new_page();page.insert_text((72,72),'Folio 200 MiB resource stress test')
 ref=doc.get_new_xref();doc.update_object(ref,'<< >>');doc.update_stream(ref,b'X'*(200*1024**2),compress=False)
 doc.xref_set_key(doc.pdf_catalog(),'FolioStressPayload',f'{ref} 0 R');doc.save(out/'v12-200MiB.pdf',deflate=False)
