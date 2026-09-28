# RC1-P7 系统缺陷审计与修复

日期：2026-09-28。基线：main `8a8fdc5` / RC1-P6。P7 为 RC 修复版本。

## 结论和实现边界

本次修复普通嵌套包装 Form 的编辑入口、标题干扰双栏识别、ActualText 旧语义、流资源误合并、紧字框末字等宽纠错及输出特征版本声明。采用有界、按调用实例隔离的**受限包装展开**：仅处理没有结构树关联的普通包装页面，保持 Matrix、BBox 裁剪、q/Q 和独立资源命名。它不是通用容器内编辑，也不声称所有 Form 内文字已可编辑。原输入不变，检查/预览在内存副本上处理，保存才写入目标副本。

透明度组、OC、结构拥有者、外部引用、默认色彩空间覆盖、不能可靠重命名的内联图片、非可逆矩阵、未平衡操作和预算外内容保留原容器。受保护 Form 可递归统计内部文字以提供准确说明。复杂状态原位重排仍有限制。CMYK/叠印印刷保真未作专项验收；本轮像素比较是屏幕 RGB 渲染，不等同于分色打样。

## 缺陷、根因及处理

| 问题 | 根因 | 本次处理/验证 |
|---|---|---|
| 年鉴包装页只有一个只读 Form | 页面级枚举和页级字体资源未进入包装层 | 有界包装展开，逐次 Do 独立资源名；跨页、同页重复引用不直接修改共享定义 |
| 同名 `/F1` 资源混用风险 | 容器资源作用域不能直接合并 | 所有支持的资源操作数同步改名；两种字体故意同名的合成用例双引擎像素一致 |
| 三行通栏标题导致正文跨栏合并 | 页面全局“3 条跨线即可否定栏沟” | 改为正文同时存在的左右行形成局部栏沟证据；保留全宽标题和混合样式连续行 |
| 修改后显示/复制内容不一致 | 原 `/ActualText` 随空原操作保留，原位修补不更新语义 | 单对象内联/命名属性按实例脱离后清理旧 ActualText；新片段保留自己的语义。多个文字或文字/图形共同替代文字保护为只读 |
| 相同流字节被错误视为相同资源 | 去重未计入流字典 | 叶流键包含标量字典；有资源或引用图的流不作内容哈希去重 |
| 末字等宽纠错触发不必要重排 | 紧边界是墨迹框，末字 advance 大于墨迹宽 | 快速预览与原生排版都将原末字 advance 纳入原字位槽宽；同字同字体同尺寸复用已测墨迹，避免 CID 全字体边界造成误报 |
| PDFium 附加空格导致映射不完整 | 不同调用间的几何分隔空格被附在前一个文字对象上 | 与内容流解码一致时恢复实际尾部空格数；真实空格不统一 trim |
| 低版本 PDF 中已存在透明组 | 只沿用原文件声明 | 检查图形资源及 ActualText 的已知最低版本，只提升不足的有效版本 |
| 构建依赖高危路径穿越公告 | 旧 `extract-zip 2.0.1` 带两项符号链接路径公告 | 移除旧包，固定 Electron 已采用的 `@electron-internal/extract-zip 1.0.5`；仅处理校验过官方 SHA256 的 Electron ZIP，完整构建验证；npm audit 门禁 |
| 复合对象提示含糊 | 图片与嵌套文字都显示同一个只读原因 | 有深度、实例和循环预算的递归文字统计；扫描页提示 OCR，复合文字提示容器限制 |

## 验证范围

- 130 项 JavaScript 单元测试：原 127 项及新增标题/栏沟、紧末字槽专项。
- P7 原生专项 11 类：同页/跨页复用、同名字体、矩阵/CropBox/四方向、透明/标签/OC 保护、内联/命名 ActualText、多对象语义保护、流字典、特征版本、循环预算、部分裁剪。
- P6 原生专项、旧版本原生/界面、OCR 队列、加密打开、大文件书签、自动书签、表格及打包检查纳入 Windows 工作流。
- Windows 同一提交构建后，在实际 `Folio.exe` 中运行 P7 共享对象点击编辑、撤销、保存重开，以及 P4/P5/P6/V12 既有程序回归；十份公开 PDF、50 页继续执行。Release 发布作业依赖这些检查全部成功，并核对每份 EXE/app.asar 哈希。
- 用户提供的 20 页年鉴只在 Linux 进行双引擎与真实 worker 检查，不将这项测试写成 Windows 原件验收。完整原件及真实中文 IME/混合 DPI 未验收。

20 页样本共恢复 1,787 个可编辑文字对象，另有 11 个留在复杂容器内；四个替换用例均按原字位保存。第 12 页紧框换字仍产生保守溢出提示，测试显式保留溢出后完成写回；不将它记录为无提示编辑。短文本、408 字符长文本和整段删除另外通过共享 Form 合成用例。私有样本的数值报告见 `p7-yearbook-validation.json`。不将输入 PDF 或全文写入仓库。测试命令：`python tests/yearbook-p7.py <sample.pdf>`。

## 已知问题清单的剩余项

| 类别 | 当前状态/下一步 |
|---|---|
| 通用嵌套 Form 写回 | 仍需调用实例树、祖先路径 copy-on-write 和复杂状态逐项支持；P7 仅提供受限包装路径 |
| 自有段落稳定 ID、软折行/硬换行 | ActualText 单对象问题已修；P6 记录的所有段落拆分和复杂空白差异未全部关闭 |
| OCR 第 19 页等漏字、跨格 | 复核固定 RapidOCR 源码：分类器深拷贝图像，当前反方向重试没有重复旋转缺陷；现有疑点/候选/人工确认继续回归。没有证据证明所有漏检已解决 |
| OCR 局部补识别状态合并 | 尚未实现通用版本化合并，保留后续计划 |
| 竖排、RTL、Type3、复杂整形 | 年鉴含 Identity-V；包装后可读取不等于所有竖排编辑已验收 |
| 大文件 | 沿用 P6 文件通道；没有把包装兼容或门槛提高当作 0.75–4 GiB 全书编辑验收 |
| 冷启动/内存、工作区/模态 | 本次没有宣称普遍提速或架构重构完成；保留后续性能及人工测试 |

## 方法依据

以下来自官方规范、SDK 和开源项目；没有声称取得商业编辑器内部算法，也没有在 Acrobat/PDF-XChange 桌面端实测本样本。

1. [ISO 32000-1:2008](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf)：§7.8.3 资源、§8.10 Form Matrix/BBox/调用语义、§11.6.6 透明组、§14.9.4 替代文字。
2. [Adobe PDEForm SDK](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdflsdk/apireference/PDFEdit_Layer/PDEForm.html)：容器内容与克隆接口，支持区分共享定义和实例的设计。
3. [PDFium fpdf_edit.h](https://pdfium.googlesource.com/pdfium/+/main/public/fpdf_edit.h)：Form 枚举以及子对象矩阵相对所属 Form。实际运行依赖固定为 pypdfium2 5.13.0。
4. [MuPDF pdf-clean.c](https://github.com/ArtifexSoftware/mupdf/blob/master/source/pdf/pdf-clean.c)：实例复制、资源处理、循环检测，以及新页内容流避免共享内容副作用。实际依赖固定为 PyMuPDF 1.26.6。
5. [PDF-XChange 对 XForm 的公开说明](https://forum.pdf-xchange.com/viewtopic.php?p=141454)：参见上一轮研究中的厂商案例；本轮工程实现不依赖其闭源算法。
6. [PDF Association 规范档案](https://pdfa.org/resource/pdf-specification-archive/)：规范版本与特征的依据。源代码 main/master 链接为审阅参考；运行依赖以 requirements/package-lock 为准。

构建依赖依据：[GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv)、[GHSA-7pqw-9j4j-h8q3](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3)、[Electron 提取器](https://github.com/electron/extract-zip)。提取器 API 为 Electron 内部用途，因此固定精确版本，仅用于官方 Electron 运行时；未来升级需再次检查 API。2026-09-28 的 npm audit 全依赖结果为 0 项公告，不等同于完整产品安全审计。
