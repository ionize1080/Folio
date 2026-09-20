/** Build a complete Windows x64 portable folder, including its own Chromium runtime.
 * Set FOLIO_ELECTRON_ZIP to reuse an official Electron runtime zip (checksum verified).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import * as PE from "pe-library";
import * as ResEdit from "resedit";
const require = createRequire(import.meta.url),
  asar = require("@electron/asar"),
  { downloadArtifact } = require("@electron/get");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8"),
);
const version = pkg.devDependencies.electron;
const base = process.env.FOLIO_RUNTIME_BASE;
let runtime, hash;
if (base) {
  const info = JSON.parse(
    await fs.readFile(path.join(base, "BUILD-INFO.json"), "utf8"),
  );
  const exeHash = createHash("sha256")
    .update(await fs.readFile(path.join(base, "Folio.exe")))
    .digest("hex");
  if (info.electron !== version || info.exe_sha256 !== exeHash)
    throw Error(
      "Base runtime version or executable checksum mismatch; use an official Electron ZIP",
    );
  runtime = process.env.FOLIO_RUNTIME_BASE_ZIP;
  if (!runtime) throw Error("FOLIO_RUNTIME_BASE_ZIP is required");
  hash = createHash("sha256")
    .update(await fs.readFile(runtime))
    .digest("hex");
} else {
  runtime =
    process.env.FOLIO_ELECTRON_ZIP ||
    (await downloadArtifact({
      version,
      artifactName: "electron",
      platform: "win32",
      arch: "x64",
    }));
  hash = createHash("sha256")
    .update(await fs.readFile(runtime))
    .digest("hex");
  const sums = JSON.parse(
    await fs.readFile(
      path.join(root, "node_modules/electron/checksums.json"),
      "utf8",
    ),
  );
  if (hash !== sums[`electron-v${version}-win32-x64.zip`])
    throw Error("Official Electron runtime checksum mismatch");
}
const out = path.join(root, "dist", "Folio-PDF-Studio-win-x64"),
  stage = path.join(root, "dist", "app-stage");
await fs.rm(out, { recursive: true, force: true });
await fs.rm(stage, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });
await fs.mkdir(stage, { recursive: true });
// extract-zip is part of the locked Electron development dependencies.
if (base)
  await fs.cp(base, out, {
    recursive: true,
    filter: (p) => !path.basename(p).startsWith(".Folio.exe."),
  });
else await require("extract-zip")(runtime, { dir: out });
for (const item of [
  "src",
  "node_modules/opencc-js",
  "assets",
  "main.cjs",
  "file-store.cjs",
  "source-store.cjs",
  "temp-store.cjs",
  "native-bridge.cjs",
  "large-files.cjs",
  "flow-layout.cjs",
  "flow-validation.cjs",
  "ocr-jobs.cjs",
  "preload.cjs",
  "LICENSE",
  "THIRD-PARTY-NOTICES.md",
])
  await fs.cp(path.join(root, item), path.join(stage, item), {
    recursive: true,
  });
await fs.writeFile(
  path.join(stage, "package.json"),
  JSON.stringify(
    {
      name: pkg.name,
      productName: pkg.productName,
      version: pkg.version,
      releaseChannel: pkg.releaseChannel,
      description: pkg.description,
      main: pkg.main,
      type: pkg.type,
      license: pkg.license,
    },
    null,
    2,
  ),
);
await fs.access(path.join(root, "native/runtime/python.exe"));
await fs.cp(path.join(root, "native"), path.join(out, "resources/native"), {
  recursive: true,
  filter: (p) =>
    !p.includes("__pycache__") && !p.split(path.sep).includes("build-wheels"),
});
await asar.createPackage(stage, path.join(out, "resources", "app.asar"));
await fs.rm(path.join(out, "resources", "default_app.asar"), { force: true });
const exe = PE.NtExecutable.from(
    await fs.readFile(path.join(out, base ? "Folio.exe" : "electron.exe")),
    { ignoreCert: true },
  ),
  res = PE.NtExecutableResource.from(exe);
const ico = ResEdit.Data.IconFile.from(
  await fs.readFile(path.join(root, "assets/icon.ico")),
);
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
for (const group of groups)
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    group.id,
    group.lang,
    ico.icons.map((item) => item.data),
  );
for (const vi of ResEdit.Resource.VersionInfo.fromEntries(res.entries)) {
  vi.setFileVersion(pkg.version + ".0", 1033);
  vi.setProductVersion(pkg.version + ".0", 1033);
  vi.setStringValues(
    { lang: 1033, codepage: 1200 },
    {
      CompanyName: "Folio contributors",
      FileDescription: pkg.productName,
      ProductName: pkg.productName,
      OriginalFilename: "Folio.exe",
      InternalName: "Folio",
      LegalCopyright: "Copyright 2026 Folio contributors. MIT License.",
    },
  );
  vi.outputToResourceEntries(res.entries);
}
res.outputResource(exe);
await fs.writeFile(path.join(out, "Folio.exe"), Buffer.from(exe.generate()));
if (!base) await fs.rm(path.join(out, "electron.exe"));
await fs.cp(path.join(root, "docs"), path.join(out, "docs"), {
  recursive: true,
});
await fs.cp(
  path.join(root, "assets/Folio-Sample.pdf"),
  path.join(out, "Folio-Sample.pdf"),
);
await fs.copyFile(path.join(root, "README.md"), path.join(out, "README.md"));
await fs.copyFile(
  path.join(root, "LICENSE"),
  path.join(out, "FOLIO-LICENSE.txt"),
);
await fs.copyFile(
  path.join(root, "THIRD-PARTY-NOTICES.md"),
  path.join(out, "THIRD-PARTY-NOTICES.md"),
);
try {
  await fs.copyFile(
    path.join(root, "tests/output/10000-bookmarks.pdf"),
    path.join(out, "Stress-Test-10000.pdf"),
  );
} catch {}
await fs.writeFile(
  path.join(out, "BUILD-INFO.json"),
  JSON.stringify(
    {
      product: pkg.productName,
      version: pkg.version,
      releaseChannel: pkg.releaseChannel,
      target: "win32-x64",
      electron: version,
      runtime_sha256: hash,
      runtime_source: base
        ? "previous validated Folio runtime"
        : "official Electron ZIP",
      exe_sha256: createHash("sha256")
        .update(await fs.readFile(path.join(out, "Folio.exe")))
        .digest("hex"),
      signed: false,
    },
    null,
    2,
  ),
);
await fs.rm(stage, { recursive: true, force: true });
// Runtime staging files are not distributable assets.
for (const name of await fs.readdir(out))
  if (name.startsWith(".Folio.exe."))
    await fs.rm(path.join(out, name), { force: true });
console.log(out);
