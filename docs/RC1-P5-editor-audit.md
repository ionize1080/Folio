# RC1-P5 字体、排版与重复编辑审计

本次修复基于 RC1-P4（017062def8f324a82de02f9f08261fbd437c8645）。
发布必须通过 Windows 完整回归、打包检查及实际 Folio.exe 的编辑保存测试。
源码中的测试是验收条件；实际执行记录见对应 GitHub Actions 及 release 的 validation.json。

## 已定位问题与实现

| 问题 | 原因 | 修复 |
|---|---|---|
| 内嵌中文字体在 Chromium 报 Invalid font data | PDF 子集允许省略浏览器需要的 cmap/post/OS2 | 按 PDF ToUnicode 重建 cmap，补 post 与缺失的 OS/2 度量元数据，校验表范围、度量与校验和；保留原字形与提示字节 |
| 内嵌 CID CFF 错用替代字体或映射到错误字形 | 把 CID 当作 GID，且只处理 CIDFontType2 | 支持 OTTO 内 CIDFontType0，从 CFF charset 建立 CID→GID→Unicode 映射 |
| Type1 英文字体无法加载 | PFA/PFB 不是浏览器 FontFace 格式 | 从原 Encoding/ToUnicode 恢复 Unicode 并封装为 OpenType CFF |
| 字距增加后浏览器裁字 | hmtx 扩大，但 hhea.advanceWidthMax 未同步 | 归一化最大字宽；不改变原文字形 |
| 一页文字整体变成不可编辑 | 空 f/S 绘制操作被当成 PDFium 页面对象 | 仅在存在路径时增加绘制对象索引 |
| 保存后文字仍能搜索，却不能再次编辑 | Folio 写出的内容 Form 再打开时作为不透明对象 | 仅展开有明确 Folio Content 标记的自有层，保留矩阵、剪裁、资源作用域；不展开外部 Form/OCR/透明组 |
| 中英混排或局部粗体被错误拆栏 | 样式片段先参与栏间空白推断 | 先恢复视觉行，再推断栏；多行正文横跨候选栏线时拒绝该分栏 |
| 改字号或宽度后沿原行错误断段 | 提取出的物理换行被当成用户段落 | 记录软换行 UTF-16 偏移，重排时恢复连续文字；用户新输入的换行仍是硬换行 |
| 旋转页面无法进入编辑或选区错位 | 编辑坐标与显示坐标混用 | 分离原始页面坐标和 0/90/180/270° 显示变换；原始旋转值保持不变 |
| HTML 导出的横线表格被识别为正文 | 没有可见竖线 | 用重复横线分段端点恢复单元格，并检查文字不跨列；推断表格禁止自动移动边框 |
| 非 BMP 字符保存后映射无效 | 生成的 ToUnicode 将五/六位标量当 UTF-16BE | 仅修复无效标量写法为代理对，保留合法多码点映射 |
| 英文行末出现 U+0002 | PDFium 的连字符标记进入编辑字符串 | 仅当 FPDFText_IsHyphen 确认时恢复连字符；不按字符编码盲替换 |
| 字体栏样式偶尔选错 | 最长单一样式片段代替全文权重 | 按字体/字号/粗斜体累计字符权重选择主体样式 |
| emoji 附近编辑损坏样式偏移 | 字符串差分切开 UTF-16 代理对 | 调整差分边界，维护软换行、拆分与接续偏移 |
| 快速字体加载失败后编辑停住 | FontFace 异常直接中断激活 | 保留草稿，切回原字位/原生排版，并显示实际状态 |

便携版在首次处理 CID CFF 前加载随包附带的 fontTools，不依赖此前是否打开过 Type1 字体。

字体缓存改为 v11；字体和元数据用原子替换写入，避免多个工作进程读到半个文件。

## 阅读的开源实现与借鉴

没有将其他编辑器整套算法移植进 Folio。下列是实际阅读的源码与对应设计取舍，原实现仍受各项目许可证约束。

| 项目与源码 | 借鉴点 | Folio 的使用方式 |
|---|---|---|
| [PDF.js fonts.js](https://github.com/mozilla/pdf.js/blob/master/src/core/fonts.js) | PDF 字体需要修复、转封装，不能直接当作浏览器字体；post 等表的构造 | 独立实现有界 sfnt 归一化，字形与度量保真测试 |
| [LibreOffice Draw PDF import](https://github.com/LibreOffice/core/blob/master/sdext/source/pdfimport/tree/drawtreevisiting.cxx) | 文本行、段落和字符样式需要分层恢复 | 样式 run 不再直接决定页面分栏 |
| [PDF4QT pdftextlayout.cpp](https://github.com/JakubMelka/PDF4QT/blob/master/Pdf4QtLibCore/sources/pdftextlayout.cpp) | 字符→行→块及书写方向约束，提取换行与文本流分离 | 视觉行推断与软换行元数据；保留字位映射 |
| [ONLYOFFICE document.js](https://github.com/ONLYOFFICE/sdkjs/blob/master/pdf/src/document.js)、[shape.js](https://github.com/ONLYOFFICE/sdkjs/blob/master/pdf/src/drawings/shape.js) | 字体就绪后重算、形状文本与文档模型分工、局部失效重算 | 字体异常回退到原生排版，保留现有过时任务抑制机制 |
| [Scribus pageitem_textframe.cpp](https://github.com/scribusproject/scribus/blob/master/scribus/pageitem_textframe.cpp) | 段落、字形整形、基线和文本框约束属于不同层次 | 硬段落和视觉折行分开，推断单元格采取固定边界 |
| [PDFium fpdf_text.h](https://pdfium.googlesource.com/pdfium/+/refs/heads/main/public/fpdf_text.h) | 明确区分生成字符、连字符和 Unicode 映射错误 | 依据 IsHyphen 恢复连字符，原始旋转坐标提取避免生成空格污染 |

读取版本的 Git blob SHA：LibreOffice `0abf1606784974f85a8d1914bf10ecd056a1c9f2`；PDF4QT `9b3ce2b0a61dabab97822c68deba8eb0f7a22c05`；ONLYOFFICE document `b9db896385559b42b0b8a8bc86d42dbfdd5365ad`、shape `c3f81ab6456438c9cfc433bfea0c67c686c6e414`；Scribus `10e5ba1dc55e31dcc317624b4028e8f3ab59a47f`。

## 可复现测试

1. `npm ci`，`python -m pip install -r tests/requirements.txt`，`npx playwright install chromium`。
2. `python scripts/restore-assets.py`，`python tests/public-corpus-p5.py`，`npm test`。
3. Windows：`npm run build:win`，`npm run test:package`，设置 `FOLIO_EXE` 后运行 `tests/electron-v12.cjs`、`tests/electron-p4.cjs`、`tests/electron-p5.cjs`。

公开语料：PDF.js 的 tracemonkey（英文双栏，14 页）、hello_world_rotated（5 页）、ArabicCIDTrueType（阿拉伯文，1 页）、french_diacritics（法文 Type3，1 页）、SimFang-variant、XiaoBiaoSong（中文，各 1 页）。下载清单固定 SHA-256，内容变化则失败，不静默替换。私有的两份中文文档另在本地验证 18 页，不随源码或 release 分发。全体共 8 份、41 页。

自动检查包括：所有页面能完成检查、连字符控制字符计数、字体覆盖、原字体轮廓/字宽不变、三次编辑保存重开、空绘制对象、四个方向的实际 /Rotate 保存、稀疏表格单元格、代理对、混合样式单栏与真正三栏。实际 Windows EXE 还检查 Chromium FontFace 加载、中文连续保存重开、旋转页面点击及推断表格禁用边框调整。

## 尚未覆盖的能力

- Type3 字体、无法恢复 Unicode 的字体、非 Identity 编码的部分 CID 字体，仍可能需要明确选择替代字体。
- 阿拉伯文检查通过不等于复杂文字编辑全面通过；复杂整形仍由原生排版处理，快速排版能力有边界。
- 非零页面原点、不同 CropBox/MediaBox、非默认 UserUnit 的交互编辑仍保守限制。
- 稀疏表格只支持固定边界内的文字编辑；没有验证重建所有边框或跨页表格。
- 41 页不是任意 PDF 的完备证明。发布继续使用 RC 预发布标记。
