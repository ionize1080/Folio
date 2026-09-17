import {
  clone,
  uid,
  validate,
  childrenMap,
  flattenChildren,
} from "./model.mjs";

const tokens = /\$(\$|&|`|'|\d+|<[^>]+>)/g;
function checkTemplate(t, shape) {
  for (const m of t.matchAll(tokens)) {
    const n = m[1];
    if (/^\d+$/.test(n) && +n >= shape.length)
      throw Error(
        `替换文本引用 $${n}，但正则只有 ${shape.length - 1} 个捕获组`,
      );
    if (n[0] === "<" && !Object.hasOwn(shape.groups || {}, n.slice(1, -1)))
      throw Error(`替换文本引用了不存在的捕获组 $${n}`);
  }
}
function expand(t, m, original) {
  return t.replace(tokens, (_, n) => {
    if (n === "$") return "$";
    if (n === "&") return m[0];
    if (n === "`") return original.slice(0, m.index);
    if (n === "'") return original.slice(m.index + m[0].length);
    const v = n[0] === "<" ? m.groups?.[n.slice(1, -1)] : m[+n];
    if (v === undefined) throw Error("捕获组未参与本次匹配：$" + n);
    return v;
  });
}

export function splitBookmarks({
  nodes,
  ids,
  mode = "siblings",
  method = "extract",
  separator = "[；;]",
  rules = [],
  outputMode = "template",
  retain = false,
  children = "block",
  pairing = "block",
  pageCount,
}) {
  validate(nodes, pageCount);
  if (!["siblings", "hierarchy"].includes(mode)) throw Error("生成方式无效");
  const chosen = new Set(ids),
    selected = nodes.filter((n) => chosen.has(n.id));
  const originalChildren = childrenMap(nodes);
  const out = [],
    changes = [],
    issues = [],
    skipped = [];
  let compiled, splitRE, compileError;
  try {
    if (mode === "siblings" && method === "separator")
      splitRE = new RegExp(separator, "gu");
    else {
      if (!Array.isArray(rules) || rules.length < 1 || rules.length > 100)
        throw Error("规则数量须为 1–100 条");
      let previous = -1;
      compiled = rules
        .map((r, i) => {
          if (r.enabled === false) return null;
          try {
            const flags =
              String(r.flags ?? "u").replace(/g/g, "") + (r.all ? "g" : "");
            const re = new RegExp(r.pattern, flags);
            const shape = new RegExp(
              `(?:${r.pattern})|`,
              flags.replace(/[gy]/g, ""),
            ).exec("");
            const template = String(r.template ?? "$0");
            checkTemplate(template, shape);
            const parent =
              r.parentRule == null ? previous : Number(r.parentRule);
            if (
              mode === "hierarchy" &&
              (!Number.isInteger(parent) || parent < -1 || parent >= i)
            )
              throw Error("父规则须为前面的规则或根级");
            previous = i;
            return { re, template, parent, rule: r, index: i };
          } catch (e) {
            throw Error(`规则 ${i + 1}：${e.message}`);
          }
        })
        .filter(Boolean);
      if (!compiled.length) throw Error("请至少启用一条规则");
    }
  } catch (e) {
    compileError = e.message;
  }
  let total = nodes.length;
  for (const node of nodes) {
    if (!chosen.has(node.id)) {
      out.push(clone(node));
      continue;
    }
    try {
      if (compileError) throw Error(compileError);
      const made = [],
        outputs = new Map(),
        evidence = [];
      const make = (text, parent, ruleIndex = null) => {
        text = text.trim();
        if (!text) return null;
        if (text.length > 32768) throw Error("生成标题过长");
        const n = { ...clone(node), id: uid(), title: text, parent };
        made.push(n);
        if (made.length > 5000) throw Error("单条书签生成超过 5,000 项");
        return n;
      };
      if (splitRE) {
        let last = 0,
          found = false;
        splitRE.lastIndex = 0;
        for (const m of node.title.matchAll(splitRE)) {
          if (!m[0].length) throw Error("分隔符不能匹配空字符串");
          found = true;
          make(node.title.slice(last, m.index), node.parent);
          last = m.index + m[0].length;
        }
        if (!found) {
          skipped.push({
            id: node.id,
            title: node.title,
            reason: "未匹配，保留原项",
          });
          out.push(clone(node));
          continue;
        }
        make(node.title.slice(last), node.parent);
      } else {
        const matchesByRule = compiled.map((c) => {
          c.re.lastIndex = 0;
          const matches = [];
          if (c.rule.all) {
            for (const m of node.title.matchAll(c.re)) {
              matches.push(m);
              if (matches.length > 5000)
                throw Error(`规则 ${c.index + 1} 匹配超过 5,000 项`);
            }
          } else {
            const m = c.re.exec(node.title);
            if (m) matches.push(m);
          }
          return matches;
        });
        if (matchesByRule.every((m) => !m.length)) {
          skipped.push({
            id: node.id,
            title: node.title,
            reason: "未匹配，保留原项",
          });
          out.push(clone(node));
          continue;
        }
        for (let k = 0; k < compiled.length; k++) {
          const c = compiled[k],
            matches = matchesByRule[k];
          if (!matches.length)
            throw Error(`规则 ${c.index + 1} 未匹配，整条原书签保留`);
          let parents = [{ id: node.parent }];
          if (mode === "hierarchy" && c.parent >= 0) {
            parents = outputs.get(c.parent) || [];
            if (!parents.length)
              throw Error(`规则 ${c.index + 1} 缺少父级（父规则可能未启用）`);
          }
          if (
            parents.length > 1 &&
            (pairing !== "index" || parents.length !== matches.length)
          )
            throw Error("多父项需选择按匹配序号配对，且数量一致");
          const items = matches
            .map((m, j) => {
              let title = expand(c.template, m, node.title);
              if ((c.rule.outputMode || outputMode) === "replace")
                title =
                  node.title.slice(0, m.index) +
                  title +
                  node.title.slice(m.index + m[0].length);
              const n = make(
                title,
                parents.length > 1 ? parents[j].id : parents[0].id,
              );
              if (n && evidence.length < 100)
                evidence.push({
                  id: n.id,
                  rule: c.index + 1,
                  match: m[0],
                  captures: m.slice(1),
                  groups: m.groups || {},
                });
              return n;
            })
            .filter(Boolean);
          if (!items.length) throw Error(`规则 ${c.index + 1} 生成空标题`);
          outputs.set(c.index, items);
        }
      }
      if (!made.length) throw Error("没有生成有效书签");
      const ordered = flattenChildren(
        childrenMap(
          made.map((n) => ({
            ...n,
            parent: n.parent === node.parent ? null : n.parent,
          })),
        ),
      );
      const order = new Map(ordered.map((n, i) => [n.id, i]));
      made.sort((a, b) => order.get(a.id) - order.get(b.id));
      if (!retain && made.length === 1 && made[0].title === node.title) {
        skipped.push({
          id: node.id,
          title: node.title,
          reason: "结果未改变，保留原项",
        });
        out.push(clone(node));
        continue;
      }
      if (originalChildren.has(node.id) && !retain && children === "block")
        throw Error("原书签含子项，请在高级选项中指定保留或迁移方式");
      total += made.length - (retain ? 0 : 1);
      if (total > 200000) throw Error("输出总量超过 200,000 条，请缩小范围");
      if (retain) out.push(clone(node));
      out.push(...made);
      changes.push({
        id: node.id,
        title: node.title,
        made,
        evidence,
        retained: retain,
        childTarget: children === "last" ? made.at(-1).id : made[0].id,
      });
    } catch (e) {
      out.push(clone(node));
      issues.push({ id: node.id, title: node.title, reason: e.message });
    }
  }
  // Snapshot evaluation permits all-scope ancestor/descendant transforms without reprocessing generated nodes.
  const replaced = new Map(
    changes.filter((c) => !c.retained).map((c) => [c.id, c.childTarget]),
  );
  for (const n of out)
    if (replaced.has(n.parent)) n.parent = replaced.get(n.parent);
  const ordered = flattenChildren(childrenMap(out));
  if (ordered.length !== out.length)
    throw Error("生成的父子关系无效，未应用任何修改");
  validate(ordered, pageCount);
  return {
    nodes: ordered,
    changes,
    issues,
    skipped,
    sourceCount: selected.length,
  };
}
