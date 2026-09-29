import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { curveLUT, parseCube } from "../src/image-color-model.mjs";
const { compare, selectRelease, config, assetURL, UpdateManager } =
  createRequire(import.meta.url)("../update-manager.cjs");
const asset = (name = "Folio-PDF-Studio-1.3.0-portable-win-x64.zip") => ({
  name,
  browser_download_url:
    "https://github.com/ionize1080/Folio/releases/download/v1.3.0/" + name,
});
test("Stable, prerelease and numeric ordering across tags", () => {
  assert(compare("v1.3.0", "1.3.0-rc1") > 0);
  assert(compare("1.3.0-rc1-p10", "1.3.0-rc1-p9") > 0);
  const releases = [
    { tag_name: "v1.3.1-rc1", prerelease: true, assets: [asset()] },
    { tag_name: "v1.3.0", assets: [asset()] },
    { tag_name: "v9.0.0", draft: true, assets: [asset()] },
  ];
  assert.equal(selectRelease(releases, "1.2.2", "stable").tag_name, "v1.3.0");
  assert.equal(
    selectRelease(releases, "1.2.2", "preview").tag_name,
    "v1.3.1-rc1",
  );
  assert.equal(selectRelease(releases, "2.0.0", "stable"), null);
});
test("Proxy validation and repository-bound download URLs", () => {
  assert.equal(
    config({ proxy: "http://127.0.0.1:7890" }).proxy,
    "http://127.0.0.1:7890",
  );
  for (const proxy of [
    "file:///tmp/x",
    "http://user:pass@localhost",
    "http://localhost/a",
  ])
    assert.throws(() => config({ proxy }));
  assert.throws(() => assetURL("https://evil.example/a"));
  assert.throws(() =>
    assetURL("https://github.com/other/repo/releases/download/a"),
  );
});
test("Downloads stream to disk, exact digest/size; failure never ready", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "folio-update-test-")),
    body = Buffer.from("test portable bytes"),
    hash = crypto.createHash("sha256").update(body).digest("hex"),
    a = { ...asset(), size: body.length, digest: "sha256:" + hash },
    release = { tag_name: "v1.3.0", assets: [a] };
  let bad = false,
    proxy;
  const session = {
    setProxy: async (p) => (proxy = p),
    closeAllConnections: async () => {},
    fetch: async (url) =>
      url.includes("api.github.com")
        ? Response.json([release])
        : new Response(bad ? Buffer.alloc(body.length) : body),
  };
  const m = new UpdateManager({
    app: { getPath: () => home, getVersion: () => "1.2.2" },
    session,
  });
  try {
    await m.init();
    await m.configure({ channel: "stable", proxy: "http://127.0.0.1:7890" });
    assert.equal(proxy.proxyRules, "http://127.0.0.1:7890");
    assert.equal((await m.check()).phase, "available");
    assert.equal((await m.download()).phase, "ready");
    assert.deepEqual(await fs.readFile(m.ready.file), body);
    bad = true;
    await assert.rejects(m.download(), /SHA-256/);
    assert.equal(m.ready, null);
    assert.equal(m.info().phase, "error");
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});
test("Cubic knots, no overshoot and bounded cube parser", () => {
  const p = [
      [0, 0],
      [45, 15],
      [140, 200],
      [255, 255],
    ],
    lut = curveLUT(p);
  assert.equal(lut[45], 15);
  assert.equal(lut[140], 200);
  assert(lut.every((v, i) => !i || v >= lut[i - 1]));
  const s =
    "LUT_3D_SIZE 2\n" +
    [0, 1]
      .flatMap((b) =>
        [0, 1].flatMap((g) => [0, 1].map((r) => `${r} ${g} ${b}`)),
      )
      .join("\n");
  assert.equal(parseCube(s).data.length, 24);
  assert.throws(() => parseCube("LUT_3D_SIZE 100"));
  assert.throws(() => parseCube(s + "\n2 2 2"));
});
