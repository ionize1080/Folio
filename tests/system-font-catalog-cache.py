"""Check font name index reuse across worker lifetimes and font installations."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'native'))
import system_fonts


class FaceCatalogCacheTest(unittest.TestCase):
    def test_file_changes_and_cache_repair(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fonts = root / 'fonts'
            fonts.mkdir()
            font = fonts / 'sample.ttf'
            font.write_bytes(b'first')
            scan = Path.rglob
            faces = [['Family', 'Regular', 'Localized Name', 'PostScriptName', ['Alias']]]

            def fixture_scan(directory, pattern):
                return scan(directory, pattern) if directory == fonts else iter(())

            def restart():
                system_fonts.catalog.cache_clear()
                return system_fonts.catalog()

            self.addCleanup(system_fonts.catalog.cache_clear)
            with (
                patch.dict(os.environ, {'FOLIO_FONT_MATCH_CACHE': str(root / 'cache')}),
                patch.object(system_fonts, '__file__', str(root / 'system_fonts.py')),
                patch.object(Path, 'rglob', fixture_scan),
                patch.object(system_fonts, 'read_faces', return_value=(faces, True)) as read,
            ):
                first = restart()
                self.assertEqual(len(first), 1)
                self.assertEqual(restart(), first)
                read.assert_called_once()
                stat = font.stat()
                os.utime(font, ns=(stat.st_atime_ns, stat.st_mtime_ns + 2_000_000_000))
                changed = restart()
                self.assertEqual(len(changed), 1)
                self.assertNotEqual(changed.keys(), first.keys())
                self.assertEqual(read.call_count, 2)
                other = fonts / 'new.ttf'
                other.write_bytes(b'new')
                self.assertEqual(len(restart()), 2)
                other.unlink()
                self.assertEqual(restart(), changed)
                disk, = (root / 'cache').glob('*.cache')
                disk.write_text('{', encoding='utf-8')
                self.assertEqual(restart(), changed)
                data = json.loads(disk.read_text(encoding='utf-8'))
                data[str(font.resolve())][1] = [['invalid']]
                disk.write_text(json.dumps(data), encoding='utf-8')
                self.assertEqual(restart(), changed)
                disk.unlink()
                read.return_value = [], False
                self.assertEqual(restart(), {})
                read.return_value = faces, True
                self.assertEqual(restart(), changed)


if __name__ == '__main__':
    unittest.main()
