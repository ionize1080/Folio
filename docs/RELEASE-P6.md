## 编辑修复
- 新增默认非阻断的边界、重叠和页外内容通知；继续输入、选择、撤销和保存，详情按需展开，完成编辑后保留查看入口。编辑时页外文字和光标可见，导出仍保持原纸张大小。
- 使用字体原始分数字宽，局部修改优先保留其他行字位；修复代码片段顺序、表格跨格对象误归属和过小单元格无入口。
- 恢复 MingLiU、缺 name/空 OS2、Type1、raw CID CFF 等嵌入字体；保留真实粗斜体标识，修复零宽重音、emoji 和连字符语义；修复 CID 导出实际字形与 fi/fl 原连字叠印，增加双引擎墨迹检查。
- 字体推荐改为有界单字形缓存并过滤过期响应；实际目录检查确认返回有效候选。
- 修改页单独预览，保存时完整合成；修复深层对象递归失败和非零 CropBox 坐标，保留原页面框和旋转。

## 验证
127 项 JavaScript 单元测试、P6 原生 13 项专项和完整旧版本原生/界面回归通过。
Windows 上检查 10 份公开文档的 50 个抽样页，并在打包后的 Folio.exe 中加载全部可解析字体；实际验证页外持续编辑与保存、非阻断通知、CropBox、中英文年报和 SDK 修改保存重开。
本地另完成 13 份文档 65 页界面复验，累计含复测 2111 个操作检查点；65 页保存重开，260 个未修改页面像素一致。最终样本中 43/65 没有超过 1 pt 的未改字符字位移动，其余存在局部或段落重排。58/65 页重开后完整目标仍在单个编辑块内，7 页仍发生段落拆分；保留词间空白的完整目标检查为 51/65，保留换行的逐字检查为 48/65；5 个复杂混排用例保留草稿并提示能力限制。
5 份完整原件（194 至 2696 页）新增文本框写回通过；这不是全书逐页编辑测试。
Windows 验收：https://github.com/ionize1080/Folio/actions/runs/35818217755
源码审计与限制：https://github.com/ionize1080/Folio/blob/0b1cfa0cfb685f8d8bbd5ee04b0042574a85a8d5/docs/RC1-P6-editor-audit.md

## 下载与边界
完整解压 portable-win-x64.zip，运行 Folio.exe；无需额外安装 Python、Node 或 OCR 模型。
source.zip 包含源码与离线资源，validation.json 和 SHA256.txt 用于核验。
本版本名称仍为 RC1-P6，保留 RC 阶段的能力与验收边界。任意扩写不能保证所有原字位不变；旋转文本的复杂字形、复杂字符合成粗斜体、Type3、部分特殊编码/阅读方向及非 1 UserUnit 仍有限制。几何提示非阻断，内容归属或字位完整性校验继续生效并保留草稿。

## 2026-09-23 主线与下载入口同步

- P6 功能代码已在 main；本次合入发布流程，更新 README、架构、验证范围、后续计划和发布记录。
- 此 Release 设为 Latest。GitHub 的 Pre-release 标记为此取消，但不表示已解决所有已知限制。
- 原 portable、完整 source、validation 和 SHA256 四个附件及标签保持不变，仍对应 Windows 已验证提交 `0b1cfa0cfb685f8d8bbd5ee04b0042574a85a8d5`。本次不重建程序。
- 最新文档另附 `Folio-PDF-Studio-1.2.0-RC1-P6-docs-20260923.zip`；同名前缀 JSON 记录文档提交、程序提交与文档包 SHA-256。
- 原 Latest P1 与更新前 P6 的附件、正文及元数据均独立备份；原始 Release 和分支继续保留。

[当前 README](https://github.com/ionize1080/Folio#readme) · [当前验证](https://github.com/ionize1080/Folio/blob/main/docs/VALIDATION.md) · [后续计划](https://github.com/ionize1080/Folio/blob/main/docs/NEXT-RELEASE-PLAN.md) · [备份与回退记录](https://github.com/ionize1080/Folio/blob/main/docs/RELEASE-SYNC-2026-09-23.md)

独立备份：[原 Latest P1](https://github.com/ionize1080/Folio/releases/tag/backup-v1.2.0-rc1-p1-20260923) · [更新前 P6](https://github.com/ionize1080/Folio/releases/tag/backup-v1.2.0-rc1-p6-20260923)
