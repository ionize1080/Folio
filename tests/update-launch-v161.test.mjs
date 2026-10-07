import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const { UpdateManager } = createRequire(import.meta.url)(
  "../update-manager.cjs",
);

test(
  "Windows production launcher executes the helper and reports a bad checksum without closing Folio",
  { skip: process.platform !== "win32" },
  async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "Folio 启动 ' "));
    let quit = false;
    const manager = new UpdateManager({
      app: {
        isPackaged: true,
        getVersion: () => "1.6.0",
        getPath: (n) =>
          n === "exe" ? path.join(home, "app", "Folio.exe") : home,
        quit: () => {
          quit = true;
        },
      },
      session: {},
    });
    try {
      await fs.mkdir(manager.home, { recursive: true });
      const file = path.join(home, "invalid.zip");
      await fs.writeFile(file, "bad");
      manager.ready = { file, hash: "0".repeat(64), version: "v1.6.1" };
      // Suppress only the helper's progress window; retain the production launcher.
      manager.headless = true;
      await assert.rejects(manager.install(), /checksum mismatch/);
      assert.equal(quit, false);
      assert.equal(
        manager.info().canInstall,
        true,
        "a prepared download remains retryable",
      );
      const files = await fs.readdir(manager.home);
      assert(files.some((n) => n.endsWith(".launch.log")));
      assert(
        !files.some((n) => n.endsWith(".commit.json")),
        "failure must not authorize a swap",
      );
      assert.match(
        await fs.readFile(path.join(manager.home, "install.log"), "utf8"),
        /checksum mismatch/,
      );
    } finally {
      await fs.rm(home, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 200,
      });
    }
  },
);

test("Install result is restored and path traversal in the pending pointer is ignored", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "folio-result-"));
  const app = { getVersion: () => "1.6.1", getPath: () => home };
  const session = {
    setProxy: async () => {},
    closeAllConnections: async () => {},
  };
  const manager = new UpdateManager({ app, session });
  try {
    await fs.mkdir(manager.home, { recursive: true });
    await fs.writeFile(
      path.join(manager.home, "last-install.json"),
      JSON.stringify({ manifest: "install-ab12.json" }),
    );
    await fs.writeFile(
      path.join(manager.home, "install-ab12.json.status.json"),
      "\uFEFF" + JSON.stringify({ phase: "failed", message: "Rolled back" }),
    );
    assert.equal((await manager.init()).lastInstall.message, "Rolled back");
    await fs.writeFile(
      path.join(manager.home, "last-install.json"),
      JSON.stringify({ manifest: "../../secret" }),
    );
    assert.equal(
      (await new UpdateManager({ app, session }).init()).lastInstall,
      undefined,
    );
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});
