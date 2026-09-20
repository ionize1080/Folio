"""Valid sparse PDF for the real >768 MiB desktop open / save route."""
from pathlib import Path
import sys
p=Path(sys.argv[1]);size=int(sys.argv[2]) if len(sys.argv)>2 else 800*1024**2
offsets={}
with p.open('wb') as f:
 f.write(b'%PDF-1.7\n');offsets[4]=f.tell();f.write(f'4 0 obj\n<< /Length {size} >>\nstream\n'.encode());start=f.tell();f.seek(start+size);f.write(b'\nendstream\nendobj\n')
 for n,obj in [(1,'<< /Type /Catalog /Pages 2 0 R >>'),(2,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),(3,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>')]:
  offsets[n]=f.tell();f.write(f'{n} 0 obj\n{obj}\nendobj\n'.encode())
 xref=f.tell();f.write(b'xref\n0 5\n0000000000 65535 f \n')
 for n in range(1,5):f.write(f'{offsets[n]:010d} 00000 n \n'.encode())
 f.write(f'trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode())
