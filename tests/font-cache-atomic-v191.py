"""Independent processes must never see half-published font-cache entries.

Only isolated temporary caches are used. The legacy control reproduces the old
system-font writer in the real select_font path; it is not a claim that an
uncaptured historical UI failure had this particular key.
"""
import hashlib
import errno
import io
import json
import multiprocessing
import os
from pathlib import Path
import sys
import tempfile
import time
import traceback
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT/'native'), str(ROOT/'native/vendor')]
from font_cache import publish_font


def failure(error):
    return {'error': repr(error), 'traceback': traceback.format_exc(),
            'winerror': getattr(error, 'winerror', None),
            'errno': getattr(error, 'errno', None)}


def make_font():
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.ttGlyphPen import TTGlyphPen
    builder = FontBuilder(1000, isTTF=True)
    names = ['.notdef', 'space', 'A', 'B']
    builder.setupGlyphOrder(names)
    builder.setupCharacterMap({32: 'space', 65: 'A', 66: 'B'})
    glyphs = {}
    for name in names:
        pen = TTGlyphPen(None)
        if name != 'space':
            pen.moveTo((100, 0))
            pen.lineTo((600, 0))
            pen.lineTo((600, 700))
            pen.lineTo((100, 700))
            pen.closePath()
        glyphs[name] = pen.glyph()
    builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics({name: (700, 0) for name in names})
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupOS2(sTypoAscender=800, sTypoDescender=-200,
                    usWinAscent=800, usWinDescent=200)
    builder.setupNameTable({'familyName': 'AtomicCacheFixture',
                           'styleName': 'Regular',
                           'psName': 'AtomicCacheFixture'})
    builder.setupPost()
    stream = io.BytesIO()
    builder.save(stream)
    return stream.getvalue()


def controlled_selector(cache, source, mode, ready, proceed, results):
    """Pause the real selection entry point at the old/new publication boundary."""
    import font_cache
    import font_match
    import system_fonts
    import fontTools.ttLib
    ttfont = fontTools.ttLib.TTFont

    def stable_fixture_font(*args, **kwargs):
        kwargs['recalcTimestamp'] = False
        return ttfont(*args, **kwargs)

    font_match.CACHE = system_fonts.CACHE = Path(cache)
    item = {'path': source, 'face': 0, 'name': 'Before',
            'family': 'AtomicCacheFixture', 'source': 'fixture'}
    try:
        with patch.object(system_fonts, 'catalog', return_value={'fixture': item}), \
                patch.object(fontTools.ttLib, 'TTFont', stable_fixture_font):
            initial = system_fonts.select_font('fixture')
            key = initial['fontKey']
            # A valid legacy subset requires a real metadata update on the next
            # select, even when production correctly ignores alias-only changes.
            (Path(cache)/(key+'.json')).write_text(
                json.dumps({'name': 'Before', 'coverage': [65]}), encoding='utf8')
            results.put({'phase': 'seed', 'key': key})
            item['name'] = 'After'
            system_fonts.select_font.cache_clear()
            if mode == 'legacy':
                original_write = Path.write_text

                def paused_write(path, value, *args, **kwargs):
                    if path.suffix != '.json':
                        return original_write(path, value, *args, **kwargs)
                    if path.stem != key:
                        raise AssertionError('selection changed the content key')
                    with path.open('w', encoding='utf8') as stream:
                        # The destination is now truncated, as in write_text.
                        ready.set()
                        if not proceed.wait(20):
                            raise TimeoutError('legacy writer was not released')
                        return stream.write(value)

                def old_publish(directory, font_key, blob, info):
                    directory = Path(directory)
                    directory.mkdir(parents=True, exist_ok=True)
                    (directory/(font_key+'.ttf')).write_bytes(blob)
                    (directory/(font_key+'.json')).write_text(json.dumps(info))

                with patch.object(font_cache, 'publish_font', old_publish), \
                        patch.object(Path, 'write_text', paused_write):
                    selected = system_fonts.select_font('fixture')
            else:
                replace = font_cache.os.replace

                def paused_replace(source_path, target):
                    if Path(target).suffix == '.json':
                        if Path(target).stem != key:
                            raise AssertionError('selection changed the content key')
                        # The temporary file must already contain complete JSON.
                        pending = json.loads(Path(source_path).read_text('utf8'))
                        if not {32, 65, 66}.issubset(pending['coverage']):
                            raise AssertionError('incomplete temporary metadata')
                        ready.set()
                        if not proceed.wait(20):
                            raise TimeoutError('atomic writer was not released')
                    return replace(source_path, target)

                with patch.object(font_cache.os, 'replace', paused_replace):
                    selected = system_fonts.select_font('fixture')
            if selected['fontKey'] != key:
                raise AssertionError('selection returned a different content key')
            results.put({'phase': 'complete'})
    except BaseException as error:
        results.put({'phase': 'error', **failure(error)})


def read_cache(cache, key, results, count=20, start=None, stop=None, ready=None):
    """Read through the production loader in a separately spawned process."""
    import font_match
    font_match.CACHE = Path(cache)
    loader = font_match._load_font
    failures = []

    def observed_loader(*args):
        try:
            return loader(*args)
        except BaseException as error:
            failures.append(failure(error))
            raise

    font_match._load_font = observed_loader
    if ready is not None:
        ready.set()
    if start is not None and not start.wait(20):
        results.put({'error': 'reader start timeout'})
        return
    observations = []
    try:
        while len(observations) < count or stop is not None and not stop.is_set():
            # Bypass the reader's memoized parse so every observation exercises
            # the cross-process availability marker and program on disk.
            loader.cache_clear()
            font = font_match.load_font(key)
            if font is None:
                observations.append(None)
            else:
                blob = Path(font['path']).read_bytes()
                if hashlib.sha256(blob).hexdigest()[:32] != key:
                    raise AssertionError('reader observed a partial font program')
                observations.append({'name': font['name'],
                                     'coverage': sorted(font['coverage'])})
            if stop is not None:
                time.sleep(.001)
        results.put({'observations': observations, 'loaderErrors': failures})
    except BaseException as error:
        results.put(failure(error))


def concurrent_writer(cache, source, key, writer, start, results):
    try:
        blob = Path(source).read_bytes()
        if not start.wait(20):
            raise TimeoutError('writer start timeout')
        for i in range(80):
            publish_font(cache, key, blob, {
                'name': f'Writer-{writer}',
                'coverage': [32, 65] if (i + writer) % 2 else [32, 65, 66],
                'coverageVersion': 2,
            })
            time.sleep(.001)
        results.put({'writer': writer, 'writes': 80})
    except BaseException as error:
        results.put(failure(error))


class AtomicFontCacheTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = multiprocessing.get_context('spawn')
        cls.blob = make_font()
        cls.key = hashlib.sha256(cls.blob).hexdigest()[:32]
        cls.info = {'name': 'Fixture', 'coverage': [32, 65, 66],
                    'coverageVersion': 2}
        cls.evidence = {}

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='folio-test-font-cache-')
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.cache = self.directory/'cache'
        self.source = self.directory/'source.ttf'
        self.source.write_bytes(self.blob)

    def process(self, function, *args):
        child = self.context.Process(target=function, args=args)
        child.start()
        def close():
            if child.is_alive():
                child.kill()
            child.join(3)
        self.addCleanup(close)
        return child

    def read_separately(self, key, count=20):
        results = self.context.Queue()
        child = self.process(read_cache, str(self.cache), key, results, count)
        report = results.get(timeout=20)
        child.join(20)
        self.assertEqual(child.exitcode, 0)
        self.assertNotIn('error', report)
        return report['observations']

    def controlled(self, mode):
        ready, proceed = self.context.Event(), self.context.Event()
        results = self.context.Queue()
        child = self.process(controlled_selector, str(self.cache),
                             str(self.source), mode, ready, proceed, results)
        try:
            first = results.get(timeout=20)
            self.assertEqual(first['phase'], 'seed', first)
            self.assertTrue(ready.wait(20), 'publication boundary was not reached')
            before = self.read_separately(first['key'])
        finally:
            proceed.set()
        result = results.get(timeout=20)
        self.assertEqual(result['phase'], 'complete', result)
        child.join(20)
        self.assertEqual(child.exitcode, 0)
        after = self.read_separately(first['key'])
        self.assertTrue(all(o and {32, 65, 66}.issubset(o['coverage'])
                            for o in after))
        self.assertFalse(list(self.cache.glob('*.tmp')))
        return before, after

    def test_legacy_selection_exposes_truncated_json(self):
        before, after = self.controlled('legacy')
        self.assertEqual(before, [None] * 20)
        self.evidence['legacy'] = {'unavailableWhileTruncated': len(before),
                                   'readableAfterCompletion': len(after)}

    def test_atomic_selection_keeps_old_metadata_until_replace(self):
        before, after = self.controlled('atomic')
        self.assertTrue(all(o and o['name'] == 'Before'
                            and o['coverage'] == [65] for o in before))
        self.evidence['atomic'] = {'completeOldReadsBeforeReplace': len(before),
                                   'completeNewReadsAfterReplace': len(after)}

    def test_concurrent_writers_and_independent_reader(self):
        publish_font(self.cache, self.key, self.blob, self.info)
        start, stop, ready = (self.context.Event() for _ in range(3))
        read_results, write_results = self.context.Queue(), self.context.Queue()
        reader = self.process(read_cache, str(self.cache), self.key,
                              read_results, 200, start, stop, ready)
        writers = [self.process(concurrent_writer, str(self.cache),
                                str(self.source), self.key, i, start, write_results)
                   for i in range(3)]
        self.assertTrue(ready.wait(20), 'independent reader did not initialize')
        start.set()
        try:
            reports = [write_results.get(timeout=20) for _ in writers]
        finally:
            stop.set()
        for report in reports:
            self.assertNotIn('error', report)
        result = read_results.get(timeout=20)
        self.assertNotIn('error', result)
        for child in [reader] + writers:
            child.join(20)
            self.assertEqual(child.exitcode, 0)
        values = result['observations']
        self.assertGreaterEqual(len(values), 200)
        self.assertTrue(all(v and 65 in v['coverage'] for v in values),
                        {'unavailable': values.count(None),
                         'loaderErrors': result['loaderErrors'][:3]})
        self.assertEqual({tuple(v['coverage']) for v in values},
                         {(32, 65), (32, 65, 66)},
                         'reader must overlap actual metadata replacements')
        self.assertFalse(list(self.cache.glob('*.tmp')))
        self.evidence['concurrent'] = {'writers': 3, 'writes': 240,
                                       'independentReads': len(values),
                                       'unavailableReads': values.count(None),
                                       'recoveredSharingErrors': len(result['loaderErrors'])}

    def test_semantic_repeats_keep_mtime_and_validated_coverage(self):
        publish_font(self.cache, self.key, self.blob, self.info)
        metadata, program = self.cache/(self.key+'.json'), self.cache/(self.key+'.ttf')
        metadata.write_text(json.dumps(self.info, indent=4), encoding='utf8')
        before = metadata.stat().st_mtime_ns, program.stat().st_mtime_ns
        for _ in range(3):
            publish_font(self.cache, self.key, self.blob, dict(self.info))
        self.assertEqual(before, (metadata.stat().st_mtime_ns, program.stat().st_mtime_ns))
        publish_font(self.cache, self.key, self.blob, {
            'name': 'Alternate Alias', 'coverage': [66, 32, 65], 'coverageVersion': 2})
        self.assertEqual(before, (metadata.stat().st_mtime_ns, program.stat().st_mtime_ns))
        publish_font(self.cache, self.key, self.blob, {
            'name': 'Legacy Alias', 'coverage': [32, 65, 66, 67]})
        self.assertEqual(json.loads(metadata.read_text('utf8')), self.info)
        self.assertEqual(before, (metadata.stat().st_mtime_ns, program.stat().st_mtime_ns))

    def test_corrupt_same_length_program_and_metadata_are_repaired(self):
        publish_font(self.cache, self.key, self.blob, self.info)
        program, metadata = self.cache/(self.key+'.ttf'), self.cache/(self.key+'.json')
        corrupt = bytes([self.blob[0] ^ 255]) + self.blob[1:]
        self.assertEqual(len(corrupt), len(self.blob))
        program.write_bytes(corrupt)
        metadata.write_text('{', encoding='utf8')
        publish_font(self.cache, self.key, self.blob, self.info)
        self.assertEqual(program.read_bytes(), self.blob)
        self.assertEqual(json.loads(metadata.read_text('utf8')), self.info)
        self.assertTrue(all(self.read_separately(self.key)))

    def test_hash_mismatch_never_publishes(self):
        with self.assertRaises(ValueError):
            publish_font(self.cache, '0' * 32, self.blob, self.info)
        self.assertFalse(self.cache.exists())
        with self.assertRaises(ValueError):
            publish_font(self.cache, '../invalid', self.blob, self.info)
        self.assertFalse(self.cache.exists())

    @unittest.skipUnless(os.name == 'nt', 'Windows sharing semantics')
    def test_read_retries_only_sharing_errors_and_remains_bounded(self):
        import font_match
        from font_cache import sharing_violation
        publish_font(self.cache, self.key, self.blob, self.info)
        error = PermissionError(errno.EACCES, 'controlled sharing denial')
        self.assertIsNone(getattr(error, 'winerror', None))
        self.assertTrue(sharing_violation(error))
        self.assertFalse(sharing_violation(FileNotFoundError(errno.ENOENT, 'missing')))
        self.assertFalse(sharing_violation(OSError(errno.EIO, 'read failure')))
        metadata = self.cache/(self.key+'.json')
        with patch.object(font_match, 'CACHE', self.cache), patch('time.sleep') as sleep:
            font_match._load_font.cache_clear()
            self.assertIsNone(font_match.load_font('invalid-key'))
            self.assertIsNone(font_match.load_font('0' * 32))
            metadata.write_text('{', encoding='utf8')
            self.assertIsNone(font_match.load_font(self.key))
            sleep.assert_not_called()
            publish_font(self.cache, self.key, self.blob, self.info)
            complete = {'name': 'Complete', 'coverage': frozenset([65])}
            with patch.object(font_match, '_load_font',
                              side_effect=[error, complete]) as loader:
                self.assertIs(font_match.load_font(self.key), complete)
                self.assertEqual(loader.call_count, 2)
                sleep.assert_called_once_with(.002)
            sleep.reset_mock()
            with patch.object(font_match, '_load_font', side_effect=error) as loader:
                self.assertIsNone(font_match.load_font(self.key))
                self.assertEqual(loader.call_count, 7)
                self.assertEqual(sleep.call_count, 6)
                self.assertAlmostEqual(sum(call.args[0] for call in sleep.call_args_list), .126)
            sleep.reset_mock()
            with patch.object(font_match, '_load_font',
                              side_effect=OSError(errno.EIO, 'read failure')) as loader:
                self.assertIsNone(font_match.load_font(self.key))
                self.assertEqual(loader.call_count, 1)
                sleep.assert_not_called()
        self.evidence['retryBoundary'] = {
            'permanentSharingAttempts': 7, 'maximumRetryDelayMs': 126,
            'missingCorruptAndOtherIoRetries': 0,
        }


if __name__ == '__main__':
    result = unittest.main(exit=False).result
    output = ROOT/'tests/output/deep-edit-v191-paragraphs'
    output.mkdir(parents=True, exist_ok=True)
    report = {'checks': AtomicFontCacheTests.evidence,
              'testsRun': result.testsRun,
              'errors': [str(error) for _, error in result.errors + result.failures]}
    (output/'font-cache-atomic-report.json').write_text(
        json.dumps(report, indent=2), encoding='utf8')
    if result.wasSuccessful():
        print('shared font caches publish complete files across concurrent workers')
    raise SystemExit(0 if result.wasSuccessful() else 1)
