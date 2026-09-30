# Folio PDF Studio 1.4.0

## 图像调整工作区

- 可视化渐变滑块：色相、饱和度、明度、冷暖、色调；色彩平衡、黑白、通道混合器、可选颜色均提供滑块和数值框联动。
- 渐变映射增加实际颜色条；高 DPI 曲线、直方图、原位预览和原图对照继续保留。
- 面板内部独立滚动，底部状态和处理进度始终可见；无精确进度的运算显示不定进度条，不伪造百分比。
- 更多工具菜单显示在停靠面板上方；进入图像工具自动收起菜单。

## 选择与批量编辑

页面工具栏新增手型、选择文本、选择对象、文字框选、图片框选。

- 框选支持完全包含 / 相交即选。Ctrl 点击切换所选项，Shift 点击或框选追加；Alt 拖动可在已有对象上强制框选。
- 多选文字、图片或混合对象后可整体拖动、精确位移、方向键 1 pt 微移、Shift + 方向键 10 pt 微移；Shift 拖动锁定水平 / 垂直方向。
- 多个文字可统一字号和颜色，只有勾选的属性会修改；原字体和字形编码保留，字号通过原有字形整体缩放实现。
- 多张图片可进入同一调整面板，原位预览后一次应用相同的完整调整参数；各自的位置、裁切和替换图片保持不变。面板以第一张图片的现有参数和直方图为参考。
- 支持批量删除、整批撤销和重做。当前版本选择范围为当前页；只读或与段落编辑冲突的对象有明确提示。
- “选择文本”用于读取和复制文字；“文字框选”选择可编辑的文字绘制对象。PDF 的绘制对象可能比视觉段落更细，段落正文修改仍使用“页面编辑”。

## 交付与验证

提供完整 Windows x64 portable、源码 ZIP、同提交 Windows 验证报告及 SHA-256。发布由 Windows 打包 EXE 的新交互测试、图像调整回归、编辑 / OCR / 书签回归、公开文档测试共同门控。原 1.3.0 发布保留。

## 参考官方交互

- Adobe：<https://helpx.adobe.com/photoshop/using/levels-adjustment.html>
- Adobe：<https://helpx.adobe.com/photoshop/using/curves-adjustment.html>
- Adobe：<https://helpx.adobe.com/in/photoshop/desktop/adjust-color/color-corrections/apply-a-hue-or-saturation-adjustment.html>
- PDF-XChange：<https://help.pdf-xchange.com/pdfxe11/editing-selected-items.html>
- PDF-XChange：<https://www.pdf-xchange.com/knowledgebase/390-How-do-I-use-PDF-XChange-Editor-to-edit-documents>

这是 Folio 自行实现的功能与交互；不保证与 Photoshop 像素级算法一致。图像调整输出沿用 8 位 RGB；批量图像会将参考图片的整套调整参数应用到全部所选图片。
