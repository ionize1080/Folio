# 0.4 验证说明

本版在 Linux 环境运行测试，并构建 Windows x64 包。Linux 验证环境为 RapidOCR 3.9.2、ONNX Runtime 1.30.0、pypdfium2 5.3.0；Windows 包延用锁定的 pypdfium2 5.13.0，Windows 二进制没有在此环境执行。以下是实际验证的范围，不能等同于 Windows 实机验收。

| 检查 | 覆盖 |
|---|---|
| `npm test` | 25 项：PDF 目标保留、原始动作、坐标／范围校验、子树移动、10,000 书签保存、撤销、规则、文件保存失败保护，以及本版去重／混合样式／40层规则／校准／资源限制 |
| `tests/native-v4.py` | 四页生成的中文扫描页，真实内置 ONNX 模型识别、热模型复用、双层 PDF 搜索、原图像素一致性、原生文字对象编辑 |
| `tests/ocr-jobs-v4.cjs` | 两个工作进程的结果页序、磁盘结果与人工校对续用、取消并结束工作进程 |
| `tests/ui-v4.cjs` | 实际 DOM 与原生服务相连，文档打开、连续缩放、通用规则、目标预览、多选样式、去重保留子项、拖拽退级、选页、OCR 校对和重新校对、重复生成、综合保存 |
| `scripts/verify-package.mjs` | AMD64 PE、产品版本／图标、运行依赖存在性、打包源码逐文件 SHA-256 与 native 内容一致性 |

测试输出以相邻 `v4-*.json` 为准；旧版 v2/v3 报告仅是历史记录。UI 测试调用同一 NativeBridge/OCRJobs，通过本机 HTTP 测试适配器代替 Electron IPC；尚未覆盖 Windows IPC 的实机运行。

复现：

```sh
npm ci --ignore-scripts
npm test
python -m pip install rapidocr==3.9.2 onnxruntime==1.30.0 pypdfium2==5.13.0 PyMuPDF
python tests/native-v4.py
node tests/ocr-jobs-v4.cjs
# 提供 Playwright 与可执行 Chromium 路径，或在测试环境安装它们
FOLIO_PLAYWRIGHT=/path/to/playwright FOLIO_CHROMIUM=/path/to/chromium node tests/ui-v4.cjs
```

Windows 待验收：完整解压启动、长中文路径、同名另存覆盖及文件占用失败、关闭／重启后续做、150%／200% DPI、跨显示器和显卡兼容开关、用户实际 758 页文件的长时间资源表现。
