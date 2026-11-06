import importlib.util, pathlib, unittest, xml.etree.ElementTree as ET
spec=importlib.util.spec_from_file_location('ci_mcp',pathlib.Path(__file__).resolve().parents[1]/'scripts/ci-mcp-report.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class CoverageGate(unittest.TestCase):
    def setUp(self):
        self.root=ET.fromstring('<testsuites><testsuite>'+('<testcase/>'*542)+'</testsuite></testsuites>')
        self.coverage={'meta':{'branch_coverage':True},'totals':{'percent_covered':80}}
    def test_complete(self):self.assertEqual(module.assess(self.root,self.coverage)['tests'],542)
    def test_missing(self):
        self.root[0].remove(self.root[0][0])
        with self.assertRaises(AssertionError):module.assess(self.root,self.coverage)
    def test_failure(self):
        ET.SubElement(self.root[0][0],'failure')
        with self.assertRaises(AssertionError):module.assess(self.root,self.coverage)
    def test_coverage(self):
        self.coverage['meta']['branch_coverage']=False
        with self.assertRaises(AssertionError):module.assess(self.root,self.coverage)
        self.coverage['meta']['branch_coverage']=True;self.coverage['totals']['percent_covered']=74.99
        with self.assertRaises(AssertionError):module.assess(self.root,self.coverage)
if __name__=='__main__':unittest.main()
