"""Publish the exact two archives and validation evidence from this workflow run."""
from pathlib import Path
import hashlib
import json
import os

from release_transport import gh, publish

root = Path(__file__).resolve().parents[1]
folder = root / "deliverables"
version = "2.8.5"
prefix = f"Folio-PDF-Studio-{version}"
tag = "v" + version
repo = os.environ["GITHUB_REPOSITORY"]
sha = os.environ["GITHUB_SHA"]
if (repo != "ionize1080/Folio" or os.environ["GITHUB_REF"] != "refs/heads/main"
        or os.environ["GITHUB_EVENT_NAME"] not in {"push", "workflow_dispatch"}):
    raise ValueError("Publication requires a trusted main run")
if json.loads((root / "package.json").read_text())["version"] != version:
    raise ValueError("The release version must match package.json")
validation = folder / f"{prefix}-validation.json"
checksums = folder / f"{prefix}-SHA256.txt"
archives = [folder / f"{prefix}-portable-win-x64.zip", folder / f"{prefix}-source.zip"]
evidence = json.loads(validation.read_text(encoding="utf-8"))
run_url = f"https://github.com/{repo}/actions/runs/{os.environ['GITHUB_RUN_ID']}"
if evidence["sourceCommit"] != sha or evidence["windowsActionsRun"] != run_url:
    raise ValueError("Evidence does not match this commit and run")

expected = []
for file in [*archives, validation]:
    with file.open("rb") as stream:
        expected.append(f"{hashlib.file_digest(stream, 'sha256').hexdigest()}  {file.name}")
if checksums.read_text(encoding="utf-8").splitlines() != expected:
    raise ValueError("Release files do not match the verified checksums")
ref = json.loads(gh("api", f"repos/{repo}/git/ref/heads/main"))
if ref["object"]["sha"] != sha:
    raise ValueError("A newer main commit must build and validate its own release")
publish(repo, tag, sha, f"Folio PDF Studio {version}", folder / "release-notes.md",
        [*archives, validation, checksums])
