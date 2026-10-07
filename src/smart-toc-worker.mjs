import { resolveTocEntries } from "./smart-toc.mjs";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      entries: resolveTocEntries(
        data.entries,
        data.pages,
        data.pageCount,
        data.pageLabels,
        data.excludedPages,
      ),
    });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
