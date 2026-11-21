"""Only split a text object when both line matrices and inherited state are known."""
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'native'))
from text_advance import shared_line_site


class SharedLineSite(unittest.TestCase):
    def setUp(self):
        self.ops = [
            ([], b'BT'), (['/F1', 10], b'Tf'), ([10, 90], b'TD'), (['Title'], b'Tj'),
            ([0, -12], b'TD'), (['First'], b'Tj'), ([0, -12], b'Td'), (['Second'], b'Tj'),
            (['/F2', 8], b'Tf'), ([20, -15], b'TD'), (['Next'], b'Tj'), ([], b'ET'),
        ]
    def site(self, indices=(5, 7), extra=None):
        entries = [{'at': i, 'begin': 0, 'end': 11, **(extra or {})} for i in indices]
        return shared_line_site(SimpleNamespace(operations=self.ops), entries)
    def test_matrices_and_form_inheritance(self):
        anchor, replay, state = self.site()
        self.assertEqual(anchor, 4)
        self.assertEqual(replay, [([10, 90], b'Td'), ([0, -12], b'Td')])
        self.assertEqual(dict((op, args) for args, op in state), {b'Tf': ['/F2', 8], b'TL': [15]})
    def test_interleaved_marked_and_trailing_text(self):
        self.assertIsNone(self.site((3, 7)))
        self.assertIsNone(self.site((10,)))
        self.assertIsNone(self.site(extra={'structureScopes': [{'mcid': 1}]}))
    def test_clipping_and_ambiguous_cursor_are_left_alone(self):
        self.ops[1] = ([7], b'Tr')
        self.assertIsNone(self.site())
        self.ops[1] = (['/F1', 10], b'Tf')
        self.ops[4] = ([['ignored']], b'TJ')
        self.assertIsNone(self.site())


if __name__ == '__main__':
    unittest.main()
