# 0.7 验证记录

- Node：38 项核心回归通过，含新加的 0.05 文字矩阵、共享空白来源、字形命中及正文/表格线冲突。
- 原生：MuPDF Story + PDFium/pypdf 实际写回，验证中英文与数字、T-1、两栏续排、删除补齐、空段落光标、溢出/非法输入拦截、真正移除原文、彩色背景保留、来源签名和共享文字组检查。
- AI：随包 PicoDet CDLA ONNX 在禁网进程中实际推理；一次合成页检测约 163 ms。示例文本流排版约 69 ms。这些是当前 Linux 测试样本的耗时，不是性能承诺。
- UI：三个用户文档均验证主页面进入编辑、输入与撤销重做、缩放后输入存续、输入法事件生命周期、提交、文档撤销重做与再次进入已应用文本流。页面无 JavaScript 异常。
- 三份原件分别为 54 页、73 页和 17 页。修改其第 2 页的一个代表段落后，金额 00123.45 与百分比 3.50% 可搜索；第 1、3、末页整页像素以及第 2 页页脚像素与原件相同。
- 所有 UI/AI 回归在操作系统禁止创建互联网 sockets 的条件下运行。用户 PDF 未放入发行源码或运行包。

这不是逐页逐对象验收。还没有验证 Windows 原生输入法候选窗、显卡驱动、混合 DPI、Windows 文件对话框和覆盖保存。本次未验证任意原字体/混合格式保真、跨页流式文章、扫描图像原位改字、公式 AST 或表格语义编辑；这些功能也未宣称实现。

运行入口：npm test；python tests/native-v7.py；tests/ui-v7.cjs（设置 FOLIO_CHROMIUM、FOLIO_TEST_FILES、FOLIO_PYTHON）；python tests/verify-user-v7.py <测试文档目录>。Linux 禁网运行用 python tests/offline-run.py <命令>。报告位于 docs/validation-v7。
