const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const prefixes = ["folio-source-", "folio-native-", "folio-content-cache-"];
async function makeTemp(prefix) {
  if (!prefixes.includes(prefix)) throw Error("Unknown temporary store");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.writeFile(
    path.join(dir, "folio-owner.json"),
    JSON.stringify({ pid: process.pid, created: Date.now() }),
    { mode: 0o600 },
  );
  return dir;
}
async function cleanupTemps(root = os.tmpdir()) {
  let removed = 0;
  for (const e of await fs.readdir(root, { withFileTypes: true })) {
    if (!e.isDirectory() || !prefixes.some((p) => e.name.startsWith(p)))
      continue;
    const dir = path.join(root, e.name);
    try {
      const owner = JSON.parse(
        await fs.readFile(path.join(dir, "folio-owner.json"), "utf8"),
      );
      if (
        !Number.isInteger(owner.pid) ||
        owner.pid <= 0 ||
        !Number.isFinite(owner.created) ||
        Date.now() - owner.created < 300000
      )
        continue;
      try {
        process.kill(owner.pid, 0);
        continue;
      } catch (err) {
        if (err.code !== "ESRCH") continue;
      }
      await fs.rm(dir, { recursive: true, force: true });
      removed++;
    } catch {}
  }
  return removed;
}
module.exports = { makeTemp, cleanupTemps };
