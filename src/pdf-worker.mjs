import { EncryptedPDFError } from "./vendor/pdf-lib.js";
import { PdfEngine } from "./pdf-core.mjs";
let engine = new PdfEngine();
// The bundled ES5 pdf-lib Error subclass does not reliably preserve instanceof.
// Compare its exact generated message as well; unrelated parse errors stay strict.
const encryptedErrorMessage = new EncryptedPDFError().message;
let chain = Promise.resolve();
onmessage = (e) => {
  chain = chain.then(async () => {
    const { id, method, args } = e.data;
    try {
      if (!["open", "save", "extractPages", "merge"].includes(method))
        throw Error("Unknown method");
      const result = await engine[method](args);
      postMessage(
        { id, result },
        result instanceof Uint8Array ? [result.buffer] : [],
      );
    } catch (err) {
      postMessage({ id, error: err.message || String(err), code: (err instanceof EncryptedPDFError || err.message === encryptedErrorMessage) ? "PDF_ENCRYPTED" : null });
    }
  });
};
