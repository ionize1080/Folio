import { PdfEngine } from "./pdf-core.mjs";
let engine = new PdfEngine();
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
      postMessage({ id, error: err.message || String(err) });
    }
  });
};
