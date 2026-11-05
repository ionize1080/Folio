const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {performance} = require("node:perf_hooks");

(async () => {
  const app = await electron.launch({
    executablePath:process.env.FOLIO_EXE, args:process.env.FOLIO_EXE ? [] : [path.resolve(".")], env:{...process.env,FOLIO_TEST_BACKGROUND:"1",
      FOLIO_TEST_PROFILE:path.resolve("tests/output/workspace-"+Date.now())}
  });
  try {
    const home = await app.firstWindow();
    await home.locator(".folio-ai-open").waitFor();
    const names = ["ai-202.pdf","field-notes.pdf"];
    const files = names.map(n=>path.resolve("tests/output",n));
    const pick = paths => app.evaluate(({dialog},paths)=>{
      dialog.showOpenDialog = async (_window,options) => {
        if (!options.properties.includes("multiSelections")) throw Error("Expected multi-select picker");
        return {canceled:false,filePaths:paths};
      };
    },paths);
    await pick(files);
    const created = app.context().waitForEvent("page", p=>p!==home);
    await home.evaluate(()=>window.desktop.openDocuments());
    const other = await created;
    assert.equal(await other.locator(".document-tab").count(),2);
    await other.locator(".tree-row .title").first().click();
    await other.waitForFunction(()=>document.querySelector("#page-number").value==="3");
    const getState = () => home.evaluate(()=>window.desktop.tabsState());
    const {documents} = await getState();
    const times=[];
    for (let i=0;i<12;i++) {
      const target=documents[i%2].documentId;
      const start=performance.now();
      await home.evaluate(id=>window.desktop.tabSelect(id),target);
      assert.equal((await getState()).activeDocumentId,target);
      times.push(performance.now()-start);
    }
    assert.equal(await other.locator("#page-number").inputValue(),"3");
    assert.equal(await other.locator(".tree-row.selected .title").innerText(),"Field observation");
    await pick([files[0]]);
    await other.evaluate(()=>window.desktop.openDocuments());
    assert.equal((await getState()).documents.length,2);
    assert.equal((await getState()).activeDocumentId,documents[0].documentId);
    await home.locator("[data-action=settings]").click();
    await home.locator("#settings-language").selectOption("zh-Hans");
    await home.locator("#set-theme").selectOption("light");
    await home.locator("input[name=palette][value=jade]").locator("..").click();
    await home.locator("#modal-footer .primary").click();
    await home.locator("#modal").waitFor({state:"hidden"});
    await other.waitForFunction(()=>getComputedStyle(document.body).getPropertyValue("--accent").toLowerCase()==="#007565");
    const accent = p=>p.evaluate(()=>getComputedStyle(document.body).getPropertyValue("--accent"));
    assert.match(await accent(home),/^#007565$/i);
    assert.equal(await accent(other),await accent(home));
    await home.locator("button[data-action=add]").first().click();
    await home.waitForFunction(async()=>(await window.desktop.tabsState()).documents.some(d=>d.dirty));
    await other.evaluate(id=>window.desktop.tabSelect(id),documents[1].documentId);
    // Closing an inactive dirty tab must activate that document and permit cancellation.
    await other.locator(".document-tab").first().locator(".tab-close").click();
    await home.locator("#modal[open]").waitFor();
    await home.locator("#modal-footer button").first().click();
    assert.equal((await getState()).documents.length,2);
    assert((await getState()).documents[0].dirty);
    await home.locator(".document-tab").first().locator(".tab-close").click();
    await home.locator("#modal-footer button").nth(1).click();
    await other.waitForFunction(async()=>(await window.desktop.tabsState()).documents.length===1);
    assert.equal(await other.locator("#page-number").inputValue(),"3");
    await other.screenshot({path:"tests/output/workspace-210.png"});
    await other.locator(".tab-close").click();
    await home.waitForFunction(async()=>(await window.desktop.tabsState()).documents.length===0);
    assert(await home.locator("#welcome").isVisible());
    await pick([files[1]]);
    await home.evaluate(()=>window.desktop.openDocuments());
    assert.equal((await getState()).documents.length,1);
    fs.writeFileSync("tests/output/workspace-210.json",JSON.stringify({
      status:"passed",multiSelect:true,dirtyCloseCancel:true,closeLastAndReopen:true,
      selectionRetained:true,preferencesShared:true,switchMs:times,medianSwitchMs:times.sort((a,b)=>a-b)[6]
    },null,2));
    console.log("PASS workspace, median activation",times[6],"ms");
  } finally {await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});
