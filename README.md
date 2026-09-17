# Folio PDF Studio 1.1.0 RC1

Windows x64 完整便携版。**把 portable ZIP 完整解压，双击 Folio.exe。**
无需安装 Python、qpdf、字体处理库或 OCR 模型；所有处理在本机进行。
保留 resources、locales 和随包 DLL，不要只复制 EXE，也不要在 ZIP 内直接运行。

[更新说明](docs/CHANGELOG-1.1.md) · [验证与已知边界](docs/VALIDATION-1.1.md) · [第三方许可](THIRD-PARTY-NOTICES.md)

## 1.1 改进

- 批量规则记住各操作的输入、替换内容和大小写选项；可收藏及复用最近规则。
- 书签支持正则/大小写筛选、独立页码条件；祖先作路径显示，批量操作仅作用于实际匹配项。
- 编辑模型读取原始逐字坐标；默认优先保留原字位，小范围修改尝试局部行重排，必要时回退段落重排。格式面板可主动选择整段重排。
- 字体推荐比较实际字形轮廓与字宽，支持缺字自动替换；显示匹配证据与替代字体。
- 更多工具 → 导出无密码副本：内置 libqpdf，支持正确密码及无需打开密码的受限 PDF，另存副本并校验。
- 表格结构窗口导出 CSV/XLSX；XLSX 保留合并单元格、前导零和文字值。
- 重新识别已导出的 Folio 1.1 OCR 页面时替换已标记的 OCR 层，避免重复追加。
- 首选项使用齿轮，更多工具使用三点图标，格式继续使用滑杆。

Ctrl+S 保存 PDF；页面编辑 Ctrl+Enter 完成本段。完成编辑不等于保存文件。
加密文件可先通过“导出无密码副本”处理，再打开副本编辑。
工作工程 .folio 保留原始 PDF、修改片段与结构状态；PDF 是交付输出。

## 源码与构建

source ZIP 包含完整业务源码、测试、字体、模型和 Windows Python 运行时。
使用产品请直接运行 portable ZIP；源码构建需要开发用 Node.js/npm，不是便携版运行要求。

`npm ci --ignore-scripts` 安装锁定的构建依赖；`npm test` 运行 JS 回归。
在离线构建时可指定已有完整便携目录和 ZIP：

```text
FOLIO_RUNTIME_BASE=<完整便携目录>
FOLIO_RUNTIME_BASE_ZIP=<对应完整 ZIP>
npm run build:win
node scripts/verify-package.mjs
```

构建会验证基线 EXE 与版本，并重写所有业务源码及本地引擎。
原生测试见 `tests/native-v11.py`，UI 回归见 `tests/ui-v11.cjs`。
测试环境所需开发工具及用户原始 PDF 不属于运行依赖，也不随便携版提供。

此交付标记为 RC1：自动化与静态 Windows 包校验已完成，尚未在 Windows 真机启动验收。
