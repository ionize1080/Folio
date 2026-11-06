"""Require merged line-and-branch coverage and complete distributed pytest results."""
import json, xml.etree.ElementTree as ET
from pathlib import Path
def assess(root,coverage):
    cases=root.findall('.//testcase')
    assert len(cases)==542, 'Pinned upstream test collection must contain all 542 cases'
    assert not root.findall('.//failure') and not root.findall('.//error'), 'MCP regression failed'
    assert coverage['meta']['branch_coverage'], 'Branch coverage was not collected'
    assert coverage['totals']['percent_covered']>=75, 'Merged upstream coverage below 75%'
    return {'status':'passed','tests':len(cases),'skipped':len(root.findall('.//skipped')),'coverage':coverage['totals']['percent_covered'],'workers':2,'branchCoverage':True}
if __name__=='__main__':
    out=Path('tests/output')
    coverage=json.loads((out/'mcp-coverage.json').read_text(encoding='utf-8'))
    report=assess(ET.parse(out/'mcp-junit.xml').getroot(),coverage)
    (out/'mcp-regression-report.json').write_text(json.dumps(report),encoding='utf-8')
    print(json.dumps(report))
