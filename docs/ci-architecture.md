# Folio 并行验收与发布

本流程只服务于 Folio 的构建、测试与发布。采用 GitHub 标准托管运行器，不使用大型付费运行器、不改变缓存付费上限，也不使用多账号、多仓库或循环触发规避额度。

此架构已在 [v2.3.0 正式发布运行](https://github.com/ionize1080/Folio/actions/runs/42262611856) 中全部通过。发行提交为 `5984385d846673ae7e2626f7762b9ce59209ceb8`；五个独立验收组、两个 MCP 工作进程、两条成品测试队列及实际 ZIP 更新验证均已完成。[公开验证报告](https://github.com/ionize1080/Folio/releases/download/v2.3.0/Folio-PDF-Studio-2.3.0-validation.json) 包含各组来源与结果。

```mermaid
flowchart LR
  A[核心契约与结果隔离检查] --> B[准备可复用依赖]
  B --> N[原生引擎回归]
  B --> C[转换与文档界面]
  B --> M[MCP 回归：两个进程]
  B --> D[界面与 MCP 桥接]
  B --> E[真实 AI 场景]
  C --> F[核对提交和运行来源]
  N --> F
  M --> F
  D --> F
  E --> F
  F --> G[构建一次成品]
  G --> P[工作区、图形、AI 成品队列]
  G --> Q[转换、字体、结构成品队列]
  P --> H[精确 ZIP 更新验证]
  Q --> H
  H --> I[正式 Release]
```

最多同时运行五组 Windows 验收，低于 GitHub Free 标准运行器的并发限制。每组运行在独立虚拟机中，测试配置、输出文件和临时 PDF 不跨组共享。真实 API 测试集中在一个组，避免分组后放大外部服务并发。原生回归与界面集成无需下载 Office、Ghostscript 或 OCR 模型；按需准备依赖，减少分组的额外开销。

MCP 回归在单台运行器内固定使用两个 pytest-xdist 进程，按模块或类分配，自动合并行与分支覆盖率后执行 75% 门槛；不对每个分片分别降低门槛。固定上游版本的 542 项测试必须完整收集。禁止无限重启失败的工作进程。成品检查也只使用两个并行队列，各测试使用独立应用配置及输出文件，单项限时六分钟。一个测试失败时继续收集其他独立测试结果，整体仍返回失败；健康检查、归档、真实 ZIP 更新和发布必须在所有成品进程结束后串行执行。

| 关卡 | 主要内容 | 失败后的处理 |
| --- | --- | --- |
| Core contracts | 单元检查、源码归档规则、报告来源隔离测试 | 重跑核心关卡及其依赖 |
| Prepare reusable dependencies | 锁定依赖、模型、Chatbox 与 PDF MCP 中间构建 | 重跑准备关卡 |
| Native engine regressions | Windows 字体、文本、图像、表格和保存回归 | 仅重跑此组及发布关卡 |
| Conversion, conformance and document UI | Office 转换、PDF/A、图层、标签、字体、合并与相关界面 | 仅重跑此组及发布关卡 |
| MCP regression | 两进程运行完整上游回归，合并覆盖率 | 仅重跑此组及发布关卡 |
| MCP and UI integration | 续跑保护、设置、窗口、对话和原生桥接 | 仅重跑此组及发布关卡 |
| Real AI scenarios | 真实模型转换、同一对话实时上下文、编辑、OCR 和图像生成 | 仅重跑此组及发布关卡 |
| Verify final package and publish | 成品程序、实际 ZIP 更新、校验和、正式发行 | 仅重跑成品发布关卡 |

同一提交可以使用 GitHub 的 **Re-run failed jobs**，保留已经成功的其他组结果。代码发生变化后启动新的验证，不把旧版本测试结果当作新版本通过。新运行会取消过期运行；发布前还会核对 main 的最新提交，避免发布已经被后续修改替代的构建。

缓存只包含可重新下载或重建的依赖与中间构建，不包含测试结果、用户配置、API 密钥或最终发行包。依赖按锁定校验和恢复，中间构建以输入指纹命名并校验文件清单。缓存未命中会正常重建；校验失败会阻断使用。仅准备关卡保存缓存，且保守估算总占用不超过 8 GiB；不会提高付费缓存容量。

测试组通过 GitHub 原生 job outputs 传递小型结构化结果，每组传输限制为 24,000 字符，并校验组名、提交、工作流运行编号、报告集合与通过状态。结果来源错误、报告缺失或失败都会阻止发布。最终验证报告随正式 Release 保存。默认不上传大型 Actions artifacts；截图与临时构建在运行器回收时释放。

正式发行前先创建草稿并核对所有上传文件的 SHA-256，全部上传验证完成后才公开。发布脚本不会替换已发布版本。

后台 Windows 窗口的 CDP 截图可能在字体加载完成后仍超时，因此图形与工作台测试使用 Electron 原生隐藏窗口捕获，并检查图像非空。功能断言仍完整保留。截图中的“fonts loaded”是正常状态，不能当作字体引擎失败。

独立界面组使用经过校验的便携 MCP 运行时，不依赖另一组创建的测试虚拟环境。真实 AI 测试在读取或写入模型配置前等待设置加载完成，避免启动时默认值覆盖测试配置；配置缺失仍正常报错。

GitHub 规则核对日期：2026-11-07。公开仓库使用标准托管运行器的计算免费，缓存和产物有各自额度；历史存储删除只减少后续占用，不冲销已经累计的计费。账户其他仓库、Packages 或服务的用量不由本工作流控制。

- [Actions 使用条款](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#actions)
- [Actions 计费与存储说明](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Actions 限制](https://docs.github.com/en/actions/reference/limits)
- [依赖缓存与产物的适用范围](https://docs.github.com/en/actions/concepts/workflows-and-actions/dependency-caching)
- [pytest-xdist 的受控进程与分组](https://pytest-xdist.readthedocs.io/en/stable/distribution.html)
- [分布式测试的合并覆盖率](https://pytest-cov.readthedocs.io/en/stable/xdist.html)
