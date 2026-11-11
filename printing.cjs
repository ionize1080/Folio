const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
async function printDocument({
  BrowserWindow,
  parent,
  owner,
  title,
  pages,
  settings = {},
  destination = "printer",
  saveDialog,
}) {
  if (!Array.isArray(pages) || !pages.length || pages.length > 10000)
    throw Error("打印页面无效");
  let size = 0;
  for (const p of pages) {
    if (
      ![p.width, p.height].every(
        (v) => Number.isFinite(v) && v > 0 && v <= 14400,
      ) ||
      typeof p.image !== "string" ||
      !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(p.image)
    )
      throw Error("打印页面格式无效");
    size += p.image.length;
  }
  if (size > 256 * 1024 ** 2)
    throw Error("打印内容较大，请减少页面范围或选择 150 DPI");
  if (!["printer", "pdf"].includes(destination)) throw Error("打印目标无效");
  const copies = settings.copies ?? 1,
    duplexMode = settings.duplexMode || "simplex",
    dpi = settings.dpi ?? 300;
  if (
    !Number.isInteger(copies) ||
    copies < 1 ||
    copies > 999 ||
    !["simplex", "longEdge", "shortEdge"].includes(duplexMode) ||
    ![150, 300, 600].includes(dpi)
  )
    throw Error("打印设置无效");
  const deviceName = String(settings.deviceName || "");
  if (
    destination === "printer" &&
    deviceName &&
    !(await owner.getPrintersAsync()).some((p) => p.name === deviceName)
  )
    throw Error("打印机不可用，请重新选择");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "folio-print-"));
  let window;
  try {
    const rules = pages
      .map(
        (p, i) =>
          `@page p${i}{size:${p.width}pt ${p.height}pt;margin:0}.p${i}{page:p${i};width:${p.width}pt;height:${p.height}pt}`,
      )
      .join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${escape(title)}</title><style>html,body{margin:0;padding:0}section{break-after:page;overflow:hidden}section:last-child{break-after:auto}img{display:block;width:100%;height:100%}${rules}</style></head><body>${pages.map((p, i) => `<section class="p${i}"><img src="${p.image}" alt=""></section>`).join("")}</body></html>`;
    const file = path.join(directory, "document.html");
    await fs.writeFile(file, html);
    window = new BrowserWindow({
      show: false,
      parent,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (e) => e.preventDefault());
    await window.loadFile(file);
    await window.webContents.executeJavaScript(
      "Promise.all(Array.from(document.images,image=>image.decode()))",
    );
    if (owner.isDestroyed()) throw Error("原文档已关闭");
    if (destination === "pdf") {
      const result = await saveDialog({
        title: "保存打印 PDF",
        defaultPath:
          path.basename(String(title || "Document"), ".pdf") + "-print.pdf",
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (result.canceled || !result.filePath) return { cancelled: true };
      const bytes = await window.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      });
      await fs.writeFile(result.filePath, bytes);
      return { saved: true };
    }
    const first = pages[0],
      landscape = first.width > first.height;
    // Raster quality is chosen by the renderer. Do not force that DPI onto a
    // printer: drivers such as Microsoft Print to PDF ignore unsupported DPI
    // while Chromium still scales for it, producing a physically shrunken page.
    const nativeOptions = {
      silent: !!deviceName,
      ...(deviceName ? { deviceName } : {}),
      printBackground: true,
      margins: { marginType: "none" },
      pagesPerSheet: 1,
      scaleFactor: 100,
      pageSize: {
        width: Math.round((Math.min(first.width, first.height) / 72) * 25400),
        height: Math.round((Math.max(first.width, first.height) / 72) * 25400),
      },
      landscape,
      color: settings.color !== false,
      duplexMode,
      copies,
      collate: settings.collate !== false,
    };
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          reject(Error("打印对话框超时，请重试"));
          if (!window.isDestroyed()) window.destroy();
        },
        10 * 60 * 1000,
      );
      window.webContents.print(nativeOptions, (success, reason) => {
        clearTimeout(timeout);
        if (success) resolve({ printed: true });
        else if (/cancel/i.test(reason || "")) resolve({ cancelled: true });
        else reject(Error(reason || "打印未完成"));
      });
    });
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    await fs.rm(directory, { recursive: true, force: true });
  }
}
module.exports = { printDocument };
