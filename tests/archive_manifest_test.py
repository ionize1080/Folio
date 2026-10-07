import unittest, tempfile, subprocess, sys, json, hashlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from archive_manifest import source_files
class ArchiveTests(unittest.TestCase):
 def test_only_tracked_and_verified_assets(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);subprocess.run(['git','init','-q',temp],check=True)
   (root/'source.mjs').write_text('export const safe=true;')
   (root/'native/models').mkdir(parents=True)
   data=b'pinned model';(root/'native/models/model.onnx').write_bytes(data)
   (root/'native/models/manifest.json').write_text(json.dumps([dict(name='model',sha256=hashlib.sha256(data).hexdigest())]))
   subprocess.run(['git','add','source.mjs','native/models/manifest.json'],cwd=root,check=True)
   for name in ['.env','private.pdf','old-release.zip','diagnose-personal.txt']:(root/name).write_text('private')
   self.assertEqual({p.as_posix() for p in source_files(root)},{'source.mjs','native/models/manifest.json','native/models/model.onnx'})
   (root/'native/models/model.onnx').write_bytes(b'wrong');self.assertRaises(ValueError,source_files,root)
 def test_tracked_secret_and_symlink_fail_closed(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);subprocess.run(['git','init','-q',temp],check=True)
   (root/'.env').write_text('secret');subprocess.run(['git','add','.env'],cwd=root,check=True)
   self.assertRaises(ValueError,source_files,root)
if __name__=='__main__':unittest.main()
