import { findRanges } from "./find-matches.mjs";

self.onmessage = ({ data: { text, pattern, limit } }) => {
  const hits = [];
  for (const range of findRanges(text, pattern)) {
    hits.push(range);
    if (hits.length >= limit) break;
  }
  self.postMessage(hits);
};
