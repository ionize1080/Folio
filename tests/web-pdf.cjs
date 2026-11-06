const { _electron } = require("playwright"),
  http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
(async () => {
  let app;
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(
      "<html><head><title>Reader benchmark</title></head><body><nav>UNWANTED NAVIGATION</nav><article><h1>Reader benchmark</h1>" +
        Array.from(
          { length: 18 },
          (_, i) =>
            "<p>Paragraph " +
            i +
            ". This source article discusses accessible document design, clear typography and readable tables. Content must remain intact when exported to a paginated document. Reading mode preserves facts and removes navigation clutter.</p>",
        ).join("") +
        "</article><footer>UNWANTED FOOTER</footer></body></html>",
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    app = await _electron.launch({
      args: [path.resolve(".")],
      env: {
        ...process.env,
        FOLIO_TEST_BACKGROUND: "1",
        FOLIO_TEST_PROFILE: path.resolve(
          "tests/output/web-profile-" + Date.now(),
        ),
      },
      timeout: 60000,
    });
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!window.desktop?.webPDF);
    const reports = [];
    for (const mode of ["reader", "original"]) {
      const r = await page.evaluate(
        async (options) => {
          const r = await window.desktop.webPDF(options);
          return { ...r, bytes: Array.from(r.bytes) };
        },
        { url: "http://127.0.0.1:" + server.address().port, mode },
      );
      assert(Buffer.from(r.bytes).subarray(0, 5).equals(Buffer.from("%PDF-")));
      fs.writeFileSync(
        "tests/output/web-" + mode + ".pdf",
        Buffer.from(r.bytes),
      );
      reports.push({ mode, title: r.title, bytes: r.bytes.length });
    }
    await assert.rejects(
      page.evaluate(() =>
        window.desktop.webPDF({ url: "file:///C:/Windows/win.ini" }),
      ),
    );
    if (process.env.FOLIO_WEB_LIVE) {
      const r = await page.evaluate(async () => {
        const r = await window.desktop.webPDF({
          url: "https://www.w3.org/WAI/fundamentals/accessibility-intro/",
          mode: "reader",
        });
        return { ...r, bytes: Array.from(r.bytes) };
      });
      fs.writeFileSync(
        "tests/output/web-live-reader.pdf",
        Buffer.from(r.bytes),
      );
      reports.push({
        mode: "live-reader",
        title: r.title,
        bytes: r.bytes.length,
      });
    }
    fs.writeFileSync(
      "tests/output/web-pdf-report.json",
      JSON.stringify(reports, null, 2),
    );
    console.log(reports);
  } finally {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
