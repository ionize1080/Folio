const { readingOrder } = require("./ocr-reading-order.cjs");
// Conservative merge: manually reviewed geometry/text wins over overlapping new
// detections. Keep every unmatched manual block, including explicit exclusions.
function bounds(b) {
  const q = b.quad;
  return [
    Math.min(...q.map((p) => p[0])),
    Math.min(...q.map((p) => p[1])),
    Math.max(...q.map((p) => p[0])),
    Math.max(...q.map((p) => p[1])),
  ];
}
function overlap(a, b) {
  const x = bounds(a),
    y = bounds(b),
    inter =
      Math.max(0, Math.min(x[2], y[2]) - Math.max(x[0], y[0])) *
      Math.max(0, Math.min(x[3], y[3]) - Math.max(x[1], y[1]));
  return (
    inter /
    Math.max(
      0.001,
      Math.min((x[2] - x[0]) * (x[3] - x[1]), (y[2] - y[0]) * (y[3] - y[1])),
    )
  );
}
function mergeReview(fresh, previous, { regionQuad = null } = {}) {
  const outside = (b) => {
    if (!regionQuad) return false;
    const q = bounds(b),
      r = bounds({ quad: regionQuad });
    return q[2] <= r[0] || q[0] >= r[2] || q[3] <= r[1] || q[1] >= r[3];
  };
  const protectedBlocks = previous.filter(
    (b) => b.corrected || b.excluded || b.reviewAccepted || outside(b),
  );
  const output = fresh.filter(
    (b) =>
      !protectedBlocks.some(
        (old) => old.page === b.page && overlap(old, b) > 0.35,
      ),
  );
  return readingOrder(output.concat(protectedBlocks.map((b) => ({ ...b }))));
}
module.exports = { mergeReview };
