import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from release_251_checks import validate_export_review


class ExportReportGate(unittest.TestCase):
    def setUp(self):
        self.report = dict(status='passed', results=dict(
            blocked=True, saved=True, withoutOCR=True, unchanged=True, ocr=0,
            outputs=[dict(name=name, size=1024, signature=[80, 75, 3, 4]) for name in
                     ('conversion-scan-export-word.docx', 'conversion-scan-export-excel.xlsx')]),
            trace=dict(ocr=2, skipped=15))

    def test_results_schema_accepted_without_checks(self):
        validate_export_review(self.report)

    def test_missing_or_failed_evidence_rejected(self):
        mutations = [
            lambda r: r.update(status='failed'),
            lambda r: r.update(errors=['export failed']),
            lambda r: r.pop('results'),
            lambda r: r['results'].update(blocked=False),
            lambda r: r['results'].update(saved=False),
            lambda r: r['results'].update(withoutOCR=False),
            lambda r: r['results'].update(unchanged=False),
            lambda r: r['results'].update(ocr=1),
            lambda r: r['trace'].update(ocr=0),
            lambda r: r['trace'].update(skipped=0),
            lambda r: r['results']['outputs'].pop(),
            lambda r: r['results']['outputs'][1].update(name='conversion-scan-export-word.docx'),
            lambda r: r['results']['outputs'][0].update(size=0),
            lambda r: r['results']['outputs'][1].update(signature=[80, 75, 0, 0]),
        ]
        for index, mutate in enumerate(mutations):
            with self.subTest(case=index):
                report = copy.deepcopy(self.report)
                mutate(report)
                with self.assertRaises((AssertionError, KeyError)):
                    validate_export_review(report)

    def test_real_report_when_available(self):
        path = Path(__file__).parent / 'output/export-review-251.json'
        if not path.exists():
            self.skipTest('Produced by the separate Office UI suite')
        validate_export_review(json.loads(path.read_text(encoding='utf-8')))


if __name__ == '__main__':
    unittest.main()
