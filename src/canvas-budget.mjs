// An edit background can coexist with its replacement while rendering.
// Each surface is <= 6MP and <= 8192px on either side (two RGBA surfaces < 48MB).
export function boundedCanvasScale(
  width,
  height,
  requested,
  pixels = 6_000_000,
) {
  if (
    ![width, height, requested, pixels].every(
      (n) => Number.isFinite(n) && n > 0,
    )
  )
    throw Error("Invalid canvas dimensions");
  return Math.min(
    requested,
    Math.sqrt(pixels / (width * height)),
    8192 / width,
    8192 / height,
  );
}
