// Optional local-only corpus harness. Does not distribute third-party PDFs.
const { _electron } = require("playwright");
const fs = require("fs"),
  path = require("path");
const out = path.resolve(process.argv[2] || "../baseline");
fs.mkdirSync(out, { recursive: true });
const samples = process.env.FOLIO_SAMPLES;
if (!samples)
  throw Error("Set FOLIO_SAMPLES to your local PDF sample directory");
const files = fs
  .readdirSync(samples)
  .filter(
    (n) =>
      /教科书|年鉴|acrobat|PitStop/.test(n) &&
      n.endsWith(".pdf") &&
      !n.includes("-test"),
  );
(async () => {
  const app = await _electron.launch({
    executablePath: process.env.FOLIO_EXE,
    args: process.env.FOLIO_SOURCE
      ? [path.resolve("."), "--user-data-dir=" + out + "/profile"]
      : ["--user-data-dir=" + out + "/profile"],
    timeout: 60000,
  });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector("#language-select");
    await page.locator("#language-select").selectOption("zh-Hans");
    await page.evaluate(async () => {
      window.__S = (await import("./app.mjs")).S;
    });
    for (const name of files) {
      if (process.env.FOLIO_FILTER && !name.includes(process.env.FOLIO_FILTER))
        continue;
      const file = path.join(samples, name);
      const start = Date.now();
      await app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [file],
        });
      }, file);
      await page.locator("[data-action=open]").first().click();
      await page.waitForFunction(
        (name) =>
          !!window.__S.pdf &&
          window.__S.name === name &&
          document.querySelector("#busy").hidden,
        name,
        { timeout: 180000 },
      );
      const data = await page.evaluate(async (tocOnly) => {
        const { S, surface } = await import("./app.mjs");
        const { extractTocPage } = await import("./smart-toc-extract.mjs");
        const { extractLines } = await import("./text-lines.mjs");
        const { recognizeTocPages, resolveTocEntries, calibrationLines } =
          await import("./smart-toc.mjs");
        const toc = [],
          pages = {};
        for (
          let p = 1;
          p <= (tocOnly ? Math.min(50, S.pdf.numPages) : S.pdf.numPages);
          p++
        ) {
          if (p <= 50)
            toc.push(
              await extractTocPage(S.pdf, p, surface.rotation(p), S.ocr),
            );
          if (!tocOnly)
            pages[p] = calibrationLines(
              await extractLines(S.pdf, p, surface.rotation(p), { ocr: S.ocr }),
            );
        }
        const labels = (await S.pdf.getPageLabels()) || [];
        const found = recognizeTocPages(toc),
          selected = found.filter((p) => p.selected);
        const entries = selected.flatMap((p) => p.entries);
        const result = tocOnly
          ? entries
          : resolveTocEntries(
              entries,
              pages,
              S.pdf.numPages,
              labels,
              selected.map((p) => p.page),
            );
        return {
          pageCount: S.pdf.numPages,
          toc,
          pages,
          labels,
          found,
          result,
          existing: S.nodes,
        };
      }, !!process.env.FOLIO_TOC_ONLY);
      fs.writeFileSync(
        path.join(out, name + ".json"),
        JSON.stringify({ name, seconds: (Date.now() - start) / 1000, ...data }),
      );
      console.log(
        JSON.stringify({
          name,
          seconds: (Date.now() - start) / 1000,
          pages: data.found.filter((p) => p.selected).map((p) => p.page),
          entries: data.result.length,
          high: data.result.filter((e) => e.selected).length,
        }),
      );
    }
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
