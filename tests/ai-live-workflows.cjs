const assert=require("node:assert/strict"),path=require("node:path"),fs=require("node:fs");
const {execFileSync}=require("node:child_process");
module.exports=async function workflows({app,host,chat,ask}){
  const out=path.resolve("tests/output"), validation={};
  const resolve=n=>path.resolve(out,n);
  async function open(file){
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]})},file);
    await host.evaluate(()=>window.desktop.openDocuments());
    const active=(await host.evaluate(()=>window.desktop.tabsState())).activeDocumentId;
    for(const p of app.context().pages())if(p.url().startsWith("folio://") && (await p.evaluate(()=>window.desktop.tabsState())).self===active)return p;
    throw Error("Editor not found");
  }
  async function save(p,name){
    const file=resolve(name);
    await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file})},file);
    await p.evaluate(()=>document.querySelector('[data-action="save-as"]').click());
    await p.waitForFunction(name=>document.querySelector('#doc-name').textContent===name,name,{timeout:90000});
    return file;
  }
  function verify(mode,file){
    validation[mode]=JSON.parse(execFileSync(process.env.FOLIO_PYTHON||"python",[path.resolve("tests/verify-ai-pixels.py"),mode,file],{encoding:"utf8"}).trim());
  }
  const enabled=key=>!process.env.FOLIO_DEV_CASE || process.env.FOLIO_DEV_CASE===key;
  if(enabled("summary")){
    await open(path.resolve("tests/fixtures/NIST.FIPS.197-upd1.pdf"));
    await ask("请用中文概括当前 NIST 标准。请用带物理页码的原文证据说明 AES 的分组长度和三种密钥长度，并概括 2023 年修订内容。","folio_document",(trace,answer)=>{
      assert(trace.some(t=>['brief','text'].includes(t.arguments.action)));
      for(const size of ["128","192","256"])assert(answer.includes(size),answer);
      assert(/AES/i.test(answer)&&/页|page/i.test(answer),answer);
    });
  }
  if(enabled("bookmarks")){
    const p=await open(resolve("field-notes.pdf"));
    await ask("按实际标题 Station 加数字，在这个文档四页上批量生成一级书签，替换原有书签。每页一条，标题使用完整匹配行。","folio_bookmarks",()=>{});
    const nodes=await p.evaluate(async()=>(await import("./app.mjs")).S.nodes.map(n=>[n.title,n.target.page]));
    assert.deepEqual(nodes,[1,2,3,4].map(n=>["Station "+n,n]));
    validation.generatedBookmarks=nodes.length;
  }
  if(enabled("scan")){
    const scan=await open(resolve("faded-scan.pdf"));
    await ask("这张扫描件字迹发灰。先预览彩色扫描增强，再基于预览微调一条轻微 S 曲线并适度锐化，看过两次预览后应用。然后对当前页做本地 OCR，把识别文字层写入 PDF，让它可以检索。","folio_image",trace=>{
      const images=trace.filter(t=>t.name==="folio_image").map(t=>t.arguments);
      assert(images.filter(a=>a.action==="preview").length>=2 && images.some(a=>a.action==="apply"));
    });
    const file=await save(scan,"enhanced-scan.pdf");
    verify("scan",file);
    // Original source has a distinct tab after Save As.
  }
  if(enabled("replace")){
    const scan=await open(resolve("faded-scan.pdf"));
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]})},resolve("replacement-patch.png"));
    await ask("用我在文件选择器中提供的图片替换当前扫描图左上角四分之一宽、四分之一高的区域（归一化 [0,0,0.25,0.25]）。保留区域外像素。查看候选图后应用。","folio_image",trace=>{
      assert(trace.some(t=>t.arguments.action==="replace") && trace.some(t=>t.arguments.action==="apply"));
    });
    verify("patch",await save(scan,"patched-scan.pdf"));
  }
  if(enabled("color")){
    const doc=await open(resolve("color-proof.pdf"));
    await ask("给当前页的色彩校样做自然暖调。先查看整体预览，再基于预览使用暖色查找滤镜、轻微降低饱和度和一条温和的 RGB S 曲线。请用局部细节预览检查，再应用。保留原图分辨率和第二页。","folio_image",trace=>{
      const previews=trace.filter(t=>t.name==="folio_image" && t.arguments.action==="preview");
      assert(previews.length>=2 && previews.some(t=>t.arguments.region),'Actual visual iteration, including a cropped preview');
      assert(previews.every(t=>Math.max(...t.dimensions)<=1200));
    });
    const edits=await doc.evaluate(async()=>(await import("./app.mjs")).S.nativeEdits.map(({page,adjustments})=>({page,adjustments})));
    assert.equal(edits.length,1);assert.equal(edits[0].page,1);
    const a=edits[0].adjustments;
    assert(a.lookup==="warm"&&a.saturation<0&&a.curves?.length>=3,JSON.stringify(a));
    verify("color",await save(doc,"color-proof-edited.pdf"));
  }
  if(enabled("vector")){
    const doc=await open(resolve("field-notes.pdf"));
    await ask("在第1页嵌入一个可再编辑的矢量流程图：三个从上到下的步骤，英文标签依次为 Collect、Check、Release，用箭头相连。","folio_vector",trace=>assert(trace.some(t=>t.arguments.action==="create")));
    const first=await save(doc,"flow-first.pdf");
    await doc.evaluate(async()=>window.desktop.tabClose((await window.desktop.tabsState()).self)).catch(()=>{});
    const reopened=await open(first);
    await ask("编辑第1页已有的流程图，把最后一个节点的文字 Release 改成 Publish。保留其它节点和它们的连接。","folio_vector",trace=>assert(trace.some(t=>t.arguments.action==="update")));
    verify("vector",await save(reopened,"flow-updated.pdf"));
  }
  fs.writeFileSync(resolve("ai-workflows-210.json"),JSON.stringify(validation,null,2));
};
