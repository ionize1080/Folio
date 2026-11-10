import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as PE from "pe-library";
import * as RE from "resedit";
const require = createRequire(import.meta.url),
  asar = require("@electron/asar");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageName = process.env.FOLIO_PACKAGE_NAME || "Folio-PDF-Studio-win-x64";
assert(/^[a-zA-Z0-9_-]{1,100}$/.test(packageName), "Invalid package output directory name");
const out = path.join(root, "dist", packageName);
assert(
  !(await fs.readdir(out)).some((name) => name.startsWith(".Folio.exe.")),
  "runtime staging file included in package",
);
const bytes = await fs.readFile(path.join(out, "Folio.exe")),
  exe = PE.NtExecutable.from(bytes),
  res = PE.NtExecutableResource.from(exe);
assert.equal(bytes.toString("ascii", 0, 2), "MZ");
const peOffset = bytes.readUInt32LE(60);
assert.equal(bytes.readUInt16LE(peOffset + 4), 0x8664);
assert.equal(bytes.readUInt16LE(peOffset + 24), 0x20b);
const strings = RE.Resource.VersionInfo.fromEntries(
  res.entries,
)[0].getStringValues({ lang: 1033, codepage: 1200 });
assert.equal(strings.ProductName, "Folio PDF Studio");
assert.equal(strings.OriginalFilename, "Folio.exe");
assert.equal(
  strings.FileVersion,
  JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"))
    .version + ".0",
);
assert(RE.Resource.IconGroupEntry.fromEntries(res.entries).length > 0);
const archive = path.join(out, "resources/app.asar"),
  packed = asar
    .listPackage(archive)
    .map((name) => name.split(path.sep).join("/"));
const packageInfo = JSON.parse(
  asar.extractFile(archive, "package.json").toString("utf8"),
);
const releaseLabel =
  packageInfo.version +
  (packageInfo.releaseChannel
    ? " " + packageInfo.releaseChannel.toUpperCase()
    : "");
const indexHTML = asar.extractFile(archive, "src/index.html").toString("utf8");
assert(
  indexHTML.includes(
    `<title>${packageInfo.productName} ${releaseLabel}</title>`,
  ),
  "packaged window title differs from release version",
);
assert(
  indexHTML.includes(`<span class="version">${releaseLabel}</span>`),
  "packaged visible version differs from release version",
);
for (const f of [
  "ai-host.cjs",
  "ai-dock.cjs",
  "creative-studio.cjs",
  "src/creative-embedded.mjs",
  "src/creative-ui.mjs",
  "src/creative-tools.mjs",
  "src/creative-background.mjs",
  "src/creative-menus.mjs",
  "src/creative-picker.mjs",
  "src/page-organizer.mjs",
  "src/page-organization-geometry.mjs",
  "src/blank-pages.mjs",
  "src/blank-pages-ui.mjs",
  "src/page-inspection-cache.mjs",
  "src/ribbon.css",
  "storage-budget.cjs",
  "src/ai-ui.mjs",
  "src/ai-tools.mjs",
  "src/ai-worker.mjs",
  "native-bridge.cjs",
  "large-files.cjs",
  "flow-layout.cjs",
  "flow-validation.cjs",
  "source-store.cjs",
  "temp-store.cjs",
  "src/project-worker.mjs",
  "src/zip-store.mjs",
  "src/portable-state.mjs",
  "src/native-source.mjs",
  "src/edit-assets.mjs",
  "src/session-state.mjs",
  "src/vendor/purify.es.mjs",
  "src/flow-page-model.mjs",
  "src/rule-memory.mjs",
  "src/bookmark-filter.mjs",
  "src/filter-worker.mjs",
  "src/decrypt-ui.mjs",
  "src/encrypted-open.mjs",
  "src/flow-ui.mjs",
  "src/flow-model.mjs",
  "src/large-workspace.mjs",
  "src/large-rules-worker.mjs",
  "src/project.mjs",
  "src/region-select.mjs",
  "src/copy-region-ui.mjs",
  "ocr-jobs.cjs",
  "ocr-review-merge.cjs",
  "ocr-reading-order.cjs",
  "src/bookmark-tools.mjs",
  "src/bookmark-ui.mjs",
  "src/page-picker.mjs",
  "src/ocr-ui.mjs",
  "src/ocr-data.mjs",
  "node_modules/opencc-js/package.json",
  "src/text-lines.mjs",
  "src/calibrate-worker.mjs",
  "src/native-ui.mjs",
  "src/changes.mjs",
  "main.cjs",
  "file-store.cjs",
  "preload.cjs",
  "src/viewer.mjs",
  "src/generation.mjs",
  "src/shortcuts.mjs",
  "src/recovery.mjs",
  "src/app.mjs",
  "src/pdf-core.mjs",
  "src/pdf-loading.mjs",
  "src/model.mjs",
  "src/vendor/pdf.mjs",
  "src/vendor/pdf.worker.mjs",
  "src/vendor/wasm/openjpeg.wasm",
  "src/vendor/wasm/openjpeg_nowasm_fallback.js",
  "src/vendor/wasm/jbig2.wasm",
  "src/vendor/wasm/qcms_bg.wasm",
  "src/vendor/cmaps/Adobe-GB1-UCS2.bcmap",
  "src/vendor/cmaps/Adobe-CNS1-UCS2.bcmap",
  "src/vendor/cmaps/Adobe-Japan1-UCS2.bcmap",
  "src/vendor/cmaps/Adobe-Korea1-UCS2.bcmap",
  "src/vendor/cmaps/UniGB-UCS2-H.bcmap",
  "src/vendor/cmaps/UniCNS-UCS2-H.bcmap",
  "src/vendor/cmaps/UniJIS-UCS2-H.bcmap",
  "src/vendor/cmaps/UniKS-UCS2-H.bcmap",
  "src/vendor/standard_fonts/FoxitDingbats.pfb",
  "src/vendor/standard_fonts/FoxitFixed.pfb",
  "src/vendor/standard_fonts/FoxitSerif.pfb",
  "src/vendor/standard_fonts/FoxitSymbol.pfb",
  "src/vendor/standard_fonts/LiberationSans-Regular.ttf",
  "src/vendor/pdf-lib.js",
  "src/line-geometry.mjs",
  "src/bookmark-split.mjs",
  "src/flow-structure.mjs",
  "src/ocr-stream.mjs",
  "src/ocr-review-store.mjs",
  "src/units.mjs",
  "src/drop-open.mjs",
  "src/page-diff.mjs",
  "src/table-model.mjs",
  "src/table-ui.mjs",
  "src/font-label.mjs",
  "src/vendor/folio-ui.ttf",
]) {
  assert(packed.includes("/" + f), `missing ${f}`);
  assert.equal(
    createHash("sha256")
      .update(asar.extractFile(archive, path.normalize(f)))
      .digest("hex"),
    createHash("sha256")
      .update(await fs.readFile(path.join(root, f)))
      .digest("hex"),
    `stale ${f}`,
  );
}
let comparedFiles = 0;
for (const f of packed) {
  const rel = f.replace(/^\//, "");
  if (rel === "package.json") continue;
  const local = path.join(root, rel);
  const st = await fs.stat(local).catch(() => null);
  if (!st?.isFile()) continue;
  assert.equal(
    createHash("sha256")
      .update(asar.extractFile(archive, path.normalize(rel)))
      .digest("hex"),
    createHash("sha256")
      .update(await fs.readFile(local))
      .digest("hex"),
    `stale packaged file: ${rel}`,
  );
  comparedFiles++;
}
for (const f of [
  "LICENSE",
  "LICENSES.chromium.html",
  "icudtl.dat",
  "resources.pak",
  "chrome_100_percent.pak",
  "chrome_200_percent.pak",
  "ffmpeg.dll",
  "dxcompiler.dll",
  "d3dcompiler_47.dll",
  "v8_context_snapshot.bin",
  "locales/zh-CN.pak",
])
  await fs.access(path.join(out, f));
let nativeFiles = 0;
async function compareNative(dir, rel = "") {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (["__pycache__", "build-wheels"].includes(e.name) || e.name.endsWith('.msi')) continue;
    const r = path.join(rel, e.name),
      src = path.join(dir, e.name);
    if (e.isDirectory()) await compareNative(src, r);
    else {
      assert.equal(
        createHash("sha256")
          .update(await fs.readFile(src))
          .digest("hex"),
        createHash("sha256")
          .update(await fs.readFile(path.join(out, "resources/native", r)))
          .digest("hex"),
        "native mismatch " + r,
      );
      nativeFiles++;
    }
  }
}
await compareNative(path.join(root, "native"));
const nativeCodeHash = createHash("sha256");
const nativeDirectory = path.join(out, "resources/native");
for (const name of (await fs.readdir(nativeDirectory))
  .filter((n) => n.endsWith(".py"))
  .sort()) {
  const hash = createHash("sha256")
    .update(await fs.readFile(path.join(nativeDirectory, name)))
    .digest("hex");
  nativeCodeHash.update(name + "\n" + hash + "\n");
}
for (const f of [
  "python.exe",
  "python312.dll",
  "msvcp140.dll",
  "msvcp140_1.dll",
  "vcruntime140.dll",
  "vcruntime140_1.dll",
])
  await fs.access(path.join(out, "resources/native/runtime", f));
assert(
  !packed.includes("/flow-layout-legacy.cjs"),
  "product still includes legacy renderer",
);
for (const f of [
  "original_patch.py",
  "font_resolver.py",
  "ocr_diagnostics.py",
  "large_pdf.py",
  "qpdf_tools.py",
  "original_layout.py",
  "font_similarity.py",
  "table_export.py",
  "runtime/Lib/site-packages/pikepdf/_core.cp312-win_amd64.pyd",
  "runtime/Lib/site-packages/lxml/etree.cp312-win_amd64.pyd",
  "story.py",
  "type1_restore.py",
  "image_edit.py",
  "creative_graphics.py",
  "page_organization.py",
  "table_render.py",
  "table_geometry.py",
  "vendor/fontTools/__init__.py",
  "vendor/fontTools/LICENSE",
  "models/layout_cdla.onnx",
  "runtime/Lib/site-packages/pymupdf/__init__.py",
  "runtime/Lib/site-packages/rapid_layout/__init__.py",
])
  await fs.access(path.join(out, "resources/native", f));
for (const name of [
  "Chatbox/Chatbox-1.20.3-source.zip",
  "Chatbox/CHATBOX-LICENSE.txt",
  "pdf-runtime/python.exe",
  "pdf-runtime/tesseract/tesseract.exe",
])
  await fs.access(path.join(out, "resources", name));
for (const name of [
  "profile.cjs",
  "tool-schema.cjs",
  "result-cache.cjs",
  "upstream.json",
  "stdio.cjs",
  "network.cjs",
  "vision-body.cjs",
])
  assert.deepEqual(
    await fs.readFile(path.join(out, "resources/Chatbox", name)),
    await fs.readFile(path.join(root, "integrations/chatbox", name)),
    `stale Chatbox adapter ${name}`,
  );
for (const name of ["pdf-server.py", "pdf_objects.py"])
  assert.deepEqual(
    await fs.readFile(path.join(out, "resources/pdf-runtime", name)),
    await fs.readFile(path.join(root, "integrations", name)),
    `stale PDF adapter ${name}`,
  );
assert.equal(await fs.stat(path.join(out, "resources/ChatboxRuntime")).catch(()=>null), null, "No duplicate Electron runtime");
const creativeLock=JSON.parse(await fs.readFile(path.join(root,'integrations/creative/source-lock.json'),'utf8'));
for(const kind of ['photo','vector']){
  const dir=path.join(out,'resources/creative',kind),build=JSON.parse(await fs.readFile(path.join(dir,'build.json'),'utf8'));
  assert.equal(build.revision,creativeLock[kind].revision,'Pinned editing engine revision');
  assert.equal(build.sourceFingerprint,JSON.parse(await fs.readFile(path.join(root,'.creative-web',kind,'build.json'),'utf8')).sourceFingerprint);
  for(const [file,hash] of Object.entries(build.files))assert.equal(createHash('sha256').update(await fs.readFile(path.join(dir,file))).digest('hex'),hash,'Editing engine integrity: '+kind+'/'+file);
  for(const file of ['engine_bg.wasm','engine.js','index.html','licenses/Folio.md','licenses/LICENSE-MIT','licenses/LICENSE-APACHE','fonts/manifest.txt'])await fs.access(path.join(dir,file));
}
const pdfProvenance=JSON.parse(await fs.readFile(path.join(out,"resources/pdf-runtime/provenance.json"),"utf8"));
assert.equal(pdfProvenance.pdfMcpCommit,"9d66cca073f664a8c97d4984b5d9d61d68d4ba30");
assert.equal(pdfProvenance.folioPatchSha256,createHash("sha256").update(await fs.readFile(path.join(root,"integrations/pdf-mcp-folio.patch"))).digest("hex"));
for(const name of ["folio_batch.py","registry.py"])
  assert.deepEqual(await fs.readFile(path.join(out,"resources/pdf-runtime/Lib/site-packages/pdf_mcp",name)),
    await fs.readFile(path.join(root,"integrations/pdf-mcp-upstream/pdf_mcp",name)),`stale upstream extension ${name}`);
const chatboxProvenance = JSON.parse(
  await fs.readFile(
    path.join(out, "resources/Chatbox/provenance.json"),
    "utf8",
  ),
);
assert.equal(
  chatboxProvenance.sourceCommit,
  "d3cd0ad1e6a1127bbbf3991bb5296c181f4cbdeb",
);
assert.equal(chatboxProvenance.build, "pinned-source");
for (const patch of chatboxProvenance.patches)
  assert.equal(
    createHash("sha256")
      .update(
        await fs.readFile(
          path.join(out, "resources/Chatbox/native", patch.file),
        ),
      )
      .digest("hex"),
    patch.sha256,
    `Chatbox patch ${patch.file}`,
  );
const info = {
  native_compared_files: nativeFiles,
  native_code_sha256: nativeCodeHash.digest("hex"),
  pe_machine: "AMD64",
  format: "PE32+",
  product: strings.ProductName,
  version: strings.FileVersion,
  packed_files: packed.length,
  compared_source_files: comparedFiles,
  asar_sha256: createHash("sha256")
    .update(await fs.readFile(archive))
    .digest("hex"),
  exe_sha256: createHash("sha256").update(bytes).digest("hex"),
  checked: "Resource metadata, runtime files, app.asar source hashes",
  windows_launch_tested: false,
};
await fs.mkdir(path.join(root, "tests/output"), { recursive: true });
await fs.writeFile(
  path.join(root, "tests/output/package-report.json"),
  JSON.stringify(info, null, 2),
);
console.log(info);
