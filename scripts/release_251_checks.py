"""Validate Office bypass evidence, whose report has results rather than checks."""


def validate_export_review(report):
    assert report['status'] == 'passed' and not report.get('errors')
    results, trace = report['results'], report['trace']
    for key in ('blocked', 'saved', 'withoutOCR', 'unchanged'):
        assert results[key] is True, key
    assert results['ocr'] == 0, 'Skipping OCR must not run recognition'
    assert trace['ocr'] == 2 and trace['skipped'] > 0, 'Review bypass was not exercised'
    outputs = results['outputs']
    assert len(outputs) == 2
    assert {item['name'] for item in outputs} == {
        'conversion-scan-export-word.docx', 'conversion-scan-export-excel.xlsx'}
    for item in outputs:
        assert item['size'] > 500 and item['signature'] == [80, 75, 3, 4], item['name']
