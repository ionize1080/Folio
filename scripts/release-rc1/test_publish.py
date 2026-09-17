import base64
import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import zlib
import publish


class FinalizeTests(unittest.TestCase):
    def setUp(self):
        recipe = json.loads(zlib.decompress(base64.b64decode(Path(__file__).with_name('recipe.zlib.b64').read_text())))
        self.release = {'id': 390649849, 'tag_name': publish.TAG, 'target_commitish': publish.TARGET,
                        'draft': True, 'prerelease': True, 'html_url': 'https://github.com/ionize1080/Folio/releases/tag/v1.2.0-rc1',
                        'assets': [{'name': x['name'], 'size': x['size'], 'digest': 'sha256:' + x['sha256'], 'state': 'uploaded'} for x in recipe['outputs']]}

    def test_matching_assets_publish_by_release_id(self):
        result = dict(self.release, draft=False)
        with patch.object(publish, 'gh') as write, patch.object(publish, 'api', side_effect=[result, {'object': {'sha': publish.TARGET}}]):
            publish.finalize(self.release)
            self.assertEqual(write.call_count, 1)
            self.assertIn('repos/ionize1080/Folio/releases/390649849', write.call_args.args)

    def test_corruption_never_publishes(self):
        self.release['assets'][0]['digest'] = 'sha256:bad'
        with patch.object(publish, 'gh') as write, self.assertRaises(RuntimeError):
            publish.finalize(self.release)
        write.assert_not_called()

    def test_wrong_target_never_publishes(self):
        self.release['target_commitish'] = 'main'
        with patch.object(publish, 'gh') as write, self.assertRaises(RuntimeError):
            publish.finalize(self.release)
        write.assert_not_called()

    def test_missing_asset_never_publishes(self):
        self.release['assets'].pop()
        with patch.object(publish, 'gh') as write, self.assertRaises(RuntimeError):
            publish.finalize(self.release)
        write.assert_not_called()


if __name__ == '__main__':
    unittest.main()
