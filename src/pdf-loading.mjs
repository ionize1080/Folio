// Every PDF surface needs the same local font maps and image decoders. Missing
// wasmUrl silently drops JPX/JBIG2 images from edit backgrounds and thumbnails.
export const pdfLoadingOptions = Object.freeze({
  cMapUrl: new URL('./vendor/cmaps/', import.meta.url).href,
  cMapPacked: true,
  standardFontDataUrl: new URL('./vendor/standard_fonts/', import.meta.url).href,
  wasmUrl: new URL('./vendor/wasm/', import.meta.url).href,
  isEvalSupported: false,
  enableXfa: false,
});
