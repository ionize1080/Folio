import { turn } from "./page-coordinates.mjs";
export function constrainedDelta(x, y, shift) {
  return shift
    ? Math.abs(x) >= Math.abs(y)
      ? { x, y: 0 }
      : { x: 0, y }
    : { x, y };
}
export function nudgeDelta(key, shift = false, rotation = 0, increment = 1) {
  const direction = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  }[key];
  if (!direction) return null;
  const n = increment * (shift ? 10 : 1),
    [x, y] = direction.map((v) => v * n);
  switch (turn(rotation)) {
    case 90:
      return { x: y, y: -x };
    case 180:
      return { x: -x, y: -y };
    case 270:
      return { x: -y, y: x };
    default:
      return { x, y };
  }
}
