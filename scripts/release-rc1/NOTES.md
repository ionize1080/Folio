# Folio PDF Studio 1.2.0 RC1

这是候选预发布版本，不是正式稳定版。Windows x64 便携包解压后运行 `Folio.exe`，无需另装 Python / OCR 运行环境。

## 本次重点

- `.folio` ZIP 工程格式，兼容读取旧工程；新工程不能由旧版读取。
- 编辑片段从撤销 JSON 分离，恢复会话、配额与缺失资产处理加强。
- 源 PDF 复用、后台任务隔离，以及保存/取消/对话框/规则输入的健壮性修复。
- 统一测试入口，更新架构及验证说明。

## 已完成验证

[Windows Actions 验证](https://github.com/ionize1080/Folio/actions/runs/35211609385)：90 项 JS、50 组界面检查、原生 PDF / OCR 和 OCR 任务回归；Windows 打包、包完整性校验，以及真实 `Folio.exe` 启动、原生编辑和 PDF 保存通过。

测试代码提交：`233db28ec1fbecf7c052564ef4a1cd3ca5d7f8ba`。发布标签指向只补充最终验证文档的 `c2d00df968bec8a49a4395dbcbd21f13505ccbee`。发布包与交付文件 SHA256 完全一致，未重建或更改已测试程序。

## 下载说明与边界

- `portable-win-x64.zip`：可运行便携包。
- `source.zip`：包含本地引擎、OCR 模型和运行资源的完整源码包。GitHub 自动生成的 Source code 存档不是完整离线源码交付包。
- `validation.md`、`Windows-test-evidence.zip`：验证范围与证据。
- `SHA256.json`：上述四项的大小和 SHA256。

实际 Windows 验证环境为 Server 2025 x64；未宣称覆盖所有 Windows 10/11 硬件组合。真实中文输入法人工验收仍未覆盖。使用重要 PDF 前请保留备份，详细限制见验证记录。旧版 Release 保留，主分支未合并。
