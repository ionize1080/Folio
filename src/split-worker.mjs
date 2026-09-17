import { splitBookmarks } from "./bookmark-split.mjs";
self.onmessage = (e) => {
  try {
    self.postMessage(splitBookmarks(e.data));
  } catch (err) {
    self.postMessage({ error: err.message });
  }
};
