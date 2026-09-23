// Geometry warnings never authorize or reject a content write. Integrity stays
// a separate state; signatures use quantized geometry so subpixel noise does
// not repeatedly re-open an acknowledged warning.
export function editWarnings(model, layout, conflicts = []) {
  const glyphs = layout?.glyphs || [];
  const page = glyphs.some(
    (g) =>
      g.w > 0 &&
      (g.x < -0.5 ||
        g.y < -0.5 ||
        g.x + g.w > model.pageWidth + 0.5 ||
        g.y + g.h > model.pageHeight + 0.5),
  );
  const overlap = conflicts.filter((c) => !["source", "page"].includes(c.kind));
  const integrity =
    conflicts.some((c) => c.kind === "source") ||
    layout?.mappingComplete === false;
  const frame = !!(layout?.frameOverset || layout?.overflow);
  const messages = [];
  if (model.structureWarning) messages.push(model.structureWarning);
  if (page) messages.push("文字越出页面，导出可见范围会裁切");
  if (frame) messages.push("文字超出文本框，可继续编辑或调整尺寸");
  if (overlap.length) messages.push(`${overlap.length} 处可能遮挡，可继续编辑`);
  return {
    page,
    frame,
    overlap: overlap.length,
    integrity,
    messages,
    signature: JSON.stringify([
      page,
      frame,
      ...conflicts.map((c) => [
        c.kind,
        ...(c.bounds || []).map((v) => Math.round(v * 2) / 2),
      ]),
    ]),
  };
}
