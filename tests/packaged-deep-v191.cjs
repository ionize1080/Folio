// Real keyboard edits in the shipping Electron UI. DOM-only timing observers;
// no renderer model hooks, direct value assignments or native edit shortcuts.
const { _electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const packaged = !!process.env.FOLIO_EXE;
const exe = packaged
  ? path.resolve(process.env.FOLIO_EXE)
  : require("electron");
const native = packaged
  ? path.join(path.dirname(exe), "resources/native")
  : path.join(root, "native");
const python = path.join(native, "runtime/python.exe");
const out = path.join(
  root,
  "tests/output/packaged-deep-v191" + (packaged ? "" : "-dev"),
);
fs.mkdirSync(out, { recursive: true });
const hash = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const specs = [
  {
    id: "textbook-12",
    prefix: "义务教育教科书·语文五年级下册",
    page: 12,
    starts: ["◇", "呼兰河", "以上我"],
  },
  {
    id: "textbook-20",
    prefix: "义务教育教科书·语文五年级下册",
    page: 20,
    starts: ["交流平台", "读到《月", "我通过"],
  },
  {
    id: "strategy-3",
    prefix: "十五五规划投资全景_跨市场五年配置策略",
    page: 3,
  },
  {
    id: "strategy-8",
    prefix: "十五五规划投资全景_跨市场五年配置策略",
    page: 8,
  },
].filter(
  (s) =>
    !process.env.FOLIO_CASES ||
    process.env.FOLIO_CASES.split(",").includes(s.id),
);
const manifest = JSON.parse(
  execFileSync(
    python,
    [
      "-c",
      String.raw`
import sys,json,hashlib,fitz,shutil
from pathlib import Path
base,out,specs=Path(sys.argv[1]),Path(sys.argv[2]),json.loads(sys.argv[3])
for s in specs:
 source=next(base.glob(s['prefix']+'*.pdf'));s['source']=str(source);s['sourceSha256']=hashlib.sha256(source.read_bytes()).hexdigest()
 with fitz.open(source) as d:
  s['pageCount']=len(d)
 target=out/(s['id']+'-input.pdf');shutil.copyfile(source,target);s['fixture']=str(target)
print(json.dumps(specs,ensure_ascii=False))
`,
      process.env.FOLIO_CORPUS || "D:/APP/PDF Samples",
      out,
      JSON.stringify(specs),
    ],
    { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } },
  ),
);
const report = {
  runtime: packaged ? "packaged" : "development",
  exe,
  exeSha256: hash(exe),
  startedAt: new Date().toISOString(),
  methodology:
    "Each target opens a complete copy of the original document, retaining its structure tree, and starts from a fresh renderer with cold browser font caches. The first target on each page also measures warm re-entry without reloading. Input timings begin at the real input event; undo/redo begin at keyboard dispatch. Fast preview and background precise readiness are measured separately. Both saves verify exact page text, adjacent page pixels and independent MuPDF/PDFium Han glyph geometry.",
  timingEnvironment:
    "Ordinary Windows desktop with other regression suites running concurrently; timings describe observed interaction latency and are not an isolated competitor speed benchmark.",
  pages: [],
  errors: [],
};
if (packaged)
  report.asarSha256 = hash(path.join(path.dirname(exe), "resources/app.asar"));
report.nativeSha256 = Object.fromEntries(
  [
    "worker.py",
    "font_match.py",
    "font_metrics.py",
    "font_cache.py",
    "fast_layout.py",
    "font_resolver.py",
    "system_fonts.py",
    "font_similarity.py",
    "story.py",
    "structure_scope.py",
  ].map((file) => [file, hash(path.join(native, file))]),
);
let app, page;
const saveReport = () =>
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2),
  );
const compact = (s) => s.replace(/\s/g, "");

async function open(file, pageNumber = 1) {
  if (await page.locator("#modal[open]").count())
    await page.locator("#modal-close").click();
  if (await page.locator("#pe-cancel").isVisible())
    await page.locator("#pe-cancel").click();
  await page.evaluate(() => window.desktop.setDirty(false));
  await page.reload();
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, file);
  const at = Date.now();
  await page.locator('[data-action="open"]').first().click();
  await page.waitForSelector("body.has-document");
  if (pageNumber !== 1) {
    await page.locator("#page-number").fill(String(pageNumber));
    await page.locator("#page-number").press("Enter");
    await page.waitForFunction(
      (p) =>
        document.querySelector("#page-number").value === String(p) &&
        document.querySelector(`.pdf-page[data-page="${p}"][data-ready=true]`),
      pageNumber,
    );
  }
  return Date.now() - at;
}
async function arm(label) {
  await page.evaluate((label) => {
    window.__deepTiming?.observer?.disconnect();
    const state = {
      label,
      armed: performance.now(),
      inputAt: null,
      fastAt: null,
      preciseAt: null,
      precisePending: false,
      status: [],
      refine: [],
    };
    const capture = (e) => {
      if (e.target.matches(".page-edit-input") && state.inputAt === null)
        state.inputAt = performance.now();
    };
    document.addEventListener("input", capture, { capture: true, once: true });
    const observer = new MutationObserver(() => {
      const status = document.querySelector("#pe-status"),
        refine = document.querySelector("#pe-refine");
      const now = performance.now(),
        text = status?.textContent || "",
        precise = refine?.textContent || "";
      if (state.status.at(-1)?.text !== text) {
        state.status.push({
          at: now,
          text,
          error: !!status?.classList.contains("error"),
        });
        if (/完成/.test(text) && state.fastAt === null) state.fastAt = now;
      }
      if (state.refine.at(-1)?.text !== precise) {
        state.refine.push({
          at: now,
          text: precise,
          title: refine?.title || "",
        });
        if (/等待后台精排|后台精排中/.test(precise))
          state.precisePending = true;
        if (
          state.precisePending &&
          ((/预览精排/.test(precise) && !refine.disabled) ||
            /精排未通过|精排暂不可用|保留当前方向/.test(precise)) &&
          state.preciseAt === null
        )
          state.preciseAt = now;
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "disabled"],
    });
    window.__deepTiming = { state, observer };
  }, label);
}
async function stable(expect, refine = true) {
  await page.waitForFunction(
    (expect) => {
      const input = document.querySelector(".page-edit-input"),
        status = document.querySelector("#pe-status");
      return (
        input?.value === expect &&
        (/完成/.test(status?.textContent || "") ||
          status?.classList.contains("error"))
      );
    },
    expect,
    { timeout: 60000 },
  );
  if (refine)
    await page.waitForFunction(
      () => {
        const button = document.querySelector("#pe-refine"),
          text = button?.textContent || "";
        return (
          (/预览精排/.test(text) && !button.disabled) ||
          /精排未通过|精排暂不可用|保留当前方向|快速字体不可用/.test(text) ||
          document.querySelector("#pe-status")?.classList.contains("error")
        );
      },
      null,
      { timeout: 60000 },
    );
  return page.evaluate(() => {
    const s = window.__deepTiming.state,
      t = s.inputAt ?? s.armed;
    return {
      label: s.label,
      inputToFastMs: s.fastAt === null ? null : +(s.fastAt - t).toFixed(2),
      inputToPreciseMs:
        s.preciseAt === null ? null : +(s.preciseAt - t).toFixed(2),
      statusText: document.querySelector("#pe-status")?.textContent,
      refineText: document.querySelector("#pe-refine")?.textContent,
      statusError: !!document
        .querySelector("#pe-status")
        ?.classList.contains("error"),
      warning: document.querySelector("#pe-warning")?.textContent,
      fontSource: document.querySelector("#pe-font-source")?.textContent,
      fallback: document.querySelector("#pe-fallback")?.hidden
        ? ""
        : document.querySelector("#pe-fallback")?.textContent,
    };
  });
}
async function keyboardEdit(label, start, end, text, expected) {
  const input = page.locator(".page-edit-input");
  await input.focus();
  await input.evaluate((e, { start, end }) => e.setSelectionRange(start, end), {
    start,
    end,
  });
  await arm(label);
  if (text) await page.keyboard.insertText(text);
  else await page.keyboard.press("Backspace");
  assert.equal(
    await input.inputValue(),
    expected,
    `${label}: keyboard text mismatch`,
  );
  return stable(expected);
}
async function finishAndSave(file) {
  const at = Date.now();
  await page.locator("#pe-done").click();
  await page.waitForFunction(
    () => {
      if (!document.body.classList.contains("page-edit-mode")) return true;
      if (document.querySelector("#status")?.textContent === "操作未完成")
        throw Error(
          document.querySelector("#toast")?.textContent || "Finish failed",
        );
      const s = document.querySelector("#pe-status");
      if (s?.classList.contains("error")) throw Error(s.textContent);
      return false;
    },
    null,
    { timeout: 60000 },
  );
  fs.rmSync(file, { force: true });
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, file);
  await page.locator('[data-action="save"]').click();
  await page.waitForFunction(
    (name) => {
      if (document.querySelector("#status")?.textContent === "操作未完成")
        throw Error(
          document.querySelector("#toast")?.textContent || "Save failed",
        );
      return (
        document.querySelector("#busy").hidden &&
        document.querySelector("#doc-name").textContent === name &&
        !document.querySelector("#dirty-dot").classList.contains("changed")
      );
    },
    path.basename(file),
    { timeout: 60000 },
  );
  assert(fs.statSync(file).size > 100);
  return Date.now() - at;
}
async function fallbackDetails() {
  const button = page.locator("#pe-fallback");
  if (!(await button.isVisible())) return [];
  await button.click();
  const panel = page.locator("#pe-fallback-panel");
  const details = await panel
    .locator("button")
    .evaluateAll((es) => es.slice(1).map((e) => e.textContent));
  await panel.locator("button").first().click();
  return details;
}
function verify(spec, file, old, edited) {
  const result = JSON.parse(
    execFileSync(
      python,
      [
        "-c",
        String.raw`
import sys,fitz,json
from pathlib import Path
sys.path.insert(0,str(Path(sys.argv[6])))
from ui_glyph_verification_v191 import assert_cjk_glyph_geometry
from ui_style_verification_v191 import assert_retained_styles
from collections import Counter
def compact(s):return ''.join(s.split())
with fitz.open(sys.argv[1]) as a,fitz.open(sys.argv[2]) as b:
 assert len(a)==len(b)
 p=int(sys.argv[5])-1;adjacent=p+1 if p+1<len(a) else p-1
 expected=Counter(compact(a[p].get_text()));expected.subtract(Counter(compact(sys.argv[3])));expected.update(Counter(compact(sys.argv[4])))
 assert Counter(compact(b[p].get_text()))==+expected,'changed unrelated page text or duplicated input'
 assert a[adjacent].get_pixmap().samples==b[adjacent].get_pixmap().samples,'changed adjacent page'
 b[p].get_pixmap(matrix=fitz.Matrix(1.25,1.25)).save(sys.argv[2]+'.png')
 geometry=assert_cjk_glyph_geometry(Path(sys.argv[2]).read_bytes(),p+1)
 styles=assert_retained_styles(sys.argv[1],sys.argv[2],p+1,sys.argv[3],sys.argv[4])
 print(json.dumps({'exactPageCharacters':True,'adjacentPagePixelsUnchanged':True,'glyphGeometry':geometry,'styleAudit':styles}))
`,
        spec.fixture,
        file,
        old,
        edited,
        String(spec.page),
        path.join(root, "tests"),
      ],
      { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } },
    ),
  );
  assert.equal(
    hash(spec.source),
    spec.sourceSha256,
    "original source was modified",
  );
  return result;
}
async function activate(title, toggle = true) {
  if (toggle) await page.locator('[data-action="flow-edit"]').click();
  const hit = page.locator(".page-edit-hit:not(.unavailable)");
  await page.waitForFunction(() =>
    document.querySelector(".page-edit-hit:not(.unavailable)") ||
    document.querySelector("#status")?.textContent === "操作未完成",
  );
  if ((await page.locator("#status").textContent()) === "操作未完成")
    throw Error("Entering page editing failed: " + (await page.locator("body").innerText()).slice(-500));
  await hit.first().waitFor();
  const titles = await hit.evaluateAll((es) => es.map((e) => e.title));
  const index = titles.findIndex((t) => compact(t) === compact(title));
  assert(index >= 0, `editable paragraph missing: ${title}`);
  await arm("activate");
  await hit.nth(index).click();
  await page.locator(".page-edit-input").waitFor();
  const text = await page.locator(".page-edit-input").inputValue();
  const timing = await stable(text);
  return { text, timing };
}
(async () => {
  app = await _electron.launch({
    executablePath: exe,
    args: [
      ...(packaged ? [] : [root]),
      "--user-data-dir=" +
        fs.mkdtempSync(path.join(os.tmpdir(), "folio-deep-v191-")),
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
    ],
    env: { ...process.env, FOLIO_TEST_BACKGROUND: "1" },
    timeout: 60000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(45000);
  await page.addLocatorHandler(
    page.locator("#modal[open] #recovery-session"),
    async () => {
      await page.locator("#modal-close").click();
    },
  );
  await app.evaluate(({ BrowserWindow, ipcMain }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.setBackgroundThrottling(false);
      w.hide();
    }
    // Observe failed native requests without changing their payload or result.
    // This preserves the exact font keys if a sporadic export failure recurs.
    const original = ipcMain._invokeHandlers.get("flow-layout");
    if (!original) throw Error("Missing flow-layout handler");
    globalThis.__folioTestLayoutFailures = [];
    ipcMain.removeHandler("flow-layout");
    ipcMain.handle("flow-layout", async (event, ...args) => {
      try {
        return await original(event, ...args);
      } catch (error) {
        globalThis.__folioTestLayoutFailures.push({
          time: new Date().toISOString(),
          args,
          error: error.stack || error.message,
        });
        throw error;
      }
    });
  });
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.waitForSelector('[data-action="open"]');
  await page.evaluate(() => {
    localStorage.setItem(
      "folio-settings",
      JSON.stringify({ saveSummary: false }),
    );
    localStorage.setItem("folio-language", "zh-Hans");
  });
  for (const spec of manifest) {
    const row = { ...spec, targets: [] };
    report.pages.push(row);
    try {
      row.openMs = await open(spec.fixture, spec.page);
      await page.locator('[data-action="flow-edit"]').click();
      const hit = page.locator(".page-edit-hit:not(.unavailable)");
      await hit.first().waitFor();
      row.available = await hit.evaluateAll((es) => es.map((e) => e.title));
      let titles;
      if (spec.starts)
        titles = spec.starts.map((start) => {
          const t = row.available.find((t) => t.startsWith(start));
          assert(t, `missing target ${start}`);
          return t;
        });
      else {
        const body = row.available.filter(
          (t) => t.length >= 35 && t.length < 800,
        );
        assert(body.length >= 3, "fewer than three prose targets");
        titles = [body[0], body[Math.floor(body.length / 2)], body.at(-1)];
      }
      for (let position = 0; position < titles.length; position++) {
        const target = {
          position,
          originalTitle: titles[position],
          operations: [],
        };
        row.targets.push(target);
        console.log("START", spec.id, position);
        try {
          await open(spec.fixture, spec.page);
          let { text: original, timing } = await activate(titles[position]);
          target.activate = timing;
          console.log("ACTIVE", spec.id, position);
          if (position === 0) {
            await page.locator("#pe-cancel").click();
            const warm = await activate(titles[position], false);
            assert.equal(warm.text, original);
            target.warmActivation = warm.timing;
          }
          let current = original;
          const at = Math.max(0, Math.floor(current.length * 0.25)),
            short = "补充";
          let expected = current.slice(0, at) + short + current.slice(at);
          target.operations.push(
            await keyboardEdit("insert-short", at, at, short, expected),
          );
          current = expected;
          await arm("undo");
          await page.keyboard.press("Control+z");
          target.operations.push(await stable(original));
          assert.equal(
            await page.locator(".page-edit-input").inputValue(),
            original,
          );
          await arm("redo");
          await page.keyboard.press("Control+y");
          target.operations.push(await stable(current));
          assert.equal(
            await page.locator(".page-edit-input").inputValue(),
            current,
          );
          const longAt = Math.floor(current.length * 0.6),
            long = "这段补充文字用于检查原文的字体、字号和段落位置。";
          expected = current.slice(0, longAt) + long + current.slice(longAt);
          target.operations.push(
            await keyboardEdit("insert-long", longAt, longAt, long, expected),
          );
          target.operations.push(
            await keyboardEdit(
              "delete-long",
              longAt,
              longAt + long.length,
              "",
              current,
            ),
          );
          const matches = [...current.matchAll(/[\u3400-\u9fff]{2}/g)].filter(
            (m) => m.index !== at,
          );
          const cut = matches.at(-1)?.index ?? 0;
          expected = current.slice(0, cut) + current.slice(cut + 2);
          target.operations.push(
            await keyboardEdit("delete-short", cut, cut + 2, "", expected),
          );
          current = expected;
          assert(
            !target.operations.at(-1).statusError,
            "final edit unavailable: " + target.operations.at(-1).statusText,
          );
          target.finalText = current;
          target.fallbackDetails = await fallbackDetails();
          const saved = path.join(out, `${spec.id}-${position}-saved.pdf`);
          target.saveMs = await finishAndSave(saved);
          target.verification = verify(spec, saved, original, current);
          console.log("SAVED", spec.id, position);
          saveReport();
          target.reopenMs = await open(saved, spec.page);
          const again = await activate(current);
          target.reopenActivation = again.timing;
          assert.equal(
            compact(again.text),
            compact(current),
            "reopened paragraph content changed",
          );
          const actual = again.text;
          const first = [...actual.matchAll(/[\u3400-\u9fff]/g)][0]?.index ?? 0;
          const second = actual.slice(0, first) + actual.slice(first + 1);
          target.operations.push(
            await keyboardEdit("reopened-delete", first, first + 1, "", second),
          );
          const resaved = path.join(out, `${spec.id}-${position}-resaved.pdf`);
          target.secondSaveMs = await finishAndSave(resaved);
          target.secondVerification = verify(spec, resaved, original, second);
          console.log("RESAVED", spec.id, position);
          target.status = "passed";
        } catch (error) {
          target.status = "failed";
          target.error = error.stack || error.message;
          target.ui = await page
            .locator("body")
            .innerText()
            .catch(() => "");
          console.error("FAILED", spec.id, position, error.message);
        }
        saveReport();
      }
      row.status = row.targets.every((t) => t.status === "passed")
        ? "passed"
        : "failed";
    } catch (error) {
      row.status = "failed";
      row.error = error.stack || error.message;
      console.error("FAILED PAGE", spec.id, error.message);
    }
    saveReport();
  }
  assert.equal(report.errors.length, 0, report.errors.join("\n"));
  assert(
    report.pages.every((p) => p.status === "passed"),
    "One or more UI corpus cases failed",
  );
  console.log(
    "PASS",
    report.pages.reduce((n, p) => n + p.targets.length, 0),
    "multi-operation UI cases",
  );
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    report.finishedAt = new Date().toISOString();
    if (app) {
      const failures = await app
        .evaluate(() => globalThis.__folioTestLayoutFailures || [])
        .catch(() => []);
      report.flowLayoutFailureCount = failures.length;
      fs.writeFileSync(
        path.join(out, "flow-layout-failures.json"),
        JSON.stringify(failures, null, 2),
      );
    }
    saveReport();
    await page?.evaluate(() => window.desktop?.setDirty(false)).catch(() => {});
    await app?.close();
  });
