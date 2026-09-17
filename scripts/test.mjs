import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
const python =
  process.env.FOLIO_PYTHON ||
  process.env.CODEX_PRIMARY_RUNTIME_PYTHON ||
  (process.platform === "win32" ? "python" : "python3");
const mode = process.argv[2] || "all";
if (!["all", "native", "ui", "documents"].includes(mode))
  throw Error("Unknown test mode");
const run = (command, args) => {
  console.log("\nRUN", command, ...args);
  const p = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, FOLIO_PYTHON: python },
  });
  if (p.error) throw p.error;
  if (p.status !== 0) process.exit(p.status || 1);
};
if (mode === "documents") {
  process.env.FOLIO_TEST_DOCUMENTS = "1";
  run(python, ["tests/native-v10.py"]);
  run(process.execPath, ["tests/ui-v10.cjs"]);
  process.exit(0);
}
if (mode === "all")
  run(process.execPath, [
    "--test",
    ...readdirSync("tests")
      .filter((f) => f.endsWith(".test.mjs"))
      .map((f) => "tests/" + f),
  ]);
run(python, ["tests/fixture-v9.py"]);
run(python, ["tests/fixture-v10.py"]);
run(python, ["tests/fixture-encrypted-p1.py"]);
if (mode !== "ui")
  for (const version of [4, 9, 10, 11, 12])
    run(python, [`tests/native-v${version}.py`]);
if (mode !== "ui") run(process.execPath, ["tests/ocr-jobs-v5.cjs"]);
if (mode === "ui") run(python, ["tests/native-v11.py"]); // Creates actual subset/encryption fixtures.
if (mode !== "native")
  for (const file of [
    "ui-v9.cjs",
    "ui-v9-details.cjs",
    "ui-v10-all.cjs",
    "ui-v10-structure.cjs",
    "ui-v11.cjs",
    "ui-v12.cjs",
    "ui-encrypted-open-p1.cjs",
  ])
    run(process.execPath, ["tests/" + file]);
