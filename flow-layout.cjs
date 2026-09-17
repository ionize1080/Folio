// Dedicated persistent process: OCR / large PDF writes never queue ahead of a keystroke.
const { NativeBridge } = require('./native-bridge.cjs');
const { validateModel } = require('./flow-layout-legacy.cjs');
class FlowLayout {
  constructor(root, python) { this.bridge = new NativeBridge(root, python); }
  async render(input) {
    const model = validateModel(input);
    const result = await this.bridge.request({ command: 'flow-layout', model });
    return { ...result, bytes: Buffer.from(result.fragment, 'base64') };
  }
  close() { this.bridge.cancel(); }
}
// Kept only for old regression fixtures; the product uses MuPDF Story above.
module.exports = { ...require('./flow-layout-legacy.cjs'), FlowLayout };
