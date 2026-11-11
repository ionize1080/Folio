import copy
import pathlib
import sys
import unittest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
from release_260_checks import validate_editing


class EditingReleaseEvidence(unittest.TestCase):
    def setUp(self):
        self.manifest = [dict(sha256=str(i), samplePages=[1], minPassed=1) for i in range(4)]
        self.reports = {}
        for i, entry in enumerate(self.manifest, 1):
            document = dict(entry, status='passed', passed=1, limited=[dict(reason='explicit limitation')],
                            pages=[dict(page=1, attempts=[dict(status='passed'), dict(status='limited')])])
            self.reports[f'editing-{i}-260.json'] = dict(status='passed', shard=i, shards=4, documents=[document])
        self.reports['editing-260-ui.json'] = dict(status='passed', checks=['edit/save', 'reopen'])
        self.reports['editing-260-package.json'] = dict(status='passed', checks=['bytes match', 'packaged worker'])
        self.reports['editing-260-native.json'] = dict(status='passed', checks=4)

    def test_complete_evidence(self):
        validate_editing(self.manifest, self.reports)

    def test_failed_incomplete_or_inflated_evidence(self):
        def doc(reports): return reports['editing-1-260.json']['documents'][0]
        mutations = [
            lambda r: r['editing-1-260.json'].update(shard=2),
            lambda r: r['editing-1-260.json']['documents'].clear(),
            lambda r: r['editing-1-260.json']['documents'].append(copy.deepcopy(doc(r))),
            lambda r: doc(r).update(sha256='unknown'),
            lambda r: doc(r).update(samplePages=[2]),
            lambda r: doc(r)['pages'].clear(),
            lambda r: doc(r)['pages'][0]['attempts'][0].update(status='failed'),
            lambda r: doc(r)['pages'][0]['attempts'][0].update(status='limited'),
            lambda r: doc(r).update(passed=2),
            lambda r: doc(r)['limited'].clear(),
            lambda r: r['editing-260-package.json'].update(status='failed'),
            lambda r: r['editing-260-ui.json'].update(checks=[]),
            lambda r: r['editing-260-native.json'].update(checks=3),
        ]
        for index, mutate in enumerate(mutations):
            with self.subTest(index=index):
                reports = copy.deepcopy(self.reports)
                mutate(reports)
                with self.assertRaises((AssertionError, KeyError)):
                    validate_editing(self.manifest, reports)


if __name__ == '__main__': unittest.main()
