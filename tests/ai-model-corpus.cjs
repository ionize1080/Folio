// Paid integration test: actual Chatbox provider, real API and Folio stdio MCP.
const { _electron: electron, chromium } = require("playwright");
const fs = require("fs"),
  path = require("path"),
  assert = require("assert/strict");
const root = process.env.FOLIO_PDF_SAMPLES || "D:/APP/PDF Samples",
  out = path.resolve("tests/output/ai-corpus");
const cases = [
  {
    match: "五年级",
    title: "AI验收 古诗三首",
    pages: [1, 4],
    target: 7,
    task: "判断PDF第1和4页哪个是目录页，用目录识别分辨率读取第一单元的条目。核对印刷页码与PDF实际页码，第7页用上半页局部图像精确定位第一课标题。新增父书签“AI验收 第一单元”并在其下创建“AI验收 古诗三首”，目标应指向该标题的XYZ坐标。不要改原有书签。",
  },
  {
    match: "银行营业",
    title: "AI验收 范围",
    pages: [1, 2],
    target: 5,
    task: "用图像判断PDF第1和2页哪个是目录页，再读目录前三个编号章节。核对印刷页码和PDF实际页码，渲染PDF第5页局部区域精确定位“1 范围”标题。新增“AI验收 范围”书签，XYZ目标定位到标题，并留白5mm。不要改原有书签。",
  },
  {
    match: "High-tech",
    title: "AI验收 The great tech rejuvenation",
    pages: [1, 2],
    target: 5,
    task: "Use images to classify PDF pages 1 and 2, then read the first section and its subtopics from the TOC. Visually inspect the top half of PDF page 5 to locate the section title. Add bookmark “AI验收 The great tech rejuvenation” targeting that precise title with XYZ. Preserve all existing bookmarks.",
  },
  {
    match: "Newsweek",
    title: "AI验收 扫描页",
    pages: [3],
    target: 3,
    task: "对PDF第3页调用本地Paddle OCR，阈值0.95，再按需获取整页图像核对版面与文字。如果有低置信度块，至少裁剪复核一处，不要把识别置信度改成你估算的数值。报告实际看到的两个短语，并新增“AI验收 扫描页”书签到第3页。保留原文，不应用OCR修改。",
  },
  {
    match: "恒隆",
    title: "AI验收 财报",
    pages: [3],
    target: 3,
    task: "获取PDF第3页整页图像，识别其复杂财报版面中的标题和至少两个财务数字，再用局部高清图核对一个数字。不使用page.text或OCR，必须看图。新增“AI验收 财报”书签到第3页。不要修改页面。",
  },
];
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const app = await electron.launch({
    args: [path.resolve(".")],
    env: {
      ...process.env,
      FOLIO_TEST_BACKGROUND: "1",
      FOLIO_TEST_PROFILE: path.join(out, "model-folio-" + Date.now()),
      FOLIO_TEST_CHATBOX_PORT: "19484",
      FOLIO_CHATBOX_PROFILE: path.join(out, "model-chatbox"),
    },
    timeout: 60000,
  });
  let browser;
  const results = [];
  try {
    const folio = await app.firstWindow();
    await folio.waitForLoadState("domcontentloaded");
    folio.on("dialog", (d) => d.accept());
    await folio.locator('[data-action="settings"]').click();
    await folio.locator("#set-ai-approval").selectOption("auto");
    await folio.locator("#modal-footer .primary").click();
    await folio.evaluate(() => window.desktop.aiOpen());
    for (let n = 0; n < 40; n++) {
      try {
        browser = await chromium.connectOverCDP("http://127.0.0.1:19484");
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    assert(browser);
    let page;
    for (let n = 0; n < 50; n++) {
      page = browser
        .contexts()[0]
        .pages()
        .find((p) => p.url().includes("/renderer/index.html"));
      if (page) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert(page);
    page.on("pageerror", (error) =>
      console.log("CHATBOX PAGE ERROR", error.message),
    );
    await page.waitForFunction(() => !!window.electronAPI?.invoke);
    await page.waitForTimeout(2000);
    const key = fs
      .readFileSync("D:/APP/API/qwen-plan.txt", "utf8")
      .replace(/^\uFEFF/, "")
      .trim();
    await page.evaluate(async (key) => {
      const s = await window.electronAPI.invoke("getSettings");
      s.language = "en";
      s.messageLayout = "left";
      s.providers["folio-qwen"].apiKey = key;
      await window.electronAPI.invoke(
        "setStoreValue",
        "settings",
        JSON.stringify(s),
      );
    }, key);
    await page.reload();
    await page.waitForFunction(() => !!window.electronAPI?.invoke);
    await page.waitForTimeout(3000);
    for (const [i, c] of cases.entries()) {
      if (
        process.env.FOLIO_MODEL_START &&
        i < Number(process.env.FOLIO_MODEL_START)
      )
        continue;
      const name = fs.readdirSync(root).find((n) => n.includes(c.match));
      const start = Date.now();
      await folio.evaluate(() => window.desktop.setDirty(false));
      await app.evaluate(
        ({ dialog }, file) => {
          dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [file],
          });
        },
        path.join(root, name),
      );
      await folio.waitForSelector("#busy[hidden]", {
        state: "attached",
        timeout: 90000,
      });
      await folio.locator('[data-action="open"]').first().click();
      await folio.waitForTimeout(300);
      const discard = folio.getByRole("button", {
        name: /^(Discard and continue|放弃并继续)$/,
      });
      if (await discard.count()) await discard.click();
      await folio.waitForFunction(
        (name) =>
          document.querySelector("#doc-name")?.textContent.includes(name),
        name,
        { timeout: 90000 },
      );
      await folio.waitForTimeout(2500);
      await page.keyboard.press("Control+n");
      await page.waitForTimeout(1000);
      const prompt =
        "这是实际文档验收。使用Folio MCP，先folio_help和document.describe获取最新revision，busy时等待。按需查工具参数；先低分辨率分类，再toc/locate分辨率核对。图片是实际视觉附件，不要根据书签猜测图像。不要调用开源pdf_operation，也不要提问。每一次folio_operation调用都必须包含operation字段（与options同级），例如operation=page.image，绝不能漏掉。每次修改后使用新revision。" +
        c.task +
        " 最后调用bookmark.read核对新节点，回答中说明看到的具体证据，最终单独一行输出 FOLIO_CASE_DONE。";
      await page.locator("textarea[placeholder]").first().fill(prompt);
      await page.locator("textarea[placeholder]").first().press("Enter");
      let body = "";
      for (let n = 0; n < 360; n++) {
        body = await page.locator("body").innerText();
        if (n % 30 === 0)
          console.log(
            "MODEL",
            c.match,
            n + "s",
            body.slice(-200).replaceAll("\n", " "),
          );
        if (
          (body.match(/FOLIO_CASE_DONE/g) || []).length >= 2 &&
          !(await page.locator(".tabler-icon-player-stop-filled").count())
        )
          break;
        await page.waitForTimeout(1000);
      }
      assert.equal(
        await page.locator(".tabler-icon-player-stop-filled").count(),
        0,
        "model did not finish",
      );
      fs.writeFileSync(path.join(out, "model-" + i + ".txt"), body);
      await page.screenshot({ path: path.join(out, "model-" + i + ".png") });
      const target = path.join(
        out,
        "model-" + i + "-result-" + Date.now() + ".pdf",
      );
      await app.evaluate(({ dialog }, file) => {
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: file,
        });
      }, target);
      await folio.locator(".more-tools").evaluate((e) => (e.open = true));
      await folio.locator('[data-action="save-as"]').first().click();
      const summary = folio.getByRole("button", {
        name: "继续保存",
        exact: true,
      });
      if (await summary.count()) await summary.click();
      for (let n = 0; n < 300 && !fs.existsSync(target); n++)
        await folio.waitForTimeout(200);
      assert(fs.existsSync(target), "saved result");
      await folio.waitForSelector("#busy[hidden]", {
        state: "attached",
        timeout: 90000,
      });
      await folio.waitForTimeout(1000);
      results.push({
        name,
        title: c.title,
        expectedPage: c.target,
        file: target,
        seconds: (Date.now() - start) / 1000,
        done: (body.match(/FOLIO_CASE_DONE/g) || []).length >= 2,
      });
      fs.writeFileSync(
        path.join(out, "model-result-" + i + ".json"),
        JSON.stringify(results.at(-1), null, 2),
      );
      fs.writeFileSync(
        path.join(out, "model-results.json"),
        JSON.stringify(results, null, 2),
      );
      console.log("PASS model workflow", name, results.at(-1).seconds + "s");
    }
  } catch (e) {
    console.log(
      "FOLIO BODY",
      (await (await app.firstWindow()).locator("body").innerText()).slice(
        -1500,
      ),
    );
    if (browser) {
      for (const p of browser.contexts()[0].pages()) {
        const detail = p.getByText("Show Error", { exact: true });
        if (await detail.count()) await detail.click();
        console.log("API", await p.evaluate(() => typeof window.electronAPI));
        console.log(
          "CHATBOX BODY",
          (await p.locator("body").innerText()).slice(-4000),
        );
      }
    }
    throw e;
  } finally {
    try {
      await (
        await app.firstWindow()
      ).evaluate(() => window.desktop.setDirty(false));
    } catch {}
    await browser?.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
