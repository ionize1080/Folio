"""Build and archive locally; never uploads or publishes."""
from pathlib import Path
import subprocess,sys
root=Path(__file__).resolve().parents[1]
for cmd in [['npm','test'],['node','scripts/package-win.mjs'],['node','scripts/verify-package.mjs'],[sys.executable,'scripts/archive-release.py']]:
 subprocess.run(cmd,cwd=root,check=True,shell=(sys.platform=='win32' and cmd[0]=='npm'))
