// PDF-space geometry, independent of display zoom, rotation and CropBox origin.
export function rectangle(a, b) {
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
  ];
}
export function matchesRect(bounds, box, intersect = false) {
  return intersect
    ? Math.min(bounds[2], box[2]) > Math.max(bounds[0], box[0]) &&
        Math.min(bounds[3], box[3]) > Math.max(bounds[1], box[1])
    : bounds[0] >= box[0] &&
        bounds[1] >= box[1] &&
        bounds[2] <= box[2] &&
        bounds[3] <= box[3];
}
export function transformedBounds(o, edit) {
  if (!edit?.matrix) return o.bounds;
  const [a, b, c, d, e, f] = o.matrix,
    det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return o.bounds;
  const m = edit.matrix,
    s = edit.objectStyle?.scale || 1;
  const points = [
    [o.bounds[0], o.bounds[1]],
    [o.bounds[2], o.bounds[1]],
    [o.bounds[2], o.bounds[3]],
    [o.bounds[0], o.bounds[3]],
  ].map(([x, y]) => {
    const u = ((d * (x - e) - c * (y - f)) / det) * s,
      v = ((-b * (x - e) + a * (y - f)) / det) * s;
    return [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]];
  });
  return [
    Math.min(...points.map((p) => p[0])),
    Math.min(...points.map((p) => p[1])),
    Math.max(...points.map((p) => p[0])),
    Math.max(...points.map((p) => p[1])),
  ];
}
export function makeObjectEdit(o, prior, page, change) {
  const edit = {
    page,
    id: prior?.id || crypto.randomUUID(),
    index: o.index,
    signature: o.signature,
    type: o.type,
    ...structuredClone(prior || {}),
  };
  edit.matrix = [...(edit.matrix || o.matrix)];
  if (change.move) {
    edit.matrix[4] += change.move[0];
    edit.matrix[5] += change.move[1];
  }
  if (change.delete) edit.delete = true;
  if (o.type === "text" && (!prior || prior.objectStyle)) {
    edit.objectStyle = { ...edit.objectStyle };
    if (change.size !== undefined)
      edit.objectStyle.scale = change.size / o.size;
    if (change.fill) edit.objectStyle.fill = change.fill;
  } else if (o.type === "text") {
    if (change.size !== undefined) edit.size = change.size;
    if (change.fill)
      edit.fill = [...change.fill, prior?.fill?.[3] ?? o.fill?.[3] ?? 255];
  }
  return edit;
}
