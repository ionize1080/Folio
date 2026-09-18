from pathlib import Path
import fitz,pikepdf,hashlib,json
out=Path(__file__).resolve().parent/'output';out.mkdir(exist_ok=True)
doc=fitz.open();p=doc.new_page();p.insert_text((72,110),'Encrypted open regression. Text remains editable.',fontsize=12)
doc.set_toc([[1,'Chapter 1',1]]);doc.set_metadata({'title':'Encrypted open regression','author':'Folio QA'})
plain=out/'p1-plain.pdf';doc.save(plain);doc.close()
variants=[('rc4',2,'correct','owner',False),('aes128',4,'correct','owner',True),('aes256',6,'correct','owner',True),('restricted',6,'','owner',True),('unicode',6,'中文密码','owner',True)]
checks=[]
for label,revision,user,owner,aes in variants:
 p=out/f'p1-{label}.pdf'
 with pikepdf.open(plain) as doc:
  doc.save(p,encryption=pikepdf.Encryption(owner=owner,user=user,R=revision,aes=aes,metadata=revision>=4,allow=pikepdf.Permissions(extract=False,modify_other=False)))
 checks.append({'file':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(out/'p1-encrypted-fixtures.json').write_text(json.dumps(checks,indent=2))
print('Created 5 encrypted fixtures')
