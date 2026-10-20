"""Background rectangles never divide stroked table cells or wrapped cell text."""
from pathlib import Path
import json, subprocess, sys
ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'native'), str(ROOT / 'native/vendor')]
import fitz
from table_geometry import inspect_tables

d = fitz.open()
p = d.new_page(width=450, height=350)
xs, ys = [50, 160, 270, 380], [50, 110, 170, 230]
for row in range(3):
    for col in range(3):
        x, y = xs[col], ys[row]
        p.draw_rect(fitz.Rect(x, y, x + 110, y + 60), color=None, fill=(.8, .9, 1))
        p.draw_rect(fitz.Rect(x, y, x + 110, y + 10), color=None, fill=(.8, .9, 1))
        p.draw_rect(fitz.Rect(x, y + 43, x + 110, y + 60), color=None, fill=(.8, .9, 1))
        for baseline in (y + 20, y + 40):
            p.draw_rect(fitz.Rect(x + 7, baseline - 10, x + 103, baseline + 3), color=None, fill=(.8, .9, 1))
            p.insert_text((x + 9, baseline), f'cell {row},{col} line', fontsize=10)
for x in xs:
    p.draw_line((x, ys[0]), (x, ys[-1]), color=(0, 0, 0), width=.5)
for y in ys:
    p.draw_line((xs[0], y), (xs[-1], y), color=(0, 0, 0), width=.5)
raw = d.tobytes()
tables = inspect_tables(raw, 1)
assert len(tables) == 1, tables
table = tables[0]
assert (table['rows'], table['columns'], len(table['cells'])) == (3, 3, 9), table
assert all(c['bounds'][2] - c['bounds'][0] == 110 and c['bounds'][3] - c['bounds'][1] == 60 for c in table['cells'])
assert len(p.find_tables().tables[0].cells) == 27, 'fixture must reproduce fill-induced false cells'
print(json.dumps({'checks': ['stroked 3x3 grid ignores per-line background rectangles', 'wrapped lines share one full-height cell'], 'cells': len(table['cells'])}))
