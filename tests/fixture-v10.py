"""Shared, reproducible three-page fixture for table and OCR review UI tests."""
from pathlib import Path
import fitz
out=Path(__file__).resolve().parent/'output'
with fitz.open(out/'v9-fixture.pdf') as source,fitz.open() as doc:
 for _ in range(3):doc.insert_pdf(source)
 doc.save(out/'v10-review-fixture.pdf')
