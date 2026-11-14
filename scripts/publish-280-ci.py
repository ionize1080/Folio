"""Publish only the exact package accepted by this Windows Actions job."""
from pathlib import Path
import hashlib
import json
import os
import zipfile

from release_transport import gh, publish
from release_251_checks import validate_export_review
from release_260_checks import validate_editing

root = Path(__file__).resolve().parents[1]
out = root / 'deliverables'
repo, sha = os.environ['GITHUB_REPOSITORY'], os.environ['GITHUB_SHA']
tag, prefix = 'v2.8.0', 'Folio-PDF-Studio-2.8.0'
assert json.loads((root / 'package.json').read_text())['version'] == '2.8.0'
reports = {}
suite_provenance = {}
for suite in ['modern280','saveintegrity','native1','native2','native3','native4','native5','native6','editing1','editing2','editing3','editing4','editingui','docengine','docui','mcp','ui','ai','creative','creativeui270','creativeplacement','organizer','build280','packaged2801','packaged2802','packaged2803','packaged2804','packageupdate','creativelive','livecontext','liveedit','liveimage','workflow']:
    provenance = json.loads((root / 'tests/output' / ('ci-' + suite + '.json')).read_text(encoding='utf-8'))
    assert provenance == dict(suite=suite, sourceCommit=sha, runId=os.environ['GITHUB_RUN_ID']), 'Mismatched parallel test provenance'
    suite_provenance[suite] = provenance
native_reports=[json.loads((root/'tests/output'/f'native-{i}-regression-report.json').read_text()) for i in range(1,7)]
manifest=json.loads((root/'scripts/acceptance.json').read_text())['native']
for i,r in enumerate(native_reports,1):
    assert r['status']=='passed' and r['shard']==i and r['shards']==6
    assert [c['capability'] for c in r['checks']]==[c['capability'] for n,c in enumerate(manifest) if n%6==i-1]
    assert all(c['status']=='passed' for c in r['checks'])
(root/'tests/output/native-regression-report.json').write_text(json.dumps({'status':'passed','shards':native_reports}))
for name in ['ribbon-280.json','tabs-280.json','modern-280.json','organizer-features.json','printing-270.json','printing-270-render-checks.json','incremental-corpus-270.json','save-performance-270.json','studio-canvas-270.json','studio-270-native.json','studio-270-ui.json','selection-270.json','editing-260-package.json','editing-260-ui.json','editing-260-native.json',*[f'editing-{i}-260.json' for i in range(1,5)],'design-251.json','close-251.json','export-review-251.json','refinements-251.json','workflow-250.json','workflow-live-250.json','organizer-geometry.json','image-provider-ui.json','image-provider-live.json','image-studio-ui.json','pdf-loading-report.json','pdf-loading-packaged-report.json','creative-live.json','creative-engines.json','creative-embedded.json','creative-ui.json','organizer-ui.json','creative-experience.json','native-regression-report.json','mcp-regression-report.json','ci-packaged-report.json','conversion-native-report.json','conversion-scan-report.json','conversion-public-report.json','conversion-live-report.json','engineering-native-report.json','engineering-ui-report.json','workbench-ui-report.json','context-live-report.json','document-utilities-report.json', 'document-tools-ui.json', 'document-live-report.json', 'chatbox-completion-220.json', 'graphics-220-native.json', 'graphics-220-ui.json', 'graphics-220-live.json', 'ai-workflows-210.json', 'workspace-210.json', 'live-202.json', 'hosted-202.json', 'chrome-202.json', 'ai-settings.json',
             'browser-regression-report.json', 'update-python-201.json', 'packaged-ai.json', 'v201-updater-report.json',
             'v162-health-report.json', 'package-report.json']:
    reports[name] = json.loads((root / 'tests/output' / name).read_text(encoding='utf-8'))
    assert not reports[name].get('errors'), name
for name in ['document-utilities-report.json', 'document-tools-ui.json', 'document-live-report.json', 'chatbox-completion-220.json', 'graphics-220-native.json','graphics-220-ui.json','graphics-220-live.json']: assert reports[name]['status']=='passed'
for name in ['conversion-native-report.json','conversion-scan-report.json','conversion-public-report.json','conversion-live-report.json','engineering-native-report.json','engineering-ui-report.json','workbench-ui-report.json','context-live-report.json']: assert reports[name]['status']=='passed'
assert reports['incremental-corpus-270.json']['status']=='passed' and reports['incremental-corpus-270.json']['documents']>=2
assert reports['incremental-corpus-270.json']['renderedPages']>500
assert reports['studio-canvas-270.json']['status']=='passed'
assert reports['native-regression-report.json']['status'] == 'passed'
browser = reports['browser-regression-report.json']
assert browser['status'] == 'passed' and browser['stage'] == 'browser'
assert [c['capability'] for c in browser['checks']] == [c['capability'] for c in json.loads((root/'scripts/acceptance.json').read_text())['browser']]
assert all(c['status'] == 'passed' for c in browser['checks'])
assert reports['mcp-regression-report.json']['status'] == 'passed'
assert reports['mcp-regression-report.json']['coverage'] >= 75
assert reports['mcp-regression-report.json']['branchCoverage']
validate_export_review(reports['export-review-251.json'])
for name in ['ribbon-280.json','tabs-280.json','modern-280.json','organizer-features.json','design-251.json','close-251.json','refinements-251.json','workflow-250.json','workflow-live-250.json','organizer-geometry.json','image-provider-ui.json','image-provider-live.json','image-studio-ui.json','pdf-loading-report.json','pdf-loading-packaged-report.json','creative-live.json','creative-engines.json','creative-embedded.json','creative-ui.json','organizer-ui.json','creative-experience.json']:
    assert reports[name]['status']=='passed' and reports[name]['checks'], name
assert reports['creative-live.json']['apiRequests']>=5 and reports['creative-live.json']['outputTokenLimit'] is None
assert reports['creative-live.json']['placementUnchanged'] and reports['creative-live.json']['independent']['organizedPixelsExact']
live_workflow = reports['workflow-live-250.json']['liveEvidence']
assert live_workflow['apiRequests'] and all(r['maxTokens'] is None for r in live_workflow['apiRequests'])
assert any(t['completed'] and any(i['mime']=='image/png' and i['bytes']>1000 for i in t['images']) for t in live_workflow['tools'])
packaged = reports['ci-packaged-report.json']
assert packaged['status'] == 'passed' and len(packaged['checks']) == 29
assert {c['task'] for c in packaged['checks']} == {'tests/ribbon-280.cjs','tests/tabs-280.cjs','tests/modern-280.cjs','tests/organizer-features.cjs','tests/printing-270.cjs','tests/studio-canvas-270.cjs','tests/design-251.cjs','tests/close-251.cjs','tests/export-review-251.cjs','tests/refinements-251.cjs','tests/workspace-210.cjs','tests/graphics-220.cjs','tests/package-ai.cjs','tests/creative-engines.cjs','tests/creative-embedded.cjs','tests/workbench-ui.cjs','tests/engineering-ui.cjs','tests/conversion-scan.cjs','tests/creative-ui.cjs','tests/organizer-ui.cjs','tests/image-provider-settings.cjs','tests/image-studio-ui.cjs','tests/creative-experience.cjs','tests/workflow-250.cjs','tests/workflow-250-verify.py','tests/organizer-geometry.cjs','tests/pdf-loading-packaged.cjs','tests/studio-270-ui.cjs','tests/selection-270.cjs'}
assert all(c['status']=='passed' for c in packaged['checks'])
assert packaged['sourceCommit'] == sha and packaged['runId'] == os.environ['GITHUB_RUN_ID']
assert reports['graphics-220-live.json']['savedPDF']['nativeShadings']>=1
assert reports['graphics-220-live.json']['savedPDF']['images']>=2
assert reports['live-202.json']['status'] == 'passed'
assert reports['live-202.json']['independentStateChecks']
assert len(reports['live-202.json']['checks']) == 12
assert reports['chrome-202.json']['status'] == 'passed'
assert reports['ai-workflows-210.json']['scan']['searchable']
assert reports['ai-workflows-210.json']['color']['neighborPageIdentical']
assert reports['ai-workflows-210.json']['patch']['outsidePixelsIdentical']
assert reports['ai-workflows-210.json']['vector']['vectorForm']
assert reports['ai-workflows-210.json']['generatedBookmarks'] == 4
assert reports['workspace-210.json']['status'] == 'passed'
assert reports['hosted-202.json']['sharedElectron']
assert reports['hosted-202.json']['settingsReloadPersisted']
assert reports['hosted-202.json']['draftSwitches'] >= 21
assert reports['hosted-202.json']['draftImmediateReload']
assert reports['hosted-202.json']['draftCleared']
assert reports['packaged-ai.json']['tools'] == 62
assert len(set(reports['packaged-ai.json']['pdfToolNames'])) == 62
assert {'folio_studio','folio_organize'} <= set(reports['packaged-ai.json']['workspaceTools'])
info = json.loads((root / 'dist/Folio-PDF-Studio-win-x64/BUILD-INFO.json').read_text())
portable, source = out / (prefix + '-portable-win-x64.zip'), out / (prefix + '-source.zip')
with zipfile.ZipFile(portable) as z:
    assert not any('/ChatboxRuntime/' in n for n in z.namelist())
    for name, key in [('Folio.exe', 'exe_sha256'), ('resources/app.asar', 'asar_sha256')]:
        assert hashlib.sha256(z.read('Folio-PDF-Studio/' + name)).hexdigest() == info[key]
        assert reports['v201-updater-report.json'][key] == info[key]
    for required in ['resources/native/engines/ghostscript/bin/gswin64c.exe','resources/native/engines/libreoffice/program/soffice.exe','resources/creative/photo/engine_bg.wasm','resources/creative/vector/engine_bg.wasm','resources/creative/photo/licenses/Folio.md','resources/native/font_tools.py','resources/native/pdf_structure.py','resources/native/image_studio.py','resources/native/inspection_source.py','resources/native/glyph_writer.py','resources/native/font_warmup.py','resources/native/type3_restore.py']:
        assert 'Folio-PDF-Studio/'+required in z.namelist()
    for name in ['profile.cjs', 'tool-schema.cjs', 'result-cache.cjs', 'network.cjs']:
        assert z.read('Folio-PDF-Studio/resources/Chatbox/' + name) == (root / 'integrations/chatbox' / name).read_bytes()
with zipfile.ZipFile(source) as z:
    for name in ['src/incremental-pdf.mjs','src/studio-canvas-ui.mjs','src/text-selection.mjs','src/window-chrome.mjs','update-download.cjs','font-warmup.cjs','src/page-spatial.mjs','ai-dock.cjs', 'integrations/pdf-mcp-folio.patch', 'scripts/build-chatbox-source.cjs', 'src/chrome.css', 'image-provider.cjs', 'image-config.cjs', 'native/svg_gradients.py','integrations/creative/source-lock.json','integrations/creative/folio_backdrop.rs','scripts/build-creative.py','src/creative-background.mjs','src/pdf-loading.mjs','src/blank-pages.mjs','src/page-inspection-cache.mjs','integrations/creative/folio_ui_fonts.rs','integrations/chatbox/image-provider-settings.tsx']:
        assert z.read('Folio-PDF-Studio-source/' + name) == (root / name).read_bytes()
manifest_public=json.loads((root/'tests/public-editing-260.json').read_text(encoding='utf-8'))['documents']
validate_editing(manifest_public, reports)
run = f'https://github.com/{repo}/actions/runs/{os.environ["GITHUB_RUN_ID"]}'
validation = out / (prefix + '-validation.json')
validation.write_text(json.dumps(dict(sourceCommit=sha, windowsActionsRun=run, package=info,
                                     reports=reports, parallelSuites=suite_provenance, targetWin10_21H1Tested=False),
                                 indent=2), encoding='utf-8')
assets = [portable, source, validation]
checksums = out / (prefix + '-SHA256.txt')
lines = []
for file in assets:
    with file.open('rb') as stream:
        lines.append(hashlib.file_digest(stream, 'sha256').hexdigest() + '  ' + file.name + '\n')
checksums.write_text(''.join(lines), encoding='utf-8')
assets.append(checksums)
notes = []
for lang, suffix in [('en', ''), ('zh-Hans', '.zh-Hans'), ('zh-Hant', '.zh-Hant')]:
    notes.append(f'<!-- folio-locale:{lang} -->\n' + (root / f'docs/RELEASE-2.8.0{suffix}.md').read_text(encoding='utf-8') + '\n<!-- /folio-locale -->')
notes.append(f'Source: `{sha}`. Built, tested and published by [Windows Actions]({run}). Real Qwen acceptance: **passed**, including independent document-state checks.')
notes_file = out / 'release-notes.md'
notes_file.write_text('\n\n'.join(notes), encoding='utf-8')
releases = json.loads(gh('api', f'repos/{repo}/releases?per_page=100'))
assert json.loads(gh('api', f'repos/{repo}/git/ref/heads/main'))['object']['sha'] == sha, 'A newer main commit exists; publish its verified workflow instead'
draft = next((r for r in releases if r['tag_name'] == tag), None)
if draft:
    assert draft['draft'], 'Never replace a published release'
    for asset in json.loads(gh('api', f'repos/{repo}/releases/{draft["id"]}/assets')):
        assert asset['name'].startswith(prefix + '-'), 'Unexpected draft asset'
        gh('api', '--method', 'DELETE', f'repos/{repo}/releases/assets/{asset["id"]}')
    gh('release', 'edit', tag, '--repo', repo, '--target', sha, '--notes-file', str(notes_file))
publish(repo, tag, sha, 'Folio PDF Studio 2.8.0 — Modern workspace and smooth document tabs', notes_file, assets)
print(f'Published https://github.com/{repo}/releases/tag/{tag}')
