# Folio 1.2 当前主链路

原始 PDF 在一个文档会话内保持不变。编辑状态描述书签、批注、旋转、OCR 与内容修改；PDF.js 显示独立合成预览。打开工程先完成解包、哈希核对、结构解析和预览准备，随后替换活动文档。保存先合成内容，再核对原始书签动作并写结构，最后以同目录临时文件替换目标。

| 模块 | 当前职责 |
|---|---|
| `src/app.mjs` | 命令协调、活动状态和对话框；尚未完全拆分，后续按实际依赖继续缩减 |
| `src/session-state.mjs` | 文档身份、修订号、过期结果拒绝、首选项逐字段校验 |
| `src/native-source.mjs` / `source-store.cjs` | 源 PDF 注册与只读句柄；工作请求持有租约，关闭会话后等租约结束再删除 |
| `native-bridge.cjs` | 进程内请求串行、取消代次、命令/页码诊断、合成和页面背景缓存 |
| `flow-layout.cjs` / `flow-validation.cjs` | 专用 Story 排版进程与模型验证；产品不加载旧 Chromium 排版器 |
| `main.cjs` / `preload.cjs` | 狭窄 IPC、发送者验证、文件能力票据；内容、背景、字体、排版、qpdf 分开进程 |
| `src/model.mjs` / `src/edit-assets.mjs` | 小状态撤销记录、不可变 OCR 与内容版本引用、资源预算；大型片段不进入历史 JSON |
| `src/project.mjs` / `project-worker.mjs` / `zip-store.mjs` | 工程 v2 的 ZIP STORE、完整性清单和 Worker 编解码；继续读取 v1 JSON 工程 |
| `src/portable-state.mjs` | PDF 碎片与文字几何的内容寻址资产、共享序列化缓存、状态验证 |
| `src/recovery.mjs` | IndexedDB v3，多会话键、源/碎片去重、完整性核对、1 GiB 资源配额、失败保留旧快照 |
| `file-store.cjs` | 文件选择票据、原件保护、分块写入、刷盘后替换；失败保留目标原内容 |
| `temp-store.cjs` | 带进程所有者记录的临时目录；仅清理确认所有者已退出的本产品目录 |
| `src/flow-ui.mjs` | 页上编辑、IME 草稿、连续选段意图、局部/整段排版、拆分合并与人工结构锁定 |
| `native/original_layout.py` | 原字位与局部行布局；支持同原点扩宽，复杂脚本/格式改变交给 Story |
| `native/original_patch.py` | 单对象、单行、等字符数、已有编码且不增宽的局部纠错；原字体资源与原字位保持，TJ 补偿字宽变化 |
| `native/content.py` | 对象签名验证、原内容操作保留、版本化 Form 合成；无法证明安全的修改拒绝或使用片段 |
| `src/pdf-core.mjs` | 书签与动作保真；合成后核对动作语义，来源不一致则停止保存，不默默降级目标 |
| `ocr-jobs.cjs` | 独立 OCR 工作者、逐页结果和校对、显式应用结果；缓存清理保留校对记录与当前引用 |
| `src/viewer.mjs` | 页面和瓦片虚拟化、缓存预算、取消旧渲染、缩放锚点 |

## 资源与兼容边界

工程 v2 内容为 `source.pdf`、`state.json`、`assets/<sha256>.pdf/json` 和 `manifest.json`。ZIP 不再对 PDF 做无效重压缩。源 PDF 上限 768 MiB，工程上限 1 GiB；解析只接受本版本支持的条目和存储方法。v1 可读取，保存为 v2 后旧版不能读取。

源句柄消除了重复检查时的全文件 IPC 与落盘；PDF.js 和结构 Worker 仍各自需要解析数据。工程编解码在 Worker 执行，向桌面保存桥按 2 MiB 分块。历史预算是保留表示的估算值，不是进程 RSS 硬上限；至少保留最近一个操作。

恢复不依赖旧进程的 OCR 引用：实际 OCR 数据持久化，重启后直接重新合成。草稿引用任何资产缺失或校验失败都会停止恢复。配额或写入失败会提示，保留上次完整快照。OCR 的旧输入 PDF 与未被当前引用的 JSONL 按时间回收，目标 1 GiB；已校对页 JSON 不自动删除，当前任务/引用受保护。

嵌入字体局部修改范围有意受限。缺字、复杂脚本、字体/颜色/字号改变、多框排版仍走正常片段布局。普通 PDF 的严格解析没有放宽；能预览不等于能无损结构保存。

## 测试入口

`npm test` 是当前标准回归入口；`npm run test:unit` 用于快速纯 JS 检查。旧测试保留历史文件名，是否进入门禁由 `scripts/test.mjs` 明确列出。真实用户文档另走 `npm run test:documents`，文档不提交到源码仓库。构建后另跑 `npm run test:package`。Windows Electron 启动/IPC 与 Windows 人工输入法验收分别记录，不能用浏览器事件模拟替代真机输入法。
