// Dumps the structure (tag.class#id) of each bookmark dialog so styles can target real markup.
const path = require("node:path"), fs = require("node:fs");
const items = [["smart-toc", "smart-toc"], ["generate", "generate"], ["calibrate", "calibrate"], ["bookmark-qc", "qc"], ["batch", "batch"], ["whitespace", "ws"], ["bookmark-every", "every"], ["exchange", "exchange"], ["split-bookmark", "split"]];
(async () => {
  const { app, page } = await require("./creative-harness.cjs")(); page.setDefaultTimeout(15000);
  fs.mkdirSync("tests/output/dump", { recursive: true });
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
    await app.evaluate(({ dialog }, f) => (dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] })), path.resolve(process.env.TOUR_PDF));
    await page.locator("[data-action=open]").first().click();
    await page.waitForFunction(() => /\/ \d/.test(document.querySelector("#page-total")?.textContent || ""));
    await page.locator("#busy").waitFor({ state: "hidden" }).catch(() => {});
    await page.locator("#ribbon-tab-bookmarks").click();
    for (const [cmd, name] of items) {
      try {
        await page.evaluate(() => { document.querySelector("#modal[open] #modal-close")?.click(); document.querySelectorAll("dialog[open]").forEach(d => d.close()); });
        const p = page.locator(`[data-ribbon-command="${cmd}"]`);
        if (await p.count()) await p.first().click({ timeout: 4000 }); else await page.evaluate(c => document.querySelector(`[data-action="${c}"]`)?.click(), cmd);
        await page.waitForTimeout(700);
        const tree = await page.evaluate(() => {
          const walk = (el, d) => {
            if (d > 7) return "";
            const id = el.id ? "#" + el.id : "", cls = el.classList.length ? "." + [...el.classList].join(".") : "";
            const txt = el.children.length === 0 ? " “" + (el.textContent || "").trim().slice(0, 28) + "”" : "";
            let s = "  ".repeat(d) + el.tagName.toLowerCase() + id + cls + (el.hidden ? " [hidden]" : "") + txt + "\n";
            for (const c of el.children) s += walk(c, d + 1);
            return s;
          };
          const m = document.querySelector("#modal"); return walk(m, 0);
        });
        fs.writeFileSync(`tests/output/dump/${name}.txt`, tree); console.log("ok", name, tree.length);
      } catch (e) { console.log("skip", name, String(e.message).split("\n")[0]); }
    }
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exit(1); });
