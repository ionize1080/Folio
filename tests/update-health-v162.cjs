const { _electron } = require("playwright");
const fs = require("fs"),
  path = require("path"),
  assert = require("assert/strict"),
  crypto = require("crypto");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "tests/output");
const profile = fs.mkdtempSync(path.join(out, "background-health-"));
const home = path.join(profile, "updates");
fs.mkdirSync(home);
const health = path.join(
  home,
  "install-11111111-1111-1111-1111-111111111111.json.health.json",
);
const version = require("../package.json").version,
  checks = [],
  errors = [];
let app;
const hash = (f) =>
  crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
async function ready() {
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    try {
      const r = JSON.parse(fs.readFileSync(health));
      if (r.version === version) return r;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Initialized background window did not acknowledge startup");
}
(async () => {
  try {
    app = await _electron.launch({
      executablePath: process.env.FOLIO_EXE,
      args: ["--user-data-dir=" + profile, "--folio-update-health=" + health],
      timeout: 60000,
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(30000);
    const first = await ready();
    assert.equal(first.pid, await app.evaluate(() => process.pid));
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].minimize(),
    );
    assert.equal(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isMinimized(),
      ),
      true,
    );
    fs.rmSync(health);
    await page.reload({ waitUntil: "domcontentloaded" });
    const background = await ready();
    assert.equal(background.pid, first.pid);
    assert.equal(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isMinimized(),
      ),
      true,
    );
    checks.push(
      "A fully initialized minimized renderer acknowledges its exact version and PID without a paint or focus event",
    );
  } catch (e) {
    errors.push(e.stack);
  } finally {
    await app?.close().catch(() => {});
    const exe = path.resolve(process.env.FOLIO_EXE),
      report = {
        platform: process.platform,
        checks,
        errors,
        exe_sha256: hash(exe),
        asar_sha256: hash(path.join(path.dirname(exe), "resources/app.asar")),
      };
    fs.writeFileSync(
      path.join(out, "v162-health-report.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
    if (!errors.length)
      fs.rmSync(profile, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 300,
      });
    if (errors.length) process.exitCode = 1;
  }
})();
