# Folio AI / Chatbox 1.20.3

点击 Folio 工具栏的 AI 打开固定版本 Chatbox。默认嵌入右侧栏，再次点击 AI 可收起或恢复侧栏；Chatbox 输入栏的窗口图标可切换独立窗口。首选项 → AI 文档辅助也提供显示方式选择。Chatbox 的会话、附件、服务商、API Key、API 地址和模型选择仍使用原生界面；初始提供不含 Key 的 Qwen OpenAI 兼容配置，默认模型 `qwen3.8-flash`，用户可以更换服务商和模型。

## 审批与数据

每次启动默认手动审批。读取页面图像、OCR、书签修改及开源 PDF 文件操作均通过 Folio 审批。审批模式统一在首选项 → AI 文档辅助设置，Chatbox 盾牌图标提供快捷切换。开启自动审批需要连续确认两次；Folio AI 按钮和 Chatbox 审批图标标红。切回手动立即生效，模型工具没有切换审批模式的入口。

文档内容是数据，不能作为指令。AI 文字和图像判断存在错误，尤其是页码对应关系、细小数字及复杂目录；请检查结果。写入当前文档的操作使用版本校验，支持撤销，保存继续遵循 Folio 原件保护。开源 PDF 工具按各自文件参数输出；自动审批时也应明确要求另存副本。

## 按需工具

Chatbox 只常驻四个工具：`folio_help`、`folio_operation`、`pdf_help`、`pdf_operation`。先查询能力目录，再查询某个操作的详细参数。每次 operation 调用必须显式传入 `operation`；查询 help 不会设置下一次操作。

Folio 提供 23 个操作：文档信息/快照，完整书签树分页读取与原子替换，创建、更新、删除/提升子项、移动、复制、排序、批处理、正则生成、正则拆分、留白、目标校准，页面文字/图像/对象、页面编辑，本地 OCR/校对应用，以及撤销/重做。完整书签结构包含 ID、父节点、标题、样式、展开状态、原始动作及全部目标模式和参数。

书签目标示例：`{kind:"dest",page:7,mode:"XYZ",args:[50,700,null]}`。页码从 1 开始，坐标为 PDF 原生坐标，通常原点在左下；非零 CropBox/MediaBox 不应忽略。修改和图像读取需先 `document.describe` 获取最新 revision。模型传错目标格式或漏传页码会报错，不能静默落到第一页。

完整集成 Apache-2.0 的 [pdf-mcp-server](https://github.com/nfsarch33/pdf-mcp-server)，固定提交 `9d66cca073f664a8c97d4984b5d9d61d68d4ba30`，保留全部 57 个上游工具：表单、页面组合/拆分、内容及批注、加密/签名、OCR、文字/表格/图片/链接提取、优化、条码、比较、批处理等。另加 3 个工具，共 60 个：

- `pdf_object_help` / `pdf_object_operation`：29 项底层操作，覆盖原始对象字典、嵌套键、对象创建/替换、流读写、完整 outline、页面标签/框/旋转/链接、附件、XML 元数据和按需页面渲染。写入必须使用新路径。
- `pdf_local_ocr`：按文件、页码使用 Folio 本地 Paddle；先提取单页再识别，支持大文件。

PDF MCP 的远程 LLM 后端、远程时间戳等联网操作被禁用；模型辅助统一交给 Chatbox 当前模型。签名验证是否可信仍取决于证书与验证环境，不能仅以工具执行成功替代判断。

## OCR 与智能分辨率

优先 `ocr.local` 或 `pdf_local_ocr`，使用本地 PP-OCRv6 ONNX 模型；低置信度阈值默认 95%，可在首选项 → AI 文档辅助手动调整，也可逐次传 threshold。原始置信度不因模型校对而伪造升高。`ocr.apply` 保留原始文字与校对标记。

目录候选页使用 classify（最长边约 960 px）；目录细读使用 toc（约 1600 px）；定位与复杂数字核对使用 locate（约 2200 px）。按页原始尺寸最多放大 3 倍，可以发送整页或归一化区域 `[x,y,width,height]`。图像以真实视觉附件发送，避免将 Base64 当成文本。返回的 `imageToPdf=[a,b,c,d,e,f]` 可将图像像素映射为原生 PDF 坐标：`X=a*x+c*y+e; Y=b*x+d*y+f`。

大文件工作区通过 `document.describe` 提供文件路径，使用文件式 PDF MCP 操作；未保存的大文件书签应先保存。不会误操作被大文件工作区遮住的普通文档。

## 本地通信与存储

MCP 使用标准输入/输出；Folio 与桥接进程使用随机名称、随机令牌的 Windows 命名管道。没有 HTTP/SSE MCP 服务、TCP 监听或固定端口。PDF 服务禁止网络连接；Chatbox 保留原生模型通信，服务商 SDK 请求头通过 Node fetch 原样发送，不使用 Electron net 请求头。独立 Chatbox 更新和统计上报关闭，固定组件随 Folio 更新。

磁盘缓存默认上限 **2048 MB（2 GB）**，在 Folio 偏好设置中调整。可轮替的内容缓存、旧 AI 快照按最近使用时间清理；原件句柄、正在处理的快照与原子保存文件被固定保护，单个大文件任务可以临时超过上限，释放后清理回配置值。OCR 缓存轮替保留当前任务与已审阅结果。未保存的恢复草稿、用户文件、聊天记录和随包 OCR 模型不是可随意删除的缓存；受保护数据超限时保留数据并提示保存工程。

API Key 只存入用户自己的 Chatbox 配置。发布包不包含测试 Key、测试用户配置、真实文档、聊天测试记录或页面图像。

## 构建与测试

需要 Windows x64、Node、Python 3.12、Git 和支持 NSIS 的完整 7-Zip。先 `npm ci`、准备 Folio 原生运行时并 `git submodule update --init`。下载并解包官方 Chatbox 1.20.3 Windows 安装包，再执行：

```powershell
python scripts/prepare-ai.py --chatbox <解包目录> --sevenzip <7z.exe路径>
npm run test:quick
node tests/ai-integration.cjs
node tests/pdf-mcp-bridge.cjs
npm run build:win
npm run test:package
```

准备脚本验证官方 app.asar SHA-256、上游源码提交和 Tesseract 安装包 SHA-256，Python 与 MCP SDK 使用锁定依赖。Chatbox 上游源码 ZIP、许可和修改文件哈希随运行包提供；所有适配代码在本仓库 `integrations/chatbox`。

`tests/ai-model-e2e.cjs` / `tests/ai-model-corpus.cjs` 使用真实 API，测试凭证来自本机 `D:\APP\API`，不会内置到应用。仅开发测试显式启用临时调试端口；发行版忽略该开关。`tests/pdf-corpus.cjs` 和 `tests/ai-corpus.cjs` 使用 `FOLIO_PDF_SAMPLES` 指定样本目录（默认 `D:\APP\PDF Samples`），保留原文件。
