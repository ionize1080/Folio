import { applyBatch } from "./model.mjs";
onmessage = (e) => {
  try {
    postMessage({
      nodes: applyBatch(
        e.data.nodes,
        new Set(e.data.ids),
        e.data.rule,
        e.data.pageCount,
      ),
    });
  } catch (err) {
    postMessage({ error: err.message });
  }
};
