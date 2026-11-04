import { treeOperation } from "./ai-tools.mjs";
self.onmessage = (e) => {
  try {
    const { op, args, nodes, pageCount, context } = e.data;
    self.postMessage({
      result: treeOperation(op, args, nodes, pageCount, context),
    });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
