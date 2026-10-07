import { ocrPage } from "./ocr-data.mjs";
const destinations = new WeakMap();
async function internalTarget(pdf, destination) {
  if (!destinations.has(pdf)) destinations.set(pdf, new Map());
  const cache = destinations.get(pdf),
    key = JSON.stringify(destination);
  if (!cache.has(key))
    cache.set(
      key,
      (async () => {
        const dest =
          typeof destination === "string"
            ? await pdf.getDestination(destination)
            : destination;
        if (!Array.isArray(dest) || !dest.length) return null;
        const index =
          typeof dest[0] === "number"
            ? dest[0]
            : await pdf.getPageIndex(dest[0]);
        if (!Number.isInteger(index) || index < 0 || index >= pdf.numPages)
          return null;
        return { kind: "dest", page: index + 1, mode: "Fit", args: [] };
      })().catch(() => null),
    );
  return cache.get(key);
}
export async function extractTocPage(pdf, number, rotation, ocr = []) {
  const page = await pdf.getPage(number),
    vp = page.getViewport({ scale: 1, rotation });
  const content = await page.getTextContent();
  let fragments = content.items
    .filter((i) => i.str?.trim())
    .map((i) => {
      const [a, b, c, d, x, y] = i.transform,
        size = Math.hypot(a, b) || 1;
      let dx = a / size,
        dy = b / size,
        h = Math.hypot(c, d) || i.height || 10,
        w = i.width;
      if (content.styles[i.fontName]?.vertical) {
        dx = -c / h;
        dy = -d / h;
        w = i.height;
        h = i.width || size;
      }
      const quad = [
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
      ].map(([u, v]) =>
        vp.convertToViewportPoint(x + dx * u - dy * v, y + dy * u + dx * v),
      );
      const origin = vp.convertToViewportPoint(x, y),
        end = vp.convertToViewportPoint(x + dx, y + dy);
      return {
        text: i.str,
        quad,
        angle:
          (Math.atan2(end[1] - origin[1], end[0] - origin[0]) * 180) / Math.PI,
        source: "PDF",
      };
    });
  const blocks = ocrPage(ocr, number).filter((b) => !b.excluded && b.text);
  if (blocks.length) {
    const recognized = blocks.map((b) => {
      const quad = b.quad.map((q) => vp.convertToViewportPoint(...q));
      const angle =
        (Math.atan2(quad[1][1] - quad[0][1], quad[1][0] - quad[0][0]) * 180) /
        Math.PI;
      const cardinal = Math.round(angle / 90) * 90;
      return {
        text: b.text,
        quad,
        angle: Math.abs(angle - cardinal) < 12 ? cardinal : angle,
        source: "OCR",
        confidence: b.confidence,
        needsReview: b.needsReview,
        diagnostic: b.diagnostic,
        reviewed: b.reviewed,
      };
    });
    // Prefer reviewed OCR only where its box overlaps native text.
    const rect = (q) => [
      Math.min(...q.map((p) => p[0])),
      Math.min(...q.map((p) => p[1])),
      Math.max(...q.map((p) => p[0])),
      Math.max(...q.map((p) => p[1])),
    ];
    // A narrow single digit (especially 1) can have an OCR quadrilateral whose
    // long edge points vertically. Borrow a nearby caption's baseline only
    // when its box is close, instead of treating that digit as vertical text.
    for (const f of recognized.filter((f) =>
      /^[\p{Nd}]{1,4}$/u.test(f.text.trim()),
    )) {
      const a = rect(f.quad);
      const nearest = recognized
        .filter((g) => /\p{L}/u.test(g.text) && g.text.trim().length > 2)
        .map((g) => {
          const b = rect(g.quad),
            dx = Math.max(0, a[0] - b[2], b[0] - a[2]),
            dy = Math.max(0, a[1] - b[3], b[1] - a[3]);
          return { g, d: Math.hypot(dx, dy) };
        })
        .sort((a, b) => a.d - b.d)[0];
      if (nearest?.d < 45) f.angle = nearest.g.angle;
    }
    fragments = fragments
      .filter((f) => {
        const a = rect(f.quad);
        return !recognized.some((r) => {
          const b = rect(r.quad);
          return (
            Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) *
              Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1])) >
            Math.max(1, (a[2] - a[0]) * (a[3] - a[1])) * 0.5
          );
        });
      })
      .concat(recognized);
  }
  const links = [];
  for (const annotation of await page.getAnnotations()) {
    if (!annotation.dest || !annotation.rect) continue;
    const target = await internalTarget(pdf, annotation.dest);
    if (!target) continue;
    const b = vp.convertToViewportRectangle(annotation.rect);
    links.push({
      bounds: [
        Math.min(b[0], b[2]),
        Math.min(b[1], b[3]),
        Math.max(b[0], b[2]),
        Math.max(b[1], b[3]),
      ],
      target,
    });
  }
  return { page: number, width: vp.width, height: vp.height, fragments, links };
}
