"""Editing release evidence; limitations must never become successful edits."""

def validate_editing(manifest, reports):
    seen = []
    assert len({d['sha256'] for d in manifest}) == len(manifest)
    for shard in range(1, 5):
        result = reports[f'editing-{shard}-260.json']
        assert result['status'] == 'passed' and not result.get('errors')
        assert result['shard'] == shard and result['shards'] == 4
        expected = {d['sha256']: d for n, d in enumerate(manifest) if n % 4 == shard - 1}
        assert {d['sha256'] for d in result['documents']} == set(expected)
        for document in result['documents']:
            spec = expected[document['sha256']]
            assert document['status'] == 'passed'
            assert document['samplePages'] == spec['samplePages']
            assert [p['page'] for p in document['pages']] == spec['samplePages']
            attempts = [a for page in document['pages'] for a in page['attempts']]
            assert all(a['status'] in ('passed', 'limited') for a in attempts)
            passed = sum(a['status'] == 'passed' for a in attempts)
            assert document['passed'] == passed and passed >= spec['minPassed']
            assert len(document['limited']) == sum(a['status'] == 'limited' for a in attempts)
            seen.append(document['sha256'])
    assert len(seen) == len(set(seen)) == len(manifest)
    for name, minimum in [('editing-260-ui.json', 2), ('editing-260-package.json', 2)]:
        report = reports[name]
        assert report['status'] == 'passed' and not report.get('errors')
        assert len(report['checks']) >= minimum
    native = reports['editing-260-native.json']
    assert native['status'] == 'passed' and not native.get('errors') and native['checks'] == 4
