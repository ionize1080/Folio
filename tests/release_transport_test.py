import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import json

spec = importlib.util.spec_from_file_location('release_transport', Path(__file__).resolve().parents[1] / 'scripts/release_transport.py')
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)


class ReleaseTransportTests(unittest.TestCase):
    def scenario(self, mismatch=False, wrong_commit=False, delayed=False):
        with tempfile.TemporaryDirectory() as folder:
            asset = Path(folder) / 'package.zip'
            asset.write_bytes(b'the exact accepted binary')
            digest = 'sha256:' + hashlib.sha256(asset.read_bytes()).hexdigest()
            state = {'release': None, 'assets': [], 'creates': 0, 'uploads': 0, 'hidden_reads': 2 if delayed else 0}

            def fake(*args, **kwargs):
                if args[0] == 'api':
                    if args[-1].endswith('/releases?per_page=100&page=1'):
                        if state['release'] and state['hidden_reads']:
                            state['hidden_reads'] -= 1
                            return '[]'
                        return json.dumps([state['release']] if state['release'] else [])
                    if args[-1].endswith('/releases/1'):
                        return json.dumps(state['release'])
                    if args[-1].endswith('/assets'):
                        return json.dumps(state['assets'])
                if args[:2] == ('release', 'create'):
                    state['creates'] += 1
                    state['release'] = {'id': 1, 'tag_name': 'v1', 'draft': True, 'target_commitish': 'other' if wrong_commit else 'sha'}
                    if mismatch:
                        state['assets'] = [{'name': asset.name, 'state': 'uploaded', 'size': asset.stat().st_size, 'digest': 'sha256:other'}]
                    raise RuntimeError('TLS handshake timeout after remote create')
                if args[:2] == ('release', 'upload'):
                    state['uploads'] += 1
                    state['assets'] = [{'name': asset.name, 'state': 'uploaded', 'size': asset.stat().st_size, 'digest': digest}]
                    raise RuntimeError('Connection timeout after remote upload')
                if args[:2] == ('release', 'edit'):
                    state['release']['draft'] = False
                    raise RuntimeError('Connection timeout after remote publish')
                raise AssertionError(args)

            with patch.object(transport, 'gh', side_effect=fake), patch.object(transport.time, 'sleep'):
                if mismatch or wrong_commit:
                    with self.assertRaises(AssertionError):
                        transport.publish('owner/repo', 'v1', 'sha', 'title', Path(folder)/'notes', [asset])
                    self.assertEqual(state['uploads'], 0)
                    self.assertTrue(state['release']['draft'])
                else:
                    transport.publish('owner/repo', 'v1', 'sha', 'title', Path(folder)/'notes', [asset])
                    self.assertFalse(state['release']['draft'])
                    self.assertEqual(state['creates'], 1)
                    self.assertEqual(state['uploads'], 1)
                    transport.publish('owner/repo', 'v1', 'sha', 'title', Path(folder)/'notes', [asset])
                    self.assertEqual(state['uploads'], 1)

    def test_unknown_outcomes_resume_without_duplicate_or_overwrite(self):
        self.scenario()

    def test_conflicting_asset_is_not_overwritten(self):
        self.scenario(mismatch=True)

    def test_wrong_commit_is_not_published(self):
        self.scenario(wrong_commit=True)

    def test_delayed_draft_visibility_does_not_create_duplicates(self):
        self.scenario(delayed=True)


if __name__ == '__main__':
    unittest.main()
