import { calibratePages } from "./page-calibration.mjs";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({ results: calibratePages(data) });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
