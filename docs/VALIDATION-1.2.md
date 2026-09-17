# Folio PDF Studio 1.2.0 RC1 验证记录

日期：2026-09-17。当前状态：Linux 本地回归与 Windows 自动验收均完成，交付 1.2.0 RC1 源码和便携包。真实用户环境的人工输入法验收仍未覆盖。

## Linux 本地验证

| 检查 | 结果与范围 |
|---|---|
| JavaScript 单元回归 | 90 项通过，0 失败；含 ZIP 完整性与旧格式、资产共享、恢复多会话与缺失资产、设置、会话令牌、源租约、流式保存、动作来源及取消队列 |
| 原生 PDF / OCR | native-v4、v9、v10、v11、v12 通过；实际 OCR 模型推理、原字体/原字位、内容合成、图片隔离、表格输出、加密与重开 |
| OCR 任务 | 并发页顺序、校对后续跑、取消保留结果 3 项通过 |
| 标准界面回归 | ui-v9、v9-details、v10-all、v10-structure、v11、v12、encrypted-open-p1 全部通过；对应 50 个检查组，页面错误数组为空 |
| 真实文档 | QDII 产品比较、国民经济行业分类、巍山年鉴的指定案例通过；含原字体、栏宽、图像保留、规则作用范围及撤销 |
| 大文件工程 | 200 MiB 有效合成 PDF 打开并导出 ZIP 工程完成；编解码 Worker 的 Blob 返回路径已修复并复测 |
| 撤销压力 | 共享同一份 4 MiB 编辑片段、40 次状态变化：保留 40 步，历史 JSON 合计 940 字节；基线保留 3 步，历史 JSON 25,166,208 字节 |

标准入口为 `npm test`。本轮先执行标准入口，遇到旧文本链测试等待条件与新版固定边界溢出流程不一致后停止；更新测试，确认需要明确接受溢出后，单独重跑该用例并完成所有剩余门禁。未把未完成的整轮运行记作一次完整通过。

文本框默认固定；原有自动扩展测试现明确选择扩展方向。文本链测试保留双框数量、工程往返和原子撤销断言，补充溢出保留流程。未通过删除关键断言来适配新版行为。

## 性能数据与限制

运行环境为 Linux、Python 3.12、无头 Chromium 153.0.8010.0，界面调用真实本地 Python 服务，但桌面文件对话框和部分 IPC 使用测试替身。

200 MiB 样本是包含可达未压缩资源的一页合成 PDF，不代表大量扫描页或复杂矢量文档。单次打开 1,008 ms，ZIP 编码 6,321 ms，编码期间 20 ms 心跳执行 281 次；浏览器进程树采样峰值 RSS 约 2.00 GiB。结果证明该样本可以完成并保持事件循环响应，不能据此宣称所有大文件内存问题解决。

同样样本在 1.1 基线导出期间浏览器进程崩溃，采样峰值约 2.53 GiB。两者没有完成同一条全过程，不能据此计算或承诺内存降幅。

撤销压力测试测量小状态与共享片段复用，打包耗时单次约 2.55 ms（基线约 517 ms）。它不代表连续生成 40 份不同 PDF 片段的成本，资源预算也不是进程内存硬上限。

## Windows 自动验收

[GitHub Actions 第 4 次运行](https://github.com/ionize1080/Folio/actions/runs/35211609385) 已成功完成。测试源码提交为 `233db28ec1fbecf7c052564ef4a1cd3ca5d7f8ba`，位于 `codex/folio-1.2` 分支。

环境：Windows Server 2025 x64（10.0.26100），Python 3.12.10，Chromium 153.0.8010.12，随包 Electron 44.3.0。

- `npm test` 完整执行成功：90 项 JS 测试、原生 PDF/OCR、OCR 任务回归，以及 50 组界面检查。界面报告的页面错误数组均为空。
- `npm run build:win` 和 `npm run test:package` 成功：AMD64 / PE32+，322 个源码文件、3,142 个原生资源文件与构建输入哈希一致。
- 直接启动构建后的 `Folio.exe`：真实 Electron 沙箱/preload/文件打开 IPC、随包 Windows Python 的源句柄检查、原生文字编辑及 PDF 原子保存均通过。
- 实际运行的 EXE 和 app.asar 哈希与下载产物一致。交付封装仅更新本文和补入验收记录，不修改已测试的可执行文件、应用代码或原生资源。
- 复核实际 Electron 窗口与窄窗口截图：两条工具栏、书签侧栏、保存反馈均可见，保存后的修改文字正确显示。

首次运行发现 OCR 测试环境缺少 ONNX Runtime，已补齐测试依赖。同步修复测试入口与 ASAR 校验的 Windows 路径处理，补齐字体许可文件。最终通过的是完整重跑结果，没有以跳过失败用例代替修复。

静态 `package-report.json` 生成于启动测试之前，其中 `windows_launch_tested: false` 保留原始时间顺序；后续 `v12-electron-report.json` 记录实际启动结果，综合结果见 `release-verification.json`。

## 验证边界

- Windows 环境为云端 Windows Server，未声称逐一测试 Windows 10/11 的所有版本、显卡、杀毒软件和文件系统配置。
- 中文输入法已覆盖组合输入事件回归，未进行真实微软拼音/第三方输入法的人工验收；缩放模拟也不能替代所有物理显示器组合。
- 系统字体集合不同；TTC 多字面测试在 Linux 上执行通过，Windows 原生脚本中的该系统字体案例按条件未执行。
- 200 MiB 压力数据来自上述 Linux 合成样本，不是 Windows 大型扫描书的性能保证。

## 复现入口

- `npm ci`，Python 测试依赖见 `tests/requirements.txt`。
- `npm test`：标准本地门禁；`npm run test:documents`：需要对应用户文档的补充案例。
- `FOLIO_CHROMIUM` 可指定现有 Chromium，`FOLIO_PYTHON` 可指定测试 Python。
- `tests/fixture-stress-v12.py` 与 `tests/stress-v12.cjs`：合成大文件案例。
- `npm run build:win` 后运行 `npm run test:package`：构建与静态包核对。
- Windows 上 `node tests/electron-v12.cjs`；设置 `FOLIO_EXE` 可指定打包后的 EXE。本次已对打包后的 EXE 执行通过。

真实用户测试文档不加入源码和测试证据包；原始文件未被修改。
