// Editor geometry stays in unrotated, top-left page points. Only the surface
// transform knows about page/view rotation; glyphs and output PDFs do not.
export const turn = (angle) => ((angle % 360) + 360) % 360;
export function displayToPage(x, y, width, height, angle) {
  switch (turn(angle)) {
    case 0:
      return { x, y };
    case 90:
      return { x: y, y: height - x };
    case 180:
      return { x: width - x, y: height - y };
    case 270:
      return { x: width - y, y: x };
    default:
      throw Error("页面旋转角度须为 90 度的倍数");
  }
}
export function pageTransform(width, height, angle) {
  switch (turn(angle)) {
    case 0:
      return [1, 0, 0, 1, 0, 0];
    case 90:
      return [0, 1, -1, 0, height, 0];
    case 180:
      return [-1, 0, 0, -1, width, height];
    case 270:
      return [0, -1, 1, 0, 0, width];
    default:
      throw Error("页面旋转角度须为 90 度的倍数");
  }
}
