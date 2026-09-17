import { clone, validate, childrenMap, flattenChildren } from "./model.mjs";
export const normalizeTitle = (s, loose = true) =>
  loose ? String(s).normalize("NFKC").replace(/\s+/gu, "") : String(s);
export function patchStyles(nodes, ids, patch) {
  const out = clone(nodes);
  for (const n of out)
    if (ids.has(n.id))
      for (const key of ["bold", "italic", "color"])
        if (Object.hasOwn(patch, key)) n[key] = patch[key];
  return validate(out);
}
// Compare only local destinations; do not conflate external actions with local page numbers.
export function duplicatePlan(
  nodes,
  {
    mode = "page",
    scope = "siblings",
    ids = null,
    tolerance = 3,
    loose = true,
    keep = {},
    protectedIds = null,
  } = {},
) {
  if (!["page", "exact", "near"].includes(mode)) throw Error("去重模式无效");
  if (!Number.isFinite(+tolerance) || +tolerance < 0)
    throw Error("位置容差必须为非负数");
  const out = clone(nodes),
    buckets = new Map(),
    redirects = new Map(),
    groups = [],
    removed = [];
  const outById = new Map(out.map((n) => [n.id, n]));
  const resolve = (id) => {
    const seen = new Set();
    while (redirects.has(id) && !seen.has(id)) {
      seen.add(id);
      id = redirects.get(id);
    }
    return id;
  };
  const same = (a, b) => {
    if (mode === "exact") return JSON.stringify(a) === JSON.stringify(b);
    if (!a.page || !b.page || a.page !== b.page) return false;
    if (mode === "page") return true;
    if (a.mode !== b.mode || !Array.isArray(a.args) || !Array.isArray(b.args))
      return false;
    const count =
      a.mode === "XYZ"
        ? 2
        : a.mode === "FitR"
          ? 4
          : ["FitH", "FitV", "FitBH", "FitBV"].includes(a.mode)
            ? 1
            : 0;
    return (
      count > 0 &&
      a.args
        .slice(0, count)
        .every(
          (v, i) =>
            v !== null &&
            b.args[i] !== null &&
            Math.abs(v - b.args[i]) <= +tolerance,
        )
    );
  };
  for (const n of out) {
    n.parent = resolve(n.parent);
    if (ids && !ids.has(n.id)) continue;
    if (mode !== "exact" && (!n.target.page || n.target.external)) continue;
    const key = JSON.stringify([
      scope === "siblings" ? n.parent : null,
      normalizeTitle(n.title, loose),
      mode === "exact" ? null : n.target.page,
    ]);
    const b = buckets.get(key) || [];
    // Never merge an ancestor into a descendant or the reverse.
    const ancestors = new Set();
    let p = n.parent;
    while (p) {
      ancestors.add(p);
      p = outById.get(p)?.parent;
    }
    let g = b.find(
      (g) =>
        !ancestors.has(g.keeper.id) &&
        !(protectedIds?.has(n.id) && protectedIds.has(g.keeper.id)) &&
        same(g.keeper.target, n.target),
    );
    if (!g) {
      g = { keeper: n, members: [n] };
      b.push(g);
      buckets.set(key, b);
      continue;
    }
    g.members.push(n);
    if (protectedIds?.has(n.id)) {
      redirects.set(g.keeper.id, n.id);
      g.keeper = n;
    } else redirects.set(n.id, g.keeper.id);
    removed.push(n.id);
  }
  for (const list of buckets.values())
    for (const g of list)
      if (g.members.length > 1)
        groups.push({
          keep: g.keeper.id,
          members: g.members.map((n) => ({
            id: n.id,
            title: n.title,
            page: n.target.page,
            args: n.target.args,
            parent: n.parent,
          })),
        });
  // A different keeper may be chosen only within the detected group.
  for (const g of groups) {
    const k = keep[g.keep];
    if (k && g.members.some((n) => n.id === k) && k !== g.keep) {
      redirects.delete(k);
      redirects.set(g.keep, k);
      g.keep = k;
    }
  }
  const survivors = out.filter((n) => !redirects.has(n.id));
  for (const n of survivors) n.parent = resolve(n.parent);
  const result = flattenChildren(childrenMap(survivors));
  if (result.length !== survivors.length)
    throw Error("合并将产生无效层级，请缩小比较范围");
  return { nodes: validate(result), groups, removed: [...redirects.keys()] };
}
