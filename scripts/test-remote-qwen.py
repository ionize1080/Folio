"""Bounded live acceptance; unreachable Qwen is recorded and does not block release."""
from pathlib import Path
import json, os, subprocess, urllib.request, urllib.error
out=Path('tests/output');out.mkdir(parents=True,exist_ok=True)
result={'status':'pending','checks':[]}
def probe():
    key=os.environ.get('FOLIO_QWEN_API_KEY','');url=os.environ.get('FOLIO_QWEN_API_URL','').rstrip('/')
    if not key or not url:return False,'secrets unavailable'
    if not url.endswith('/chat/completions'):url+='/chat/completions'
    payload={'model':'qwen3.8-flash','messages':[{'role':'user','content':'Reply with exactly FOLIO_REMOTE_OK'}],'stream':False}
    try:
        request=urllib.request.Request(url,data=json.dumps(payload).encode(),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json','User-Agent':'ai-sdk/openai-compatible/2.0.26 ai-sdk/provider-utils/4.0.13 runtime/browser'})
        with urllib.request.urlopen(request,timeout=25) as response:
            data=json.load(response)
            return bool(data.get('choices')),'HTTP '+str(response.status)
    except urllib.error.HTTPError as error:return False,'HTTP '+str(error.code)
    except Exception as error:return False,type(error).__name__
try:
    available,reason=probe()
    if not available:
        result.update(status='skipped-unreachable',reason=reason)
        print('Remote Qwen unavailable; continuing release:',reason)
    else:
        for script in ['tests/chatbox-api.cjs','tests/ai-model-e2e.cjs']:
            try:
                subprocess.run(['node',script],check=True,timeout=180)
                result['checks'].append(script)
            except (subprocess.CalledProcessError,subprocess.TimeoutExpired):
                available,reason=probe()
                if not available:
                    result.update(status='skipped-unreachable',reason=reason)
                    print('Qwen became unavailable; continuing release:',reason)
                    break
                result.update(status='failed',reason='Application acceptance failed while API remained reachable')
                raise
        else:result['status']='passed'
finally:
    (out/'remote-qwen.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
