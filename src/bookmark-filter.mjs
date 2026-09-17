export function filterBookmarks(nodes, query, { regex = false, caseSensitive = false, page = "" } = {}) {
  if (query.length > 10000) throw Error("筛选表达式过长");
  let re;
  try { if (regex && query) re = new RegExp(query, caseSensitive ? "u" : "iu"); }
  catch (e) { throw Error("正则表达式未完成或无效：" + e.message); }
  if (page && !/^[1-9]\d*$/.test(page)) throw Error("页码须为正整数");
  const needle = caseSensitive ? query : query.toLocaleLowerCase();
  const matches = new Set(nodes.filter(n => (!page || n.target?.page === +page) &&
    (!query || (re ? re.test(n.title) : (caseSensitive ? n.title : n.title.toLocaleLowerCase()).includes(needle)))) .map(n => n.id));
  const visible = new Set(matches), byId = new Map(nodes.map(n => [n.id,n]));
  for (const id of matches) {
    let parent = byId.get(id)?.parent;
    while (parent && !visible.has(parent)) { visible.add(parent); parent = byId.get(parent)?.parent; }
  }
  return { matches: [...matches], visible: [...visible] };
}
