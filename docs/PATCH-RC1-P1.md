# Folio PDF Studio 1.1.0 RC1 P1

修复直接打开加密 PDF 时出现 PDFDocument.load is encrypted 的错误。

## 行为

- 普通“打开”、拖入文件和文件输入共享打开流程。
- 无打开密码的受限 PDF 自动调用已内置的 libqpdf 解密后加载。
- 需要密码的 PDF 显示密码输入框，支持错误后重试、Enter 提交及取消。
- 密码输入提交或取消即清空，不写入偏好、日志或项目文件。
- 取消及错误密码保留当前文档、书签和未保存修改；取消时丢弃迟到的解密结果。
- 解密结果通过严格 pdf-lib 及 PDF.js 解析后才切换文档，不使用 ignoreEncryption 绕过解析。
- 加密原件首次保存强制另存无密码副本，即使关闭了首选项中的原件保护。

## 补丁安装

适用于已有完整 Windows x64 1.1.0 RC1 便携版。退出 Folio，将 patch ZIP 中的 resources 文件夹复制到 Folio.exe 同一目录，合并文件夹并替换 resources/app.asar。重新打开后界面显示 1.1.0 RC1 P1。
保留现有 resources/native 和其他文件，无需安装依赖。回退可在覆盖前备份原 resources/app.asar。
未安装 RC1 的用户应完整解压 P1 portable ZIP，直接运行 Folio.exe。
source ZIP 提供完整更新源码及原有内置引擎资源。

## 验证

- 81 项 JavaScript 自动测试通过。
- Linux Chromium + 实际 libqpdf 集成回归通过：RC4、AES-128、AES-256、中文密码、空打开密码受限文件、用户/所有者密码、错误后重试、取消及迟到响应、强制另存副本。
- 打开后验证页数、书签、可提取正文；另存副本通过 qpdf 验证为未加密；原测试文件 SHA-256 未变化。
- Windows 包执行静态资源/源码一致性验证；未在 Windows 真机启动验证。
- 尚未获得报错原 PDF，本次依据截图错误链路及生成的多类加密 PDF 验证。
