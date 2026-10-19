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
    let args = [
      ...item.args,
      ...(item.unitGlob
        ? readdirSync("tests")
            .filter((n) => n.endsWith(".test.mjs"))
            .map((n) => "tests/" + n)
        : []),
    ];
    if (item.runtime === "python" && args[0]?.endsWith(".py")) {
      // Embedded Python uses isolated paths; make sibling test helpers
      // available just as they are with a regular Python script invocation.
      args = [
        "-c",
        "import os,sys,runpy;sys.argv=sys.argv[1:];sys.path.insert(0,os.path.join(os.getcwd(),'native','vendor'));sys.path.insert(0,os.path.dirname(os.path.abspath(sys.argv[0])));runpy.run_path(sys.argv[0],run_name='__main__')",
        ...args,
      ];
    }
    const p = spawnSync(command, args, { stdio: "inherit" });
    if (p.error) throw p.error;
    if (p.status !== 0) process.exit(p.status || 1);
  }
}
