import { filterBookmarks } from "./bookmark-filter.mjs";
onmessage = ({data}) => {
  try { postMessage(filterBookmarks(data.nodes, data.query, data.options)); }
  catch (e) { postMessage({error: e.message}); }
};
