# 0.7 页面编辑架构

输入层：主阅读区中的透明本地 textarea 仅接收 IME/键盘/剪贴板；可见文字、选区和光标由矢量页面与精确坐标绘制，不由 textarea 的排版驱动。

结构层：PDFium 对象检查 → 页面空间字号归一化 → 本地 AI 区域约束 → 几何段落聚合 → 共享 BT 来源闭包。原文一直来自 PDF 文本对象，AI 不负责转写原生文字。

排版层：独立 JSON-lines 进程运行 MuPDF Story，按同页 1–3 个 frame 顺序 place/draw。PDF 片段、SVG 字形、UTF-16 命中映射和空段落锚点来自同一个实际 PDF 页面。精确行边界重新 place，避免末行被片段裁剪。

写回层：既有 pypdf 内容流映射与签名验证移除完整原文字组，将排版片段作为 Form 嵌入。未选择内容保持原操作符。背景预览也先真正移除来源文字再转为 SVG，而非绘制白色遮盖。

状态层：45 ms 输入合并、版本号过滤、中文组合输入期间暂停排版；保存与切换段落首先完成当前草稿。应用模型与 PDF 片段一起存入既有 nativeEdits，接入文档撤销/恢复工程。

模块：src/flow-ui.mjs（页面交互）；src/flow-page-model.mjs（候选与命中）；src/flow-model.mjs（几何聚合）；flow-layout.cjs（专用常驻服务）；native/story.py（排版与 AI）；native/content.py（安全替换）；native/worker.py（请求路由）；src/viewer.mjs（页面承载）。

自动化通过 tests/offline-run.py 的 seccomp 规则禁止新建 IPv4 / IPv6 sockets。浏览器测试通过请求本地履行和管道调用引擎，不监听 HTTP 端口。该 Linux QA 规则不被打入 Windows 运行服务；产品侧模型路径固定，ONNX 遥测显式禁用。
