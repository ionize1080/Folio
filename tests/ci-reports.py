import importlib.util, json, tempfile, unittest, pathlib
spec=importlib.util.spec_from_file_location('ci_reports',pathlib.Path(__file__).resolve().parents[1]/'scripts/ci-reports.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class ReportGate(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name)
  for name in module.SUITES['integration']:(self.root/name).write_text(json.dumps({'status':'passed','sample':'中文'}),encoding='utf-8')
 def tearDown(self):self.temp.cleanup()
 def test_round_trip(self):
  result=module.unpack(module.pack('integration',self.root,'abc','123'),'integration','abc','123');self.assertEqual(result['reports']['ai-settings.json']['sample'],'中文')
 def test_other_commit_rejected(self):
  with self.assertRaises(ValueError):module.unpack(module.pack('integration',self.root,'abc','123'),'integration','def','123')
 def test_other_run_rejected(self):
  with self.assertRaises(ValueError):module.unpack(module.pack('integration',self.root,'abc','123'),'integration','abc','124')
 def test_failure_rejected(self):
  (self.root/'ai-settings.json').write_text('{"errors":["failure"]}')
  with self.assertRaises(ValueError):module.pack('integration',self.root,'abc','123')
 def test_missing_rejected(self):
  (self.root/'ai-settings.json').unlink()
  with self.assertRaises(FileNotFoundError):module.pack('integration',self.root,'abc','123')
 def ui_reports(self):
  for name in module.SUITES['ui']:(self.root/name).write_text(json.dumps({'status':'passed','checks':[{'capability':'fixture','status':'passed'}]}),encoding='utf-8')
 def test_browser_report_required(self):
  self.assertIn('browser-regression-report.json',module.SUITES['ui'])
  self.ui_reports()
  (self.root/'browser-regression-report.json').unlink()
  with self.assertRaises(FileNotFoundError):module.pack('ui',self.root,'abc','123')
 def test_browser_failure_rejected(self):
  self.ui_reports()
  (self.root/'browser-regression-report.json').write_text('{"status":"failed"}')
  with self.assertRaises(ValueError):module.pack('ui',self.root,'abc','123')
 def test_browser_round_trip(self):
  self.ui_reports()
  result=module.unpack(module.pack('ui',self.root,'abc','123'),'ui','abc','123')
  self.assertEqual(result['reports']['browser-regression-report.json']['checks'],[{'capability':'fixture','status':'passed'}])
 def workflow_reports(self):
  for name in module.SUITES['workflow']:(self.root/name).write_text(json.dumps({'status':'passed','checks':[{'name':'fixture'}]}),encoding='utf-8')
 def test_workflow_jpx_report_required(self):
  self.assertIn('pdf-loading-report.json',module.SUITES['workflow'])
  self.workflow_reports()
  (self.root/'pdf-loading-report.json').unlink()
  with self.assertRaises(FileNotFoundError):module.pack('workflow',self.root,'abc','123')
 def test_workflow_jpx_failure_rejected(self):
  self.workflow_reports()
  (self.root/'pdf-loading-report.json').write_text('{"status":"failed"}')
  with self.assertRaises(ValueError):module.pack('workflow',self.root,'abc','123')
 def test_workflow_jpx_round_trip(self):
  self.workflow_reports()
  result=module.unpack(module.pack('workflow',self.root,'abc','123'),'workflow','abc','123')
  self.assertEqual(result['reports']['pdf-loading-report.json']['checks'],[{'name':'fixture'}])
if __name__=='__main__':unittest.main()
