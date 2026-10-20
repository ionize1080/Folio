"""Publish aggregate benchmark evidence without sample PDFs or extracted prose."""
from pathlib import Path
import argparse,json,statistics,math
from collections import Counter
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--baseline',default='baseline-original');p.add_argument('--final',default='final');args=p.parse_args()
OUT=ROOT/'tests/output/deep-edit-v191'
base=json.loads((OUT/args.baseline/'report.json').read_text(encoding='utf8'));final=json.loads((OUT/args.final/'report.json').read_text(encoding='utf8'))
baseline_original_counts=dict(base['operationSummary']);baseline_phonetic_adjustments=[]
phonetic_path=OUT/args.baseline/'phonetic-audit.json'
if phonetic_path.exists():
 for case in json.loads(phonetic_path.read_text(encoding='utf8'))['cases']:
  if not case['lostAssociations']:continue
  page=next(p for p in base['pages']if p['id']==case['id']);attempt=next(a for a in page['attempts']if a['operation']==case['operation'])
  if attempt['status']=='passed':attempt['status']='failed';attempt['reason']='phonetic-attachment';baseline_phonetic_adjustments.append(dict(id=case['id'],operation=case['operation'],lostAssociations=case['lostAssociations']))
 for page in base['pages']:
  page['operationSummary']=dict(Counter(a['status']for a in page['attempts']));c=page['operationSummary'];page['status']='failed'if c.get('failed')else'passed'if c.get('passed')==6 else'partial'if c.get('passed')else'blocked'
 base['operationSummary']=dict(Counter(a['status']for p in base['pages']for a in p['attempts']));base['pageSummary']=dict(Counter(p['status']for p in base['pages']))
assert all(p.get('completeOriginalDocument') for report in (base,final) for p in report['pages']),'Only complete-original-PDF runs are publishable'
assert base['codeUnchanged'] and final['codeUnchanged'],'A run changed code while executing'
def dist(values):
 values=sorted(values)
 return dict(n=len(values),medianMs=round(statistics.median(values),2) if values else None,p95Ms=round(values[min(len(values)-1,math.ceil(len(values)*.95)-1)],2) if values else None,maxMs=round(max(values),2) if values else None)
def summary(r):
 attempts=[a for p in r['pages'] for a in p['attempts']];passed=[a for a in attempts if a['status']=='passed'];batches=[b for p in r['pages'] for b in p.get('batches',[]) if 'verification' in b]
 fonts=[a['fontAudit'] for a in passed if 'fontAudit' in a];prefix=[a['unchangedPrefixPositions'] for a in passed if a.get('unchangedPrefixPositions',{}).get('comparedGlyphs')]
 return dict(operations=r['operationSummary'],pages=r['pageSummary'],blockingReasons=r['blockingReasons'],
  timing=dict(inspect=dist([p['inspectMs'] for p in r['pages']]),paragraphModel=dist([p['paragraphModelMs'] for p in r['pages']]),layout=dist([a['totalLayoutMs'] for a in attempts if 'totalLayoutMs'in a]),save=dist([b['saveMs']for b in batches]),reopen=dist([b['verification']['reopenMs']for b in batches])),
  fontAudit=dict(checkedCharacters=sum(x['checkedCharacters'] for x in fonts),unavailableCharacters=sum(x['unavailableCharacters'] for x in fonts),outlineDifferences=sum(x['outlineDifferences'] for x in fonts),sizeDifferences=sum(x['sizeDifferences'] for x in fonts)),phoneticAudit=dict(annotationsChecked=sum(a.get('phoneticAudit',{}).get('annotationsChecked',0)for a in passed),lostAssociations=sum(a.get('phoneticAudit',{}).get('lostAssociations',0)for a in passed)),
  layoutModes=dict(Counter(a.get('layoutMode','unknown')for a in passed)),fallbackCharacters=sum(a.get('fallbackCount') or 0 for a in passed),frameGrowthOperations=sum('frameGrowth'in a for a in passed),
  unchangedPrefix=dict(comparedGlyphs=sum(x['comparedGlyphs']for x in prefix),within01Point=sum(x['within01Point']for x in prefix),maxDriftPoints=max((x['maxDriftPoints']for x in prefix),default=None)),
  outsideChangedPixels=sum(b['verification'][e+'Pixels']['outsideChangedPixels']for b in batches for e in ('MuPDF','PDFium')),
  adjacentPageDifferences=sum(not b['verification'][e+'AdjacentPageIdentical']for b in batches for e in ('MuPDF','PDFium')),
  resegmentedTargets=sum(p.get('resegmentedTargets',0)for p in r['pages']))
bs,fs=summary(base),summary(final)
loaded_sources={'src/flow-page-model.mjs','src/flow-model.mjs','src/flow-style.mjs','src/flow-regions.mjs','src/ruby-anchors.mjs','tests/structure_checks_v191.py','tests/annotation_checks_v191.py'}
published_hashes={k:v for k,v in final['codeHashes'].items() if k.replace('\\','/').startswith('native/') or k.replace('\\','/')in loaded_sources}
public=dict(date='2026-10-20',baselineLabel=args.baseline,finalLabel=args.final,engines=final.get('engines'),baselineOriginalCounts=baseline_original_counts,baselineRetrospectivePhoneticAdjustments=baseline_phonetic_adjustments,baseline=bs,final=fs,finalCodeHashes=published_hashes,pages=[])
for after in final['pages']:
 before=next(p for p in base['pages']if p['id']==after['id'])
 public['pages'].append(dict(id=after['id'],sample=after['sample'],physicalPage=after['page'],baseline=before['operationSummary'],final=after['operationSummary'],baselineParagraphs=before['paragraphs'],finalParagraphs=after['paragraphs'],resegmentedTargets=after['resegmentedTargets'],
  operations=[dict(operation=a['operation'],status=a['status'],reason=a.get('reason'),insertedCharacters=a.get('change',{}).get('insertedCharacters'),deletedCharacters=a.get('change',{}).get('deletedCharacters'),sourceCharacters=a.get('sourceCharacters'),frameGrowth=a.get('frameGrowth'),fontAudit={k:v for k,v in a.get('fontAudit',{}).items()if k not in ('examples','sizeExamples')})for a in after['attempts']]))
public['wholeDocuments']=[{k:v for k,v in x.items()if k not in ('verification','fontAudit')}for x in final.get('wholeDocuments',[])]
dest=ROOT/'docs';dest.mkdir(exist_ok=True);(dest/'deep-edit-2026-10-20.json').write_text(json.dumps(public,ensure_ascii=False,indent=2),encoding='utf8')
def counts(d):return '/'.join(str(d.get(k,0))for k in ('passed','blocked','failed'))
reason_names={'neighbour-conflict':'邻近正文/图像/复合对象冲突','layout-overflow':'内容超出可用框','font-unavailable':'原字体无法恢复','save-tagged-boundary':'标签结构范围限制','target-merged-with-previous-edit':'修复分段后目标与同批另一项合并','original-target-no-longer-editable':'原目标无法恢复为可编辑候选','layout-mapping':'字位映射不完整','typography':'排版参数不支持','glyph-mapping':'字位保护'}
lines=['# 深度编辑实测（2026-10-20）','',f'直接使用两个完整原始 PDF，覆盖 20 个物理页、120 项预先固定位置的编辑。修复前通过/阻止/失败为 **{counts(bs["operations"])}**，修复后为 **{counts(fs["operations"])}**。阻止和失败均不计成功。','',
f'旧代码原始自动计数为 {counts(baseline_original_counts)}；对已保存结果增加独立注音锚点审计后，另发现 {len(baseline_phonetic_adjustments)} 项注音错位/删基字后注音残留，已纳入上面的严格失败数。完整原始结果与追加审计均保留，不用后续发现放宽原判据。','',
'样本为《义务教育教科书·语文五年级下册》（131 页）与《十五五规划投资全景·跨市场五年配置策略》（13 页）。原文件只读；原件、测试副本、提取文字与截图仅留在忽略版本控制的本地测试目录，未随报告发布。','',
'## 方法与边界','',
'每页先选择从上至下分散的四个段落位置，执行 2 字插入、32–72 字插入、2 字删除和 12–60 字删除，再对较长正文增加长插、长删两项。插入从目标段落已有文字选取，以隔离原字形保持与新增缺字问题。四项分散编辑及两项正文编辑分成两批，尽量合并保存；批量保存被拒时逐项隔离重试。每次均重新读取完整原始文件，从未用提页后丢失标签树的 PDF 充当主测试输入。','',
f'分段修复后有 {fs["resegmentedTargets"]} 个目标的源对象集合重新归组；重放保持原页和位置，依据新的完整段落重新计算插删位置及长度，因此这部分不是逐字相同的 A/B 测试。与同批目标合并的项目单列为阻止，没有默认为成功。','',
'保存后由 MuPDF 和 PDFium 分别检查完整页非空白字符数量、修改段落的精确字符序列、每个原/新字形包围框之外的像素以及真实相邻页像素，再通过 Folio 重新建立精确段落和软换行。字体另外按每个非空白字符比较缓存字体中去复合后的轮廓与字号；字体名称相似不算轮廓一致。合法写入字距的字体 advance 不作原值相等要求。标签文件还比较完整结构树、ParentTree、各页 StructParents 与 MCID 身份和计数。','',
'另独立检查已知 Hanyu/Pinyin 字体注音与所依附汉字的相对位置；删除基字而留下注音也判失败。普通小字脚注及加点字形不泛化为注音，依靠原有碰撞保护和逐页视觉审查。配置策略原件的跨行 C-REIT 连字符已被 PDFium 标为 U+FFFE；各引擎以自身原文为期望，只有实际选中源字位的既有标记按对应字形还原后参与编辑差分，不把原有提取差异当成编辑新损坏，也不全局忽略未知字符。','',
'时间为同一 Windows 主机的原生工作进程/模型调用实测；包含热磁盘字体缓存，不等于全新系统冷启动，也不包含人手点击、输入耗时。此处不据此推断 Acrobat 或 PDF-XChange 的速度。','',
'## 逐页结果','',
'单元格依次为「通过 / 阻止 / 失败」，页码为物理页。','',
'| 样本 | 页 | 修复前 | 修复后 | 段落数（前→后） |','|---|---:|---:|---:|---:|']
for row in public['pages']:lines.append(f'| {"语文教材"if row["id"].startswith("textbook")else"配置策略"} | {row["physicalPage"]} | {counts(row["baseline"])} | {counts(row["final"])} | {row["baselineParagraphs"]} → {row["finalParagraphs"]} |')
lines+=['','## 保持性与耗时','',f'修复后通过项目检查了 **{fs["fontAudit"]["checkedCharacters"]} 个字符轮廓**；轮廓差异 {fs["fontAudit"]["outlineDifferences"]}、字号差异 {fs["fontAudit"]["sizeDifferences"]}、资源无法核验 {fs["fontAudit"]["unavailableCharacters"]}。通过项目发生显式框扩展 {fs["frameGrowthOperations"]} 次；实际字体回退字符数为 {fs["fallbackCharacters"]}。注音审计覆盖通过项中的 {fs["phoneticAudit"]["annotationsChecked"]} 个注音，失去基字对应 {fs["phoneticAudit"]["lostAssociations"]} 个。','',
f'所有保存并完成校验的批次，两个渲染器在未编辑区域的变化像素总数为 {fs["outsideChangedPixels"]}；真实相邻页像素不一致检查数为 {fs["adjacentPageDifferences"]}。修改段落内未改前缀比较 {fs["unchangedPrefix"]["comparedGlyphs"]} 个字形原点，其中 {fs["unchangedPrefix"]["within01Point"]} 个漂移不超过 0.1 pt，最大漂移 {fs["unchangedPrefix"]["maxDriftPoints"]} pt。此指标不把段落内部合法重排伪称为绝对原位。','',
'| 阶段 | 修复前中位数 / P95（ms） | 修复后中位数 / P95（ms） |','|---|---:|---:|']
for key,title in [('inspect','对象/字体读取'),('paragraphModel','段落归组'),('layout','排版（含扩框尝试）'),('save','完整文件保存（成功批次）'),('reopen','重开与段落重建')]:
 b=bs['timing'][key];f=fs['timing'][key];lines.append(f'| {title} | {b["medianMs"]} / {b["p95Ms"]} | {f["medianMs"]} / {f["p95Ms"]} |')
lines+=['','排版路径（只统计通过项目）：'+ '；'.join(f'{k} {v} 项'for k,v in fs['layoutModes'].items())+'。','',
'## 剩余阻止与完整文件复验','']
for k,v in fs['blockingReasons'].items():lines.append(f'- {reason_names.get(k,k)}：{v} 项。')
lines+=['','以上阻止是真实未完成编辑，不能宣传为已支持。长插入需要的行数超过现有空白、表格固定高度、注音/装饰对象重叠等情形仍需进一步设计。','']
for x in public['wholeDocuments']:
 lines.append(f'- {x["sample"]}：{x.get("status")}；物理页 {x.get("page")}，整本 {x.get("pages")} 页，检查 {x.get("untouchedPagesChecked")} 个未改页，变化页 {x.get("changedUntouchedPages")}。读取 {x.get("inspectMs")} ms，排版 {x.get("layoutMs")} ms，保存 {x.get("saveMs")} ms，重开读取 {x.get("reopenInspectMs")} ms。')
lines+=['','完整机器可读汇总见 [deep-edit-2026-10-20.json](deep-edit-2026-10-20.json)。复现入口为 `tests/deep-edit-v191.py`；本地详细报告位于 `tests/output/deep-edit-v191/`。字体缺字专项、额外样本、真实界面输入与竞品对比另列，不能与这里的 120 项混成一个分母。','']
(dest/'DEEP-EDIT-2026-10-20.zh-Hans.md').write_text('\n'.join(lines),encoding='utf8')
print(json.dumps(dict(baseline=bs['operations'],final=fs['operations'],report='docs/DEEP-EDIT-2026-10-20.zh-Hans.md'),ensure_ascii=False))
