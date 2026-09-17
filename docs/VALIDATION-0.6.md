# 0.6.0 验证记录

## 环境与证据范围

测试在 Linux 执行。Node 24.19；PDFium via pypdfium2 5.3.0、pypdf 6.10.0；PyMuPDF 仅作独立渲染与像素对照，不分发。RapidOCR 3.9.2 / ONNX Runtime 1.30.0。Windows 运行包使用锁定的 Windows wheels，不能以 Linux 结果替代 Windows 实机结果。

浏览器流程使用官方 Chrome Headless Shell 131.0.6778.204；当前 PDF.js 需要的少量标准 API 由测试 harness 补齐。生产包 Electron 44.3.0 使用自身 Chromium，未加入测试 shim。FlowLayout 生产控制器通过 BrowserWindow 适配器执行真实 HTML 排版及 PDF 打印。直接运行 Linux Electron 的无显示环境失败，因此未把它记为通过；没有 Windows 实机启动测试。

## 已通过

| 测试 | 结果与边界 |
|---|---|
| `npm test` | 34/34，含多级规则、书签动作引用、内容复用、文本流输入与段落候选 |
| `tests/native-v5.py` | 7 项；同页间距、原文删除、添加多个文本块、旋转、缺字阻止、300 页 OCR 写回；像素与搜索校验 |
| `tests/native-v6.py` | 4 项；整个共享文字组替换、局部错误选择阻止、旧来源拒绝、二次续编无残留 |
| `tests/industry-v6.mjs` | 实际行业样本 11–117 页，3,977 行、1,845 个书签，约 827 ms；第 11 页 14 个代码均有名称 |
| `tests/flow-browser.cjs` | 中英文同页两栏 PDF、溢出阻止；使用本地文件载入大字体，避免超长 data URL |
| `tests/flow-service-v6.cjs` | 生产排版控制器：首次约 718 ms、热排版约 12 ms，一次窗口载入，两次打印；缺字和溢出阻止；私有临时目录清理 |
| `tests/ui-v6.cjs` | 8 项真实 UI 流程：预览、阻止溢出、原生写回、保存不重放、撤销、续编、工程恢复、右侧 OCR 结果定位左侧 |
| `tests/reader-v6.cjs` | 5 项：高 DPI 像素预算、附近页面缓存、400% 分块复用、右键复制、真实规则窗口完整名称 |
| `tests/save-v6.mjs` | 300 页已应用内容保存约 3,167 ms；只改书签再保存约 2,034 ms；不再调用原生构建；最新书签、旋转与每页 OCR 检查 |
| `tests/isolated-v5.1.py` | Python -I、无关工作目录：真实 OCR 4 条、inspect、apply；注入 memory 模块缺失后仍返回识别结果，rss 降级为 0 |
| `scripts/verify-package.mjs` | Windows AMD64 PE、0.6.0.0 资源版本、app.asar 与源码散列一致、原生运行时与模型逐文件一致；以 package-report.json 为准 |

300 页写入测试使用合成页和 2,400 条指定 OCR 文本，验证写回，不是 300 页真实图像识别速度测试。真实模型识别由隔离环境测试覆盖。缓存保存耗时不包含前面的 133.8 秒首次应用。大文档仍需完整文档内存；本次原生应用峰值约 1,301 MiB。

测试 JSON 存放在 `docs/validation-v6/`，用户样本与大型中间 PDF 不包含在源码包中。旧版报告保留为历史，不代表 0.6.0 全部重跑。

## 复现

先安装 README 中开发依赖。浏览器测试需要 Playwright 与可运行的 Chromium，设置 `FOLIO_BROWSER`；`CODEX_PRIMARY_RUNTIME_NODE_MODULES` 指向包含 Playwright 的目录。UI 测试可设置 `FOLIO_PYTHON` 指向装有原生依赖的 Python。

```bash
npm test
python3 tests/native-v5.py
FOLIO_BROWSER=/path/to/chromium node tests/flow-browser.cjs
python3 tests/native-v6.py
FOLIO_BROWSER=/path/to/chromium node tests/flow-service-v6.cjs
FOLIO_BROWSER=/path/to/chromium node tests/ui-v6.cjs
FOLIO_BROWSER=/path/to/chromium FOLIO_SAMPLE=/path/to/industry.pdf node tests/reader-v6.cjs
node tests/industry-v6.mjs /path/to/industry.pdf
node tests/save-v6.mjs
python3 tests/native-v4.py
FOLIO_PYTHON=/path/to/venv/bin/python python3 tests/isolated-v5.1.py
npm run build:win
node scripts/verify-package.mjs
```

`-I` 不读取用户 site-packages；OCR 隔离测试应使用已安装依赖的虚拟环境。`native-v6.py` 依赖 `flow-browser.cjs` 输出；UI 测试依赖流式样本；保存测试依赖 300 页原生测试输出。

## 待 Windows 实机验收

首次解压与启动；实际 OCR 长任务、停止与续跑；文件占用/权限错误；原生保存对话框与安全替换；混合 DPI、硬件加速与高倍滚动；应用关闭无残留进程；跨栏复杂字形与字体效果。未验证项不得写作“已通过”。
