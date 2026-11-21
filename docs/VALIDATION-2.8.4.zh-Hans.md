# Folio 2.8.4 发布验证

[English](VALIDATION-2.8.4.md) · [简体中文](VALIDATION-2.8.4.zh-Hans.md) · [繁體中文](VALIDATION-2.8.4.zh-Hant.md)

Windows 发布流程直接验收将要发布的 Windows x64 便携 ZIP，并从同一份检出代码构建源码包。正式验证 JSON 记录程序提交、构建运行链接和可执行文件的哈希值。合并前的测试结果保存在[候选版 Windows 运行](https://github.com/ionize1080/Folio/actions/runs/44871390695)。[Windows 发布流程](https://github.com/ionize1080/Folio/actions/workflows/release-284.yml) · [验证 JSON](https://github.com/ionize1080/Folio/releases/download/v2.8.4/Folio-PDF-Studio-2.8.4-validation.json)

## 段落编辑与速度

| 样本和操作 | 实测结果 |
| --- | --- |
| 恒隆中期报告，两处带标签段落 | 两处编辑底图准备时间由同机对照的 1.468 秒、2.094 秒降至 0.420 秒、0.939 秒。MuPDF 与 PDFium 对比参考像素一致。 |
| 45 页繁体中文中期报告，第 23 页替换两个字 | 430 个未修改字符的位置及编辑范围外的像素均一致。其余 44 页的文字和渲染一致。 |
| 群晖 DS1621+ 中文规格书，修改段落后重开 | 能搜索到替换后的文字。旁栏、上标脚注及其余七页的渲染一致。 |
| 双栏 NAACL 论文，在摘要中追加文字 | 重开后按内容流顺序提取文字，与原文相比只增加了输入的 `Test.`。 |

表中计时对应准备编辑底图这一环节。首次进入编辑模式，以及应用需要补充字形的修改，可能耗时更长。可结合所用机器和 PDF 判断这些结果对自己文档的参考价值。[实测与保真对照](https://github.com/ionize1080/Folio/pull/26)

### 一次本机编辑从打开文件到保存的耗时

在 45 页恒隆中期报告第 23 页，测试选中 `該等資產` 并输入 `上述資產`。下表按这一次本机运行的各项操作分别计时。第一项从打开 PDF 开始，编辑阶段在跳转到第 23 页后开始。

| 操作及计时终点 | 耗时 |
| --- | ---: |
| 打开 PDF，直至首页文字层出现文字 | 1.11 秒 |
| 在第 23 页进入编辑模式，直至出现首个可编辑区域 | 3.20 秒 |
| 点击目标段落，直至输入框获得焦点并可输入 | 78 毫秒 |
| 在选区输入替换文字 | 4.1 毫秒 |
| 点击完成，直至修改生效且段落编辑器关闭 | 12.85 秒 |
| 点击保存，直至增量保存完成 | 3.47 秒 |

前表中的底图准备是另一项独立计时。以上六阶段数据来自本机开发构建，Windows 发布流程另有各自的运行记录。

## 增量保存与独立阅读器

| 阅读器或方法 | 测试与结果 |
| --- | --- |
| Adobe Reader XI 11.0.10.32，12 份公开 PDF | 每份文件均以独立 Windows 进程打开并可翻到末页。首次保存、二次保存和重做后的文件均可复制出预期中文。[Reader XI 实测](https://github.com/ionize1080/Folio/actions/runs/44870462512/job/136743594117) |
| Adobe Reader XI，7 份文件的错误 14 对照 | 含交叉引用流的样本经 2.8.3 两次增量保存均报错。用 2.8.4 直接保存两次，以及从出错文件再次保存得到的两份副本，均可打开、翻到末页并复制预期文字。[复现与恢复](https://github.com/ionize1080/Folio/actions/runs/44871005460/job/136745299657) |
| qpdf、MuPDF、PDFium，7 份仅修改书签的 PDF | qpdf 检查通过。MuPDF 比对全部 305 页的文字、几何尺寸及 0.32 倍渲染，PDFium 比对 19 个抽样页的 0.5 倍渲染，结果均一致。[比对结果](https://github.com/ionize1080/Folio/pull/26) |

## 校验下载文件

1. 从同一发布页下载 Windows 便携 ZIP 或源码 ZIP，以及 SHA-256 清单。[2.8.4 附件](https://github.com/ionize1080/Folio/releases/tag/v2.8.4) · [SHA-256 清单](https://github.com/ionize1080/Folio/releases/download/v2.8.4/Folio-PDF-Studio-2.8.4-SHA256.txt)
2. 在下载目录运行 `Get-FileHash -Algorithm SHA256 .\Folio-PDF-Studio-2.8.4-portable-win-x64.zip`。校验源码时，将文件名改为 `Folio-PDF-Studio-2.8.4-source.zip`。
3. 将输出与清单中同名文件一行的哈希值比对。该清单还包含验证 JSON 的哈希值。

[图文发行说明](RELEASE-2.8.4.zh-Hans.md) · [历次验证](VALIDATION.md)
