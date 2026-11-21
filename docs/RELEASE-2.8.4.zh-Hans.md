# Folio PDF Studio 2.8.4

[English](RELEASE-2.8.4.md) · [简体中文](RELEASE-2.8.4.zh-Hans.md) · [繁體中文](RELEASE-2.8.4.zh-Hant.md)

在支持的横排段落中，点击后即可开始输入，Folio 会同时准备编辑底图。新版也修复了 Adobe Reader XI 打开部分增量保存文件时报错误 14 的问题。[Windows x64 便携版和源码下载](https://github.com/ionize1080/Folio/releases/tag/v2.8.4)

## 在原位置编辑段落

打开带文字的 PDF，进入段落编辑后点击一段横排正文。在准备底图和字体期间即可输入或撤销，用 **Ctrl+B** 和 **Ctrl+I** 切换粗体和斜体。返回已分析的页面会复用解析结果。原生进程也会复用字体名称索引，字体文件变化时才刷新。

![Folio 2.8.4 中已进入编辑状态的演示文档段落](images/2.8.4/paragraph-edit.webp)

在恒隆中期报告的本机对照中，两处带标签段落准备底图的耗时分别从 1.468 秒和 2.094 秒降至 **0.420 秒和 0.939 秒**。首次进入编辑模式、应用需要补充字形的修改仍可能花费数秒。[耗时和保真对照记录](https://github.com/ionize1080/Folio/pull/26)

在第 23 页的一次独立本机编辑中，输入替换文字耗时 4.1 毫秒，应用修改耗时 12.85 秒，增量保存耗时 3.47 秒。[六个阶段的实测时间](VALIDATION-2.8.4.zh-Hans.md)

## 查找命令和阅读工具

按 **Ctrl+Shift+P**，输入部分命令名称即可查找。书签和 OCR 工作台更新了控件，搜索结果在界面中集中展示，阅读视图可更换纸张色调。启用恢复阅读位置后，打开 PDF 时还会跳过多余的打开动作查询。

![在 2.8.4 的演示 PDF 上方打开命令面板](images/2.8.4/command-palette.webp)

[功能图解](FEATURES.zh-Hans.md) · [配图来源](SCREENSHOTS.zh-Hans.md)

## 在 Adobe Reader XI 中打开增量保存的文件

Folio 保留原始交叉引用格式、文档标识和尾部字典条目，包括线性化 PDF 首个尾部字典中的元数据。对同一份含交叉引用流的样本，2.8.3 连续两次增量保存都让 Reader XI 11.0.10.32 报错误 14。2.8.4 连续两次保存均可打开，也能复制两页的预期文字。用 2.8.4 打开此例中已报错的旧版副本，再做一次增量保存，也恢复了可读性，并完整保留此前修订的字节。[错误 14 复现与修复记录](https://github.com/ionize1080/Folio/actions/runs/44871005460/job/136745299657)

另用 Reader XI 逐份冷启动打开 12 份公开测试 PDF，全部可翻到末页。样本包含经典交叉引用表、线性化 PDF、连续保存和段落编辑。首次保存、二次保存和重做后的副本均可复制出预期中文。[Reader XI 实测记录](https://github.com/ionize1080/Folio/actions/runs/44870462512/job/136743594117)

## 核对保存后的内容

群晖 DS1621+ 中文规格书编辑后，重开可搜索到新文字，旁栏、上标脚注和其余七页的渲染对比一致。双栏 NAACL 论文的摘要仅增加 `Test.`，提取顺序与原文一致。对多行共用文本对象的无标签段落，当能还原文字位置和状态时，Folio 会保留其阅读顺序。

七份 PDF 的书签增量保存通过 qpdf 检查。MuPDF 比对全部 305 页的文字、几何尺寸和 0.32 倍渲染，PDFium 另以 0.5 倍渲染比对 19 个抽样页，结果均一致。Windows 发布附件提供本次验收的便携 ZIP、源码 ZIP、验证 JSON 和 SHA-256 清单。[2.8.4 验证范围](VALIDATION-2.8.4.zh-Hans.md) · [Windows 发布流程](https://github.com/ionize1080/Folio/actions/workflows/release-284.yml)
