# Folio PDF Studio 1.2.0 RC1

Windows x64 离线 PDF 工作台。完整解压 portable ZIP 后运行 `Folio.exe`，无需另装 Python 或 OCR 模型；保留 resources、locales 和 DLL。

[1.2 更新](docs/CHANGELOG-1.2.md) · [当前架构](docs/ARCHITECTURE.md) · [验证记录](docs/VALIDATION-1.2.md) · [第三方许可](THIRD-PARTY-NOTICES.md)

Ctrl+S 保存 PDF，页面编辑 Ctrl+Enter 完成本段。完成编辑后仍需保存文件。`.folio` 保存原文、内容片段和结构状态，适合续编；1.2 读取旧工程，写入新的 ZIP 工程格式。旧版无法读取新工程。

## 开发与验证

源码 ZIP 附带业务源码、字体、模型与 Windows Python 运行资源。Git 仓库与完整源码 ZIP 的资产范围不同：Git 默认不含 OCR 模型；使用 `scripts/restore-assets.py` 按清单恢复，模型下载失败会明确停止。便携包始终包含运行资产。

```sh
npm ci
npx playwright install chromium
npm test
npm run test:package
```

原生测试需要 Python 3.12 及 `tests/requirements.txt`；用 `FOLIO_PYTHON` 指定解释器，`FOLIO_CHROMIUM` 指定测试浏览器。纯 JS 快速测试为 `npm run test:unit`。真实 PDF 专项测试为 `npm run test:documents`，通过 `FOLIO_FIXTURES` 指定测试文档目录；这些用户文档不随源码或仓库分发。

Windows 包构建：`npm run build:win`。离线复用便携基线时设置 `FOLIO_RUNTIME_BASE`（已解压目录）和 `FOLIO_RUNTIME_BASE_ZIP`（对应 ZIP）；脚本验证运行时并重新装入业务源码和引擎。`npm run test:package` 校验 PE 信息、程序内容及随包资源。

根目录 LICENSE 适用于 Folio 自有代码。第三方引擎、模型、字体、运行时分别遵守随附许可；package.json 的组合 SPDX 表达式不替代逐组件许可文件，也不表示第三方代码转为 MIT。
