// Real corpus pages, real packaged editor events and disk saves. Source PDFs
// remain read-only. No renderer model hooks or development runtime are used.
const { _electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'tests/output/packaged-corpus-v190');
fs.mkdirSync(out, {recursive:true});
const exe = path.resolve(process.env.FOLIO_EXE || '');
const python = path.join(path.dirname(exe), 'resources/native/runtime/python.exe');
const corpus = process.env.FOLIO_CORPUS || 'D:/APP/PDF Samples/Online Samples';
const background = process.env.FOLIO_BACKGROUND === '1';
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const specs = [
  {id:'chinese-body',folder:'15_Chinese_Documents',prefix:'成都华微_',page:12,starts:'报告期内',language:'zh-Hans'},
  {id:'paper-body',folder:'14_Papers',prefix:'Beyond SAEs_',page:2,starts:'that coefficients',language:'en'},
  {id:'math-paper',folder:'14_Papers',prefix:'Mahler Method',page:2,starts:'several transformations',language:'en'},
  {id:'paper-replacement',folder:'14_Papers',prefix:'Self-Building Labs',page:2,starts:'Figure 1',language:'en',replacement:'Times New Roman'},
];
const manifest = JSON.parse(execFileSync(python, ['-c', String.raw`
from pathlib import Path
import sys,json,hashlib,fitz
base=Path(sys.argv[1]);out=Path(sys.argv[2]);specs=json.loads(sys.argv[3])
for item in specs:
 source=next((base/item['folder']).rglob(item['prefix']+'*.pdf'))
 item['source']=str(source);item['source_sha256']=hashlib.sha256(source.read_bytes()).hexdigest()
 with fitz.open(source) as d:
  subset=fitz.open();subset.insert_pdf(d,from_page=item['page']-1,to_page=item['page'])
  fixture=out/(item['id']+'-input.pdf');subset.save(fixture);subset.close();item['fixture']=str(fixture)
print(json.dumps(specs,ensure_ascii=False))
`, corpus, out, JSON.stringify(specs)], {encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'}}));
const report = {checks:[], errors:[], cases:[], exe_sha256:hash(exe),
  asar_sha256:hash(path.join(path.dirname(exe),'resources/app.asar')),
  python_sha256:hash(python)};
let app, page;
function saveReport(){fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
(async()=>{
  app=await _electron.launch({executablePath:exe,args:['--user-data-dir='+fs.mkdtempSync(path.join(os.tmpdir(),'folio-corpus-v190-')),
    '--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling'],timeout:60000});
  page=await app.firstWindow();page.setDefaultTimeout(45000);
  // Hidden mode can run alongside manual comparisons. Capturing a screenshot
  // of a hidden native window can hang Chromium; screenshots require headed mode.
  if(background)await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.webContents.setBackgroundThrottling(false);win.hide();});
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.waitForSelector('[data-action="open"]');
  await page.evaluate(()=>localStorage.setItem('folio-settings',JSON.stringify({saveSummary:false})));
  async function open(file){
    await page.evaluate(()=>window.desktop.setDirty(false));await page.reload();
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
    await page.locator('[data-action="open"]').first().click();await page.waitForSelector('body.has-document');
  }
  async function stable(){
    await page.waitForFunction(()=>{
      const e=document.querySelector('#pe-status');
      if(e?.classList.contains('error'))throw Error(e.textContent);
      if(!e||!/完成|\bready\b/i.test(e.textContent)){window.__corpusReady=null;return false;}
      const old=window.__corpusReady;
      if(!old||old.text!==e.textContent){window.__corpusReady={text:e.textContent,at:performance.now()};return false;}
      return performance.now()-old.at>=400;
    });
    await page.evaluate(()=>{window.__corpusReady=null;});
  }
  async function save(file){
    fs.rmSync(file,{force:true});
    await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);
    await page.locator('[data-action="save"]').click();
    await page.waitForFunction(name=>document.querySelector('#busy').hidden&&document.querySelector('#doc-name').textContent===name&&!document.querySelector('#dirty-dot').classList.contains('changed'),path.basename(file));
    assert(fs.statSync(file).size>100);
  }
  for(const spec of manifest){
    const result={id:spec.id,source:spec.source,page:spec.page,source_sha256:spec.source_sha256};
    report.cases.push(result);console.log('START',spec.id);
    try{
      await open(spec.fixture);
      await page.locator('[data-language-select]').selectOption(spec.language);
      await page.locator('[data-action="flow-edit"]').click();
      const hit=page.locator('.page-edit-hit:not(.unavailable)');
      await hit.first().waitFor();
      const titles=await hit.evaluateAll(es=>es.map(e=>e.title));
      const index=titles.findIndex(s=>s.startsWith(spec.starts));
      assert(index>=0,`paragraph missing: ${spec.starts}; available: ${titles.join(' | ')}`);
      await hit.nth(index).click();await stable();
      const input=page.locator('.page-edit-input');
      const original=await input.inputValue();assert(original.length>50);
      if(spec.replacement){
        await input.focus();await page.keyboard.press('Control+a');
        if(await page.locator('#pe-resolve-font').isVisible())await page.locator('#pe-resolve-font').click();
        else await page.locator('#pe-font').click();
        await page.locator('#pe-font-search').fill(spec.replacement);
        await page.locator('#pe-font-list button').filter({hasText:new RegExp('^'+spec.replacement+'$')}).first().click();
        await stable();result.replacement=spec.replacement;
      }
      const at=original.search(/[\p{L}]/u);assert(at>=0);
      const edited=original.slice(0,at)+original[at]+original.slice(at);
      await input.focus();await input.evaluate((e,at)=>e.setSelectionRange(at,at),at);
      await page.keyboard.insertText(original[at]);await stable();
      assert.equal(await input.inputValue(),edited);
      await page.keyboard.press('Control+z');await stable();assert.equal(await input.inputValue(),original);
      await page.keyboard.press('Control+y');await stable();assert.equal(await input.inputValue(),edited);
      result.characters=edited.length;result.statusText=await page.locator('#pe-status').textContent();
      if(!background)await page.screenshot({path:path.join(out,spec.id+'-edited.png'),timeout:10000});
      await page.locator('#pe-done').click();
      await page.waitForFunction(()=>!document.body.classList.contains('page-edit-mode'));
      const saved=path.join(out,spec.id+'-saved.pdf');await save(saved);
      execFileSync(python,['-c',String.raw`
import sys,fitz
from collections import Counter
def compact(text):return ''.join(text.translate(str.maketrans({'ﬀ':'ff','ﬁ':'fi','ﬂ':'fl','ﬃ':'ffi','ﬄ':'ffl','ﬅ':'st','ﬆ':'st'})).split())
with fitz.open(sys.argv[1]) as a,fitz.open(sys.argv[2]) as b:
 assert len(a)==len(b)==2
 assert compact(b[0].get_text()).count(compact(sys.argv[3]))==1,'saved paragraph missing or duplicated'
 assert Counter(compact(b[0].get_text()))==Counter(compact(a[0].get_text()))+Counter(sys.argv[4]),'save changed other page text or duplicated inserted content'
 assert a[1].get_pixmap().samples==b[1].get_pixmap().samples,'shared sibling changed'
`,spec.fixture,saved,edited,original[at]],{stdio:'pipe'});
      assert.equal(hash(spec.source),spec.source_sha256,'original sample modified');
      await open(saved);await page.locator('[data-action="flow-edit"]').click();
      await page.locator('.page-edit-hit:not(.unavailable)').first().waitFor();
      const again=page.locator('.page-edit-hit:not(.unavailable)');
      const againTitles=await again.evaluateAll(es=>es.map(e=>e.title));
      const found=againTitles.findIndex(s=>s.replace(/\s/g,'')===edited.replace(/\s/g,''));
      assert(found>=0,'saved paragraph did not reopen as one editable paragraph');
      await again.nth(found).click();await stable();
      assert.equal((await input.inputValue()).replace(/\s/g,''),edited.replace(/\s/g,''));
      // Re-edit the persisted paragraph, including a line-end hyphen case.
      // A text-only read after reopening would miss preview/save ownership bugs.
      await input.focus();await input.evaluate((e,at)=>e.setSelectionRange(at,at+1),at);
      await page.keyboard.press('Backspace');await stable();
      assert.equal((await input.inputValue()).replace(/\s/g,''),original.replace(/\s/g,''));
      await page.locator('#pe-done').click();
      await page.waitForFunction(()=>!document.body.classList.contains('page-edit-mode'));
      const resaved=path.join(out,spec.id+'-resaved.pdf');await save(resaved);
      execFileSync(python,['-c',String.raw`
import sys,fitz
from collections import Counter
def compact(text):return ''.join(text.translate(str.maketrans({'ﬀ':'ff','ﬁ':'fi','ﬂ':'fl','ﬃ':'ffi','ﬄ':'ffl','ﬅ':'st','ﬆ':'st'})).split())
with fitz.open(sys.argv[1]) as a,fitz.open(sys.argv[2]) as b:
 assert compact(b[0].get_text()).count(compact(sys.argv[3]))==1,'second edit missing or duplicated'
 assert Counter(compact(b[0].get_text()))==Counter(compact(a[0].get_text())),'second edit changed page semantics'
 assert a[1].get_pixmap().samples==b[1].get_pixmap().samples,'second edit changed sibling'
`,spec.fixture,resaved,original],{stdio:'pipe'});
      result.status='passed';result.output_sha256=hash(saved);
      result.second_output_sha256=hash(resaved);
      report.checks.push(`${spec.id}: insert, undo/redo, save, text extraction, unchanged sibling, reopen/re-edit/save`);
    }catch(error){
      result.status='failed';result.error=error.message;
      if(!background)await page.screenshot({path:path.join(out,spec.id+'-failure.png'),timeout:5000}).catch(()=>{});
      result.visibleText=await page.locator('body').innerText().catch(()=>'');
      console.error('FAILED',spec.id,error.message);
    }
    saveReport();
  }
  assert.deepEqual(report.errors,[]);assert(report.cases.every(c=>c.status==='passed'),JSON.stringify(report.cases.map(c=>({id:c.id,status:c.status,error:c.error}))));
  console.log(report.checks);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  saveReport();await page?.evaluate(()=>window.desktop?.setDirty(false)).catch(()=>{});await app?.close();
});
