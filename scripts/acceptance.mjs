import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
const manifest = JSON.parse(
  readFileSync(new URL("./acceptance.json", import.meta.url)),
);
const mode = process.argv[2] || "quick";
const stages = mode === "full" ? ["quick", "native", "browser"] : [mode];
for (const stage of stages) {
  if (!manifest[stage]) throw Error("Unknown acceptance stage: " + stage);
  for (const item of manifest[stage]) {
    console.log("Acceptance:", item.capability);
    const command =
      item.runtime === "node"
        ? process.execPath
        : process.env.FOLIO_PYTHON ||
          process.env.CODEX_PRIMARY_RUNTIME_PYTHON ||
          (process.platform === "win32" ? "python" : "python3");
    const args = [
      ...item.args,
      ...(item.unitGlob
        ? readdirSync("tests")
            .filter((n) => n.endsWith(".test.mjs"))
            .map((n) => "tests/" + n)
        : []),
    ];
    const p = spawnSync(command, args, { stdio: "inherit" });
    if (p.error) throw p.error;
    if (p.status !== 0) process.exit(p.status || 1);
  }
}
