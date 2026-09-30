// Real 1.3 and 1.5 Electron + native workers, same D: directory and shortcut.
const { _electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const assert = require("node:assert/strict");
const asar = require("@electron/asar");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "tests/output");
const archive = path.resolve("deliverables/Folio-PDF-Studio-1.5.0-win-x64.zip");
const hash = (f) =>
  crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const checks = [],
  errors = [];
let app, helper;
const base = fs.mkdtempSync(
  path.join(fs.existsSync("D:/") ? "D:/" : os.tmpdir(), "Folio 升级 ' "),
);
function ps(code, env = {}) {
  const p = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", code],
    { encoding: "utf8", env: { ...process.env, ...env }, timeout: 20000 },
  );
  if (p.status !== 0) throw Error(p.stderr);
  return p.stdout.trim();
}
function stop(target) {
  try {
    ps(
      "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($env:FOLIO_TEST_TARGET) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      { FOLIO_TEST_TARGET: target },
    );
  } catch {}
}
async function until(fn, timeout = 150000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const r = await fn();
    if (r) return r;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw Error("Timed out waiting for restart");
}
function extract(file, folder) {
  const p = spawnSync("python", ["-m", "zipfile", "-e", file, folder], {
    encoding: "utf8",
    timeout: 180000,
  });
  if (p.status !== 0) throw Error(p.stderr);
}
(async () => {
  try {
    assert(process.platform === "win32");
    const legacyDir = process.env.FOLIO_LEGACY_DIR;
    assert(legacyDir, "Missing real 1.3 release download");
    const legacy = path.join(
      legacyDir,
      fs.readdirSync(legacyDir).find((n) => n.endsWith(".zip")),
    );
    for (const mode of ["legacy13", "current15"]) {
      const folder = path.join(base, mode);
      extract(mode === "legacy13" ? legacy : archive, folder);
      const target = path.join(folder, "Folio-PDF-Studio"),
        exe = path.join(target, "Folio.exe");
      const oldAsar = hash(path.join(target, "resources/app.asar"));
      const shortcut = path.join(folder, "Folio.lnk");
      ps(
        "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:FOLIO_TEST_LINK);$s.TargetPath=$env:FOLIO_TEST_EXE;$s.WorkingDirectory=Split-Path $env:FOLIO_TEST_EXE;$s.Save()",
        { FOLIO_TEST_LINK: shortcut, FOLIO_TEST_EXE: exe },
      );
      const shortcutHash = hash(shortcut);
      app = await _electron.launch({ executablePath: exe, timeout: 60000 });
      const page = await app.firstWindow();
      await page.waitForFunction(() => !!window.desktop?.native);
      // Exercise the worker that previously was not stopped by app.quit().
      await page.evaluate(
        async (bytes) =>
          window.desktop.native({
            command: "inspect",
            bytes: new Uint8Array(bytes),
            page: 1,
          }),
        Array.from(fs.readFileSync(path.join(out, "v13-images.pdf"))),
      );
      const info = await app.evaluate(({ app }) => ({
        pid: process.pid,
        home: app.getPath("userData"),
        version: app.getVersion(),
      }));
      assert.equal(info.version, mode === "legacy13" ? "1.3.0" : "1.5.0");
      const updateDir = path.join(info.home, "updates");
      fs.mkdirSync(updateDir, { recursive: true });
      const manifest = path.join(
        updateDir,
        "install-" + crypto.randomUUID() + ".json",
      );
      const statusFile = manifest + ".status.json",
        healthFile = manifest + ".health.json";
      const data = {
        file: archive,
        hash: hash(archive),
        version: "v1.5.0",
        target,
        pid: info.pid,
      };
      if (mode === "current15")
        Object.assign(data, { statusFile, healthFile, headless: true });
      fs.writeFileSync(manifest, JSON.stringify(data));
      const script = path.join(folder, "outside-updater.ps1");
      fs.writeFileSync(
        script,
        asar.extractFile(
          path.join(target, "resources/app.asar"),
          "portable-update.ps1",
        ),
      );
      helper = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-STA",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          script,
          "-Manifest",
          manifest,
        ],
        { cwd: folder, stdio: "ignore" },
      );
      if (mode === "current15")
        await until(() => {
          try {
            return (
              JSON.parse(
                fs.readFileSync(statusFile, "utf8").replace(/^\uFEFF/, ""),
              ).phase === "ready"
            );
          } catch {
            return false;
          }
        });
      // Original 1.3 helper waits on the live PID after extraction. Close normally.
      await app.evaluate(({ app }) => {
        setTimeout(() => app.quit(), 50);
      });
      const oldProcess = app.process();
      await until(() => oldProcess.exitCode !== null, 60000);
      app = null;
      await until(() =>
        ps(
          'Get-Process | Where-Object { $_.Path -eq $env:FOLIO_TEST_EXE -and $_.MainWindowTitle -match "1.5.0" } | Select-Object -ExpandProperty Id',
          { FOLIO_TEST_EXE: exe },
        ),
      );
      await until(() => helper.exitCode !== null);
      if (mode === "current15")
        assert.equal(
          JSON.parse(fs.readFileSync(statusFile, "utf8").replace(/^\uFEFF/, ""))
            .phase,
          "complete",
        );
      const build = JSON.parse(
        fs.readFileSync(path.join(target, "BUILD-INFO.json"), "utf8"),
      );
      assert.equal(build.version, "1.5.0");
      assert.equal(
        build.asar_sha256,
        hash(path.join(target, "resources/app.asar")),
      );
      const backup = fs
        .readdirSync(folder)
        .find((n) => n.startsWith("Folio-PDF-Studio.backup-"));
      assert(backup);
      assert.equal(
        hash(path.join(folder, backup, "resources/app.asar")),
        oldAsar,
      );
      assert.equal(hash(shortcut), shortcutHash);
      stop(target);
      ps("Start-Process -FilePath $env:FOLIO_TEST_LINK", {
        FOLIO_TEST_LINK: shortcut,
      });
      await until(
        () =>
          ps(
            'Get-Process | Where-Object { $_.Path -eq $env:FOLIO_TEST_EXE -and $_.MainWindowTitle -match "1.5.0" } | Select-Object -ExpandProperty Id',
            { FOLIO_TEST_EXE: exe },
          ),
        60000,
      );
      stop(target);
      checks.push({
        mode,
        oldVersion: info.version,
        newVersion: build.version,
        drive: path.parse(target).root,
        unchangedDirectory: true,
        oldNativeWorkerStarted: true,
        restartedWindowObserved: true,
        shortcutHashUnchanged: true,
        shortcutOpensNewVersion: true,
        oldAsarRetainedInBackup: true,
      });
    }
  } catch (e) {
    errors.push(e.stack);
  } finally {
    await app?.close().catch(() => {});
    helper?.kill();
    stop(base);
    fs.rmSync(base, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 500,
    });
    const report = { platform: process.platform, checks, errors };
    fs.writeFileSync(
      path.join(out, "v15-updater-report.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
    if (errors.length) process.exitCode = 1;
  }
})();
