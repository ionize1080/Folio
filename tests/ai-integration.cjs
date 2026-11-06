const { _electron: electron } = require("playwright"),
  path = require("path"),
  assert = require("assert/strict");
(async () => {
  const app = await electron.launch({
    args: [path.resolve(".")],
    env: {
      ...process.env,
      FOLIO_TEST_BACKGROUND: "1",
      FOLIO_TEST_PROFILE: path.resolve(
        "tests/output/integration-" + Date.now(),
      ),
    },
    timeout: 60000,
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(700);
    let dialogs = 0,
      acceptDialogs = true;
    page.on("dialog", (d) => {
      dialogs++;
      return acceptDialogs ? d.accept() : d.dismiss();
    });
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, path.resolve("tests/output/modes.pdf"));
    await page.locator('[data-action="open"]').first().click();
    await page.waitForFunction(() =>
      document.querySelector("#doc-name").textContent.includes("modes"),
    );
    await page.waitForTimeout(1000);
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("ai-reply");
      ipcMain.handle("ai-reply", (_e, v) => {
        globalThis.aiResult = v;
      });
    });
    let id = 0;
    async function call(name, args) {
      const current = ++id;
      await app.evaluate(
        ({ BrowserWindow }, { current, name, args }) => {
          globalThis.aiResult = null;
          BrowserWindow.getAllWindows()[0].webContents.send("ai-request", {
            id: current,
            params: { name, arguments: args },
          });
        },
        { current, name, args },
      );
      let result;
      for (let n = 0; n < 1200; n++) {
        result = await app.evaluate(() => globalThis.aiResult);
        if (result) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      assert(result, "response timeout");
      return result;
    }
    let d = await call("folio_operation", { operation: "document.describe" });
    assert(!d.error, d.error);
    console.log("describe", d.result);
    acceptDialogs = false;
    let refused = await call("folio_operation", {
      operation: "bookmark.create",
      revision: d.result.revision,
      options: { title: "must not be created", page: 1 },
    });
    assert(refused.error?.includes("拒绝"));
    const unchanged = await call("folio_operation", {
      operation: "document.describe",
    });
    assert.equal(unchanged.result.revision, d.result.revision);
    acceptDialogs = true;
    const beforeApproval = dialogs;
    await page.locator('[data-action="settings"]').click();
    await page.locator("#set-ai-approval").selectOption("auto");
    await page.locator("#modal-footer .primary").click();
    assert.equal(
      dialogs - beforeApproval,
      2,
      "automatic approval must confirm twice",
    );
    assert.equal(
      await page.locator(".folio-ai-open").evaluate((e) => e.style.color),
      "",
    );
    let r = await call("folio_operation", {
      operation: "bookmark.create",
      revision: d.result.revision,
      options: { title: "AI test", page: 1 },
    });
    assert(r.result?.applied, r.error);
    assert.equal(
      dialogs - beforeApproval,
      2,
      "automatic execution must not ask again",
    );
    const revision = r.result.revision;
    console.log("create applied");
    r = await call("folio_operation", {
      operation: "bookmark.create",
      revision: d.result.revision,
      options: { title: "stale", page: 1 },
    });
    assert(r.error?.includes("版本"));
    console.log("stale rejected");
    r = await call("folio_operation", {
      operation: "page.image",
      revision,
      options: { page: 1, purpose: "classify" },
    });
    assert(r.result?.content?.[1]?.type === "image", r.error);
    console.log("image", JSON.parse(r.result.content[0].text));
    // Force confident direction conflicts; the real native writer must accept
    // explicit incremental review, never silently drop unresolved blocks.
    await app.evaluate(({ipcMain})=>{
      const native=ipcMain._invokeHandlers.get('native');
      ipcMain.removeHandler('native');
      ipcMain.handle('native',(event,data)=>data.command==='ocr'?{
        page:1,blocks:['PROOFREADALPHA','PROOFREADBETA'].map((text,index)=>({
          page:1,text,confidence:0.99,needsReview:true,reviewAccepted:false,
          reviewReasons:['direction-conflict'],quad:[[50,150+30*index],[250,150+30*index],[250,130+30*index],[50,130+30*index]]
        }))
      }:native(event,data));
    });
    r=await call('folio_operation',{operation:'ocr.local',revision,options:{page:1,apply:true}});
    assert(!r.error,r.error);assert.equal(r.result.applied,false);
    assert.equal(r.result.review.length,2);assert.equal(r.result.lowConfidence.length,2);
    const jobId=r.result.jobId;
    r=await call('folio_operation',{operation:'ocr.apply',revision,options:{jobId,corrections:[{index:0,text:'PROOFREADALPHA'}]}});
    assert(!r.error,r.error);assert.equal(r.result.applied,false);assert.equal(r.result.review.length,1);
    r=await call('folio_operation',{operation:'ocr.apply',revision,options:{jobId,corrections:[{index:1,text:'PROOFREADBETA'}]}});
    assert(r.result?.applied,r.error||JSON.stringify(r));
    const ocrState=await page.evaluate(async()=>{
      const {S}=await import('./app.mjs');
      return {ocr:S.ocr,text:(await (await S.pdf.getPage(1)).getTextContent()).items.map(x=>x.str).join(' ')};
    });
    assert(ocrState.text.includes('PROOFREADALPHA')&&ocrState.text.includes('PROOFREADBETA'),ocrState.text);
    assert(ocrState.ocr.every(b=>b.reviewAccepted&&b.confidence===0.99));
    console.log('OCR incremental review accepted by real native writer');
    r = await call("pdf_help", {});
    assert(!r.error, r.error);
    console.log("upstream tools", r.result.total);
    assert(r.result.total >= 50);
    await page.screenshot({ path: "tests/output/ai-integration.png" });
    await page.evaluate(() => window.desktop.setDirty(false));
  } finally {
    try {
      const w = await app.firstWindow();
      await w.evaluate(() => window.desktop.setDirty(false));
    } catch {}
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
