"""Pass small, commit-bound test results between jobs; never pass binaries or secrets."""
from pathlib import Path
import base64, gzip, hashlib, json, os, sys

ROOT = Path(__file__).resolve().parents[1]
SUITES = {
    **{'native'+str(n):['native-'+str(n)+'-regression-report.json'] for n in range(1,4)},
    'docengine':['conversion-native-report.json','conversion-public-report.json','engineering-native-report.json','document-utilities-report.json','graphics-220-native.json'],
    'docui':['document-tools-ui.json','workbench-ui-report.json','engineering-ui-report.json','conversion-scan-report.json','web-pdf-report.json'],
    'ui':['chatbox-completion-220.json','chrome-202.json','ai-settings.json'],
    'ai':['hosted-202.json'],
    'creative':['creative-engines.json','creative-embedded.json'],
    'creativeui':['creative-ui.json','organizer-ui.json'],
    'livecontext':['document-live-report.json','conversion-live-report.json','context-live-report.json'],
    'liveedit':['ai-workflows-210.json','live-202.json'],
    'liveimage':['graphics-220-live.json'],
    'native': ['native-regression-report.json'],
    'mcp': ['mcp-regression-report.json'],
    'documents': ['conversion-native-report.json', 'conversion-public-report.json', 'engineering-native-report.json', 'document-utilities-report.json', 'document-tools-ui.json', 'workbench-ui-report.json', 'engineering-ui-report.json', 'conversion-scan-report.json', 'graphics-220-native.json', 'web-pdf-report.json'],
    'integration': ['chatbox-completion-220.json', 'chrome-202.json', 'ai-settings.json', 'hosted-202.json'],
    'live': ['document-live-report.json', 'conversion-live-report.json', 'context-live-report.json', 'graphics-220-live.json', 'ai-workflows-210.json', 'live-202.json'],
}

def valid(name, value):
    if name == 'web-pdf-report.json':
        return isinstance(value, list) and {'reader', 'original'} <= {r.get('mode') for r in value} and all(r.get('bytes', 0) > 0 for r in value)
    return isinstance(value, dict) and not value.get('errors') and value.get('status', 'passed') == 'passed'

def pack(suite, directory, sha, run_id):
    reports = {}
    for name in SUITES[suite]:
        value = json.loads((directory / name).read_text(encoding='utf-8-sig'))
        if not valid(name, value):
            raise ValueError('Failed report: ' + name)
        reports[name] = value
    payload = {'suite': suite, 'sourceCommit': sha, 'runId': str(run_id), 'reports': reports}
    data = json.dumps(payload, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()
    if len(data) > 192 * 1024:
        raise ValueError('Test metadata exceeded its bounded job-output budget')
    encoded = base64.b64encode(gzip.compress(data, mtime=0)).decode()
    if len(encoded) > 24000:
        raise ValueError('Test metadata exceeded the environment transport budget')
    return encoded

def unpack(encoded, suite, sha, run_id):
    if len(encoded) > 24000:
        raise ValueError('Oversized report bundle')
    import zlib
    decoder = zlib.decompressobj(16 + zlib.MAX_WBITS)
    data = decoder.decompress(base64.b64decode(encoded, validate=True), 192 * 1024 + 1)
    if len(data) > 192 * 1024 or decoder.unconsumed_tail or not decoder.eof:
        raise ValueError('Invalid or oversized compressed report')
    value = json.loads(data)
    if (value['suite'], value['sourceCommit'], value['runId']) != (suite, sha, str(run_id)):
        raise ValueError('Reports belong to another suite, commit or workflow run')
    if set(value['reports']) != set(SUITES[suite]):
        raise ValueError('Missing or unexpected report')
    for name, report in value['reports'].items():
        if not valid(name, report):
            raise ValueError('Failed report: ' + name)
    return value

def main():
    action, suite = sys.argv[1:3]
    out = ROOT / 'tests/output'; out.mkdir(parents=True, exist_ok=True)
    sha, run_id = os.environ['GITHUB_SHA'], os.environ['GITHUB_RUN_ID']
    if action == 'export':
        encoded = pack(suite, out, sha, run_id)
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as stream:
            stream.write('reports=' + encoded + '\n')
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as stream:
            stream.write(f'### {suite}: passed\n\nCommit `{sha}`; {len(SUITES[suite])} bounded JSON reports. No binary artifact upload.\n')
    elif action == 'import':
        value = unpack(os.environ['FOLIO_CI_REPORTS'], suite, sha, run_id)
        for name, report in value['reports'].items():
            (out / name).write_text(json.dumps(report, indent=2), encoding='utf-8')
        (out / ('ci-' + suite + '.json')).write_text(json.dumps({k: v for k, v in value.items() if k != 'reports'}), encoding='utf-8')
    else:
        raise ValueError('Unknown report action')

if __name__ == '__main__': main()
