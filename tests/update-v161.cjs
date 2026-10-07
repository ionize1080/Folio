// Real packaged Electron, the production UpdateManager launcher, and a complete
// release ZIP. No test process manually starts the PowerShell swap helper.
const { _electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "tests/output");
const base = fs.mkdtempSync(path.join(out, "updater 中文 ' "));
const archive = path.resolve(
  process.env.FOLIO_UPDATE_ZIP ||
    "deliverables/Folio-PDF-Studio-1.6.1-win-x64.zip",
);
const hash = (f) =>
  crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const checks = [],
  errors = [];
let app;
async function until(fn, timeout = 180000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const r = await fn();
    if (r) return r;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw Error("Update integration timed out");
}
function read(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}
function stop() {
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$root=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:FOLIO_TEST_ROOT_B64)); Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root + '\\') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
    ],
    {
      windowsHide: true,
      env: {
        ...process.env,
        FOLIO_TEST_ROOT_B64: Buffer.from(base).toString("base64"),
      },
    },
  );
}
(async () => {
  try {
    assert.equal(process.platform, "win32");
    const modes = process.env.FOLIO_LEGACY_APP
      ? ["legacy15", "current"]
      : ["current"];
    for (const mode of modes) {
      console.log("Starting updater acceptance:", mode);
      const target = path.join(base, mode, "Folio-PDF-Studio"),
        profile = path.join(base, mode, "profile");
      execFileSync(
        process.env.FOLIO_PYTHON || "python",
        [
          "-c",
          "import shutil,sys;shutil.copytree(sys.argv[1],sys.argv[2])",
          mode === "legacy15"
            ? process.env.FOLIO_LEGACY_APP
            : path.dirname(path.resolve(process.env.FOLIO_EXE)),
          target,
        ],
        { windowsHide: true },
      );
      const exe = path.join(target, "Folio.exe"),
        oldHash = hash(path.join(target, "resources/app.asar"));
      const shortcut = path.join(base, mode, "Folio.lnk");
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$ErrorActionPreference='Stop';$link=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:FOLIO_TEST_LINK_B64));$exe=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:FOLIO_TEST_EXE_B64));$s=(New-Object -ComObject WScript.Shell).CreateShortcut($link);$s.TargetPath=$exe;$s.WorkingDirectory=Split-Path $exe;$s.Save()",
        ],
        {
          windowsHide: true,
          env: {
            ...process.env,
            FOLIO_TEST_LINK_B64: Buffer.from(shortcut).toString("base64"),
            FOLIO_TEST_EXE_B64: Buffer.from(exe).toString("base64"),
          },
        },
      );
      const linkHash = hash(shortcut);
      fs.mkdirSync(path.join(profile, "updates"), { recursive: true });
      app = await _electron.launch({
        executablePath: exe,
        args: ["--user-data-dir=" + profile],
        timeout: 60000,
      });
      const page = await app.firstWindow();
      page.setDefaultTimeout(30000);
      console.log("Window opened:", mode, await page.title());
      await page.waitForFunction(() => !!window.desktop?.native);
      console.log("Native bridge ready:", mode);
      await page.evaluate(
        async (bytes) =>
          window.desktop.native({
            command: "inspect",
            bytes: new Uint8Array(bytes),
            page: 1,
          }),
        Array.from(fs.readFileSync(path.join(root, "assets/Folio-Sample.pdf"))),
      );
      const oldProcess = app.process();
      console.log("Native worker exercised:", mode);
      await app.evaluate(
        ({ app }, { modulePath, archive, hash }) => {
          const req = process
            .getBuiltinModule("module")
            .createRequire(app.getAppPath() + "/main.cjs");
          const { UpdateManager } = req(modulePath || "./update-manager.cjs");
          global.__updateIntegration = new UpdateManager({ app, session: {} });
          global.__updateIntegration.headless = true;
          global.__updateIntegration.ready = {
            file: archive,
            hash,
            version: "v1.6.1",
          };
          // Start after the RPC returns; app.quit() must close the real process.
          setTimeout(
            () =>
              global.__updateIntegration.install().catch((e) => {
                process
                  .getBuiltinModule("fs")
                  .writeFileSync(
                    app.getPath("userData") + "/test-error.txt",
                    e.stack,
                  );
              }),
            100,
          );
        },
        {
          modulePath:
            mode === "legacy15" ? path.join(root, "update-manager.cjs") : null,
          archive,
          hash: hash(archive),
        },
      );
      const updateHome = path.join(profile, "updates");
      console.log("Install requested:", mode);
      const pending = await until(() => {
        const error = path.join(profile, "test-error.txt");
        if (fs.existsSync(error)) throw Error(fs.readFileSync(error, "utf8"));
        return read(path.join(updateHome, "last-install.json"));
      });
      const manifest = path.join(updateHome, pending.manifest);
      const result = await until(() => {
        const s = read(manifest + ".status.json");
        if (s?.phase === "failed") throw Error(s.message);
        return s?.phase === "complete" ? s : null;
      }, 240000);
      assert.equal(
        oldProcess.exitCode,
        0,
        "old Electron process exits normally",
      );
      app = null;
      const health = read(manifest + ".health.json");
      assert.equal(health.version, "1.6.1");
      assert.equal(read(path.join(target, "BUILD-INFO.json")).version, "1.6.1");
      assert.equal(
        hash(path.join(result.backup, "resources/app.asar")),
        oldHash,
      );
      assert.equal(hash(shortcut), linkHash);
      assert.equal(read(manifest + ".commit.json").token, read(manifest).token);
      assert.equal(read(manifest).userData, profile);
      // A visible window proves that success was not merely a process spawn.
      const visible = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-Process -Id $env:FOLIO_TEST_PID | Select-Object -ExpandProperty MainWindowTitle",
        ],
        {
          windowsHide: true,
          encoding: "utf8",
          env: { ...process.env, FOLIO_TEST_PID: String(health.pid) },
        },
      ).trim();
      assert(visible.includes("1.6.1"), visible);
      checks.push({
        mode,
        oldProcessExited: true,
        helperSurvivedParent: true,
        window: visible,
        profilePreserved: true,
        shortcutPreserved: true,
        backupMatches: true,
      });
      stop();
    }
  } catch (e) {
    errors.push(e.stack);
  } finally {
    await app?.close().catch(() => {});
    stop();
    const exe = path.resolve(process.env.FOLIO_EXE);
    const report = {
      platform: process.platform,
      checks,
      errors,
      exe_sha256: hash(exe),
      asar_sha256: hash(path.join(path.dirname(exe), "resources/app.asar")),
    };
    fs.writeFileSync(
      path.join(out, "v161-updater-report.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
    // Keep isolated logs on failure for diagnosis.
    if (!errors.length)
      fs.rmSync(base, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 300,
      });
    if (errors.length) process.exitCode = 1;
  }
})();
