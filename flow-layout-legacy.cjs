// Deterministic offline typography using the Chromium runtime already shipped with Folio.
// The exact PDF returned here is both previewed and embedded; no second layout on save.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const escapeHTML = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const { validateModel } = require("./flow-validation.cjs");
function makeHTML(input, fontData = "", fallbackData = "") {
  const m = validateModel(input),
    f = m.frame;
  const text = m.text.replace(/\r\n?/g, "\n");
  const content = text
    .split("\n")
    .map((line) => `<p>${escapeHTML(line) || "<br>"}</p>`)
    .join("");
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:;"><style id="flow-fonts">
@font-face{font-family:FolioFlow;src:url(data:font/ttf;base64,${fontData})}@font-face{font-family:FolioFallback;src:url(data:font/ttf;base64,${fallbackData})}</style><style id="flow-style"> @page{size:${Math.ceil(m.pageWidth) + 1}pt ${Math.ceil(m.pageHeight) + 1}pt;margin:0}
*{box-sizing:border-box}html,body{margin:0;padding:0;width:${m.pageWidth}pt;height:${m.pageHeight}pt;background:transparent}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
#flow{position:absolute;left:${f.x}pt;top:${f.y}pt;width:${f.width}pt;height:${f.height}pt;columns:${m.columns};column-gap:${m.gap ?? 18}pt;column-fill:auto;font:${m.italic ? "italic " : ""}${m.bold ? "700" : "400"} ${m.size}pt/${m.lineHeight} FolioFlow,FolioFallback;color:${m.color};text-align:${m.align};line-break:strict;word-break:normal;overflow-wrap:anywhere;orphans:1;widows:1}
p{margin:0 0 ${m.paragraphGap ?? 0}pt 0;white-space:pre-wrap;tab-size:4;min-height:1em}
</style><body><div id="flow">${content}</div></body></html>`;
}
class FlowLayout {
  constructor(root) {
    this.root = root;
    this.chain = Promise.resolve();
    this.window = null;
    this.fonts = new Map();
  }
  async render(input) {
    const m = validateModel(input);
    const job = async () => {
      const { BrowserWindow } = require("electron");
      const started = performance.now();
      if (!this.window || this.window.isDestroyed()) {
        this.loaded = false;
        this.window = new BrowserWindow({
          show: false,
          width: 1100,
          height: 900,
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false,
            partition: "folio-flow-layout",
          },
        });
        this.window.webContents.setWindowOpenHandler(() => ({
          action: "deny",
        }));
        this.window.webContents.session.setPermissionRequestHandler(
          (_w, _p, cb) => cb(false),
        );
        this.window.webContents.session.webRequest.onBeforeRequest((d, cb) =>
          cb({ cancel: !d.url.startsWith("data:") && d.url !== this.htmlURL }),
        );
      }
      // Embedded subset font used by existing editor; font availability checked before layout.
      const key = "NotoSansSC.ttf";
      if (!this.fonts.has(key))
        this.fonts.set(
          key,
          (await fs.readFile(path.join(this.root, "fonts", key))).toString(
            "base64",
          ),
        );
      if (!this.fonts.has("DejaVuSans.ttf"))
        this.fonts.set(
          "DejaVuSans.ttf",
          (
            await fs.readFile(path.join(this.root, "fonts", "DejaVuSans.ttf"))
          ).toString("base64"),
        );
      if (!this.codepoints) {
        const sets = await Promise.all(
          ["codepoints.json", "fallback-codepoints.json"].map((f) =>
            fs
              .readFile(path.join(this.root, "fonts", f), "utf8")
              .then(JSON.parse),
          ),
        );
        this.codepoints = new Set(sets.flat());
      }
      const missing = [
        ...new Set(
          [...m.text].filter(
            (c) =>
              !/[\n\r\t]/.test(c) && !this.codepoints.has(c.codePointAt(0)),
          ),
        ),
      ];
      if (missing.length)
        throw Error(
          "字体未覆盖字符：" +
            missing.slice(0, 20).join(" ") +
            "，请校对后再排版",
        );
      const wc = this.window.webContents;
      if (!this.loaded) {
        const html = makeHTML(
          m,
          this.fonts.get(key),
          this.fonts.get("DejaVuSans.ttf"),
        );
        if (!this.tempDir)
          this.tempDir = await fs.mkdtemp(
            path.join(os.tmpdir(), "folio-layout-"),
          );
        const file = path.join(this.tempDir, "layout.html");
        this.htmlURL = pathToFileURL(file).href;
        await fs.writeFile(file, html, "utf8");
        await wc.loadURL(this.htmlURL);
        this.loaded = true;
      } else {
        const html = makeHTML(m);
        await wc.executeJavaScript(
          `(()=>{const doc=new DOMParser().parseFromString(${JSON.stringify(html)},'text/html');document.querySelector('#flow-style').textContent=doc.querySelector('#flow-style').textContent;document.querySelector('#flow').replaceWith(doc.querySelector('#flow'));})()`,
        );
      }
      const stats = await wc.executeJavaScript(
        "(" + measureOverflow.toString() + ")()",
      );
      if (stats.overflow)
        return { overflow: true, elapsedMs: performance.now() - started };
      const bytes = await wc.printToPDF({
        printBackground: true,
        displayHeaderFooter: false,
        preferCSSPageSize: true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        pageRanges: "1",
        generateTaggedPDF: true,
      });
      return { bytes, overflow: false, elapsedMs: performance.now() - started };
    };
    const p = this.chain.then(job, job);
    this.chain = p.catch(() => {});
    return p;
  }
  close() {
    this.window?.destroy();
    this.window = null;
    this.loaded = false;
    this.fonts.clear();
    if (this.tempDir)
      require("node:fs").rmSync(this.tempDir, { recursive: true, force: true });
    this.tempDir = null;
  }
}
async function measureOverflow() {
  await document.fonts.ready;
  const box = document.querySelector("#flow"),
    r = box.getBoundingClientRect(),
    range = document.createRange();
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  let node,
    rectangles = 0;
  while ((node = walker.nextNode()))
    for (const match of node.data.matchAll(/\S+/gu)) {
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      for (const x of range.getClientRects()) {
        rectangles++;
        if (
          x.width &&
          x.height &&
          (x.right > r.right + 1 ||
            x.bottom > r.bottom + 1 ||
            x.left < r.left - 1)
        )
          return { overflow: true, rectangles };
      }
    }
  // Empty paragraphs still consume space and must not be silently omitted.
  for (const p of box.querySelectorAll("p"))
    if (!p.textContent.trim())
      for (const x of p.getClientRects())
        if (x.right > r.right + 1 || x.bottom > r.bottom + 1)
          return { overflow: true, rectangles };
  return { overflow: false, rectangles };
}
module.exports = {
  FlowLayout,
  makeHTML,
  validateModel,
  escapeHTML,
  measureOverflow,
};
