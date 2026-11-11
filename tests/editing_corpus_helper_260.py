"""Shared model construction follows the renderer's actual selection/style code."""
import json,pathlib,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[1]
def js(code,data):
    script="let s='';for await(const c of process.stdin)s+=c;let v=JSON.parse(s);"+code
    return json.loads(subprocess.check_output(['node','--input-type=module','-e',script],input=json.dumps(data).encode(),cwd=ROOT,timeout=60))
def candidates(data):
    return js("import{pageCandidates}from'./src/flow-page-model.mjs';console.log(JSON.stringify(pageCandidates(v.objects,...v.size,[],v.tables).map(c=>c.model)));",data)
def edited(model,text):
    return js("import{editStyles,editSoftBreaks}from'./src/flow-style.mjs';let m=v.model;m.runs=editStyles(m.runs||[],m.text,v.text,m);m.softBreaks=editSoftBreaks(m.softBreaks||[],m.text,v.text);m.text=v.text;console.log(JSON.stringify(m));",{'model':model,'text':text})
