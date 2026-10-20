// Electron/preload lifecycle regression, not a keyboard-edit benchmark.
const { _electron } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const packaged = !!process.env.FOLIO_EXE;
const exe = packaged
  ? path.resolve(process.env.FOLIO_EXE)
  : require("electron");
const nativeDirectory = packaged
  ? path.join(path.dirname(exe), "resources/native")
  : path.join(root, "native");
const hash = (p) =>
  crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const nativeHash = crypto.createHash("sha256");
for (const name of fs
  .readdirSync(nativeDirectory)
  .filter((n) => n.endsWith(".py"))
  .sort())
  nativeHash.update(
    name + "\n" + hash(path.join(nativeDirectory, name)) + "\n",
  );
const report = {
  runtime: packaged ? "packaged" : "development",
  methodology:
    "Synthetic one-page PDF registered through the real preload API and inspected by the native worker. This checks renderer lifecycle and handle ownership, not keyboard editing.",
  checks: [],
  errors: [],
  exe_sha256: hash(exe),
  asar_sha256: packaged
    ? hash(path.join(path.dirname(exe), "resources/app.asar"))
    : null,
  native_code_sha256: nativeHash.digest("hex"),
};
const out = path.join(root, "tests/output");
fs.mkdirSync(out, { recursive: true });
const reportPath = path.join(out, "source-lifecycle-v191-report.json");
function fixture() {
  const stream = "BT /F1 12 Tf 30 100 Td (Lifecycle 191) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += "xref\n0 6\n0000000000 65535 f \n";
  pdf += offsets
    .slice(1)
    .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
    .join("");
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return [...Buffer.from(pdf)];
}
const data = fixture();
let app, page;
function checkText(result) {
  assert(result.objects.some((o) => o.text?.includes("Lifecycle 191")));
}
async function inspect(handle) {
  return page.evaluate(
    (sourceHandle) =>
      window.desktop.native({ command: "inspect", sourceHandle, page: 1 }),
    handle,
  );
}
async function register() {
  return page.evaluate(
    (bytes) => window.desktop.registerSource(new Uint8Array(bytes)),
    data,
  );
}
(async () => {
  app = await _electron.launch({
    executablePath: exe,
    args: [
      ...(packaged ? [] : [root]),
      "--user-data-dir=" +
        fs.mkdtempSync(path.join(os.tmpdir(), "folio-source-lifecycle-")),
    ],
    env: { ...process.env, FOLIO_TEST_BACKGROUND: "1" },
    timeout: 60000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.waitForFunction(() => !!window.desktop?.registerSource);

  for (let i = 0; i < 20; i++) {
    const source = await register();
    checkText(await inspect(source.handle));
    await page.evaluate(
      (handle) => window.desktop.releaseSource(handle),
      source.handle,
    );
  }
  report.checks.push(
    "20 same-renderer register/inspect/release cycles succeed without raising the 16-source limit",
  );

  // Run as soon as the new document's preload API exists, before app modules.
  // This catches a navigation hook that clears the new document too late.
  await page.addInitScript((bytes) => {
    window.__lifecycleEarly = window.desktop
      .registerSource(new Uint8Array(bytes))
      .then(
        (source) => ({ source }),
        (error) => ({ error: error.message }),
      );
  }, data);
  let previous, current;
  for (let i = 0; i < 20; i++) {
    await page.reload();
    const early = await page.evaluate(() => window.__lifecycleEarly);
    assert(!early.error, early.error);
    current = early.source;
    checkText(await inspect(current.handle));
    if (previous) await assert.rejects(inspect(previous.handle), /失效/);
    previous = current;
  }
  report.checks.push(
    "20 committed reloads reclaim old handles and preserve new-document registration started before app initialization",
  );

  await page.evaluate(() => {
    window.location.hash = "lifecycle";
  });
  checkText(await inspect(current.handle));
  report.checks.push(
    "Same-document hash navigation preserves the current source",
  );

  const cancelledURL = await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    return new Promise((resolve) => {
      contents.once("will-navigate", () =>
        setImmediate(() => resolve(contents.getURL())),
      );
      void contents.executeJavaScript(
        "window.location.href='folio://app/cancelled-lifecycle.html'",
      );
    });
  });
  assert(cancelledURL.includes("/index.html"));
  checkText(await inspect(current.handle));
  report.checks.push(
    "A cancelled top-level navigation preserves the current source",
  );

  // A gone renderer has no JS owner left. Verify that event independently of
  // the next reload by checking the synthetic handle's private cache file.
  const processId = await app.evaluate(() => process.pid);
  const cache = fs
    .readdirSync(os.tmpdir())
    .filter((name) => name.startsWith("folio-source-"))
    .map((name) => path.join(os.tmpdir(), name))
    .find((directory) => {
      try {
        return (
          JSON.parse(fs.readFileSync(path.join(directory, "folio-owner.json")))
            .pid === processId
        );
      } catch {
        return false;
      }
    });
  assert(cache);
  const sourceFile = path.join(cache, current.handle + ".pdf");
  assert(fs.existsSync(sourceFile));
  await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    return new Promise((resolve) => {
      contents.once("render-process-gone", () => resolve());
      contents.forcefullyCrashRenderer();
    });
  });
  // collect() removes its entry before awaiting filesystem deletion.
  await assert.doesNotReject(async () => {
    for (let i = 0; i < 100 && fs.existsSync(sourceFile); i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert(!fs.existsSync(sourceFile));
  });
  report.checks.push(
    "Renderer termination reclaims its source before any subsequent navigation",
  );
  // A Playwright Page cannot initiate navigation while marked crashed.
  // Electron owns recovery and replaces the renderer for this WebContents.
  await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    return new Promise((resolve) => {
      contents.once("did-finish-load", () => resolve());
      contents.reload();
    });
  });
  // Playwright retains the crashed Page state. Drive the recovered renderer
  // through Electron, still using only the public preload registration API.
  const recovered = await app.evaluate(
    ({ BrowserWindow }, bytes) =>
      BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(
        `(async () => {
        const source = await window.desktop.registerSource(new Uint8Array(${JSON.stringify(bytes)}));
        return window.desktop.native({command: "inspect", sourceHandle: source.handle, page: 1});
      })()`,
      ),
    data,
  );
  checkText(recovered);
  report.checks.push(
    "A new renderer can register and inspect immediately after crash recovery",
  );
  assert.deepEqual(report.errors, []);
  console.log("PASS", report.checks.length, "source lifecycle checks");
})()
  .catch((error) => {
    report.errors.push(error.stack || error.message);
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    await page?.evaluate(() => window.desktop?.setDirty(false)).catch(() => {});
    await app?.close().catch(() => {});
  });
