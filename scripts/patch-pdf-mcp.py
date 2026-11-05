"""Replay the Folio source extension on the pinned upstream; fail on drift."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
source = root / "integrations/pdf-mcp-upstream"
patch = root / "integrations/pdf-mcp-folio.patch"
pin = "9d66cca073f664a8c97d4984b5d9d61d68d4ba30"
if subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip() != pin:
    raise RuntimeError("PDF MCP source revision mismatch")
def check(*args):
    return subprocess.run(["git", "apply", *args, "--check", str(patch)], cwd=source, capture_output=True).returncode == 0
if check():
    subprocess.run(["git", "apply", "--index", str(patch)], cwd=source, check=True)
elif not check("--reverse"):
    raise RuntimeError("PDF MCP extension conflicts with local/upstream changes")
print("Verified Folio batch extension against pinned PDF MCP source")
