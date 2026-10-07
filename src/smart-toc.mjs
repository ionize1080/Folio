import { parsePageLabel } from "./page-labels.mjs";
import { makeNode, validate } from "./model.mjs";
import { calibratePages, calibrationLines } from "./page-calibration.mjs";

const norm = (s) =>
  String(s || "")
    .normalize("NFKC")
    .replace(/[\s\p{P}\p{Cf}]/gu, "")
    .toLowerCase();
const heading =
  /^(目录|目次|目錄|contents|highlights|tableofcontents|sommaire|tabledesmatières|inhalt|inhaltsverzeichnis|índice|indice|contenido|содержание|المحتويات|الفهرس)$/iu;
const trimLeader = (s) =>
  s
    .replace(/[\s\p{P}\p{S}]+$/gu, "")
    .replace(/^[\s·.…_—–]+/u, "")
    .trim();
const cn = "零〇一二三四五六七八九十百千万萬壹贰貳叁參肆伍陆陸柒捌玖拾佰仟两兩";
const endLabel = new RegExp(
  `(第?[${cn}]+页?|[\\p{Nd}]+|[a-zA-Z]+[-–—][\\p{Nd}]+|[IVXLCDMivxlcdm]+|[a-zA-Z]{1,4})[)）\\]】]*$`,
  "u",
);
export function splitTocText(raw, options = {}) {
  const text = String(raw).normalize("NFKC").trim();
  const leading = text.match(
    /^(?:p(?:age)?\.?\s*)(\p{Nd}+)\s*[_:·—–-]?\s+(.+)$/iu,
  );
  if (leading && /\p{L}/u.test(leading[2]))
    return {
      title: leading[2].trim(),
      printedLabel: leading[1],
      label: parsePageLabel(leading[1]),
      raw: text,
      confidence: 75,
      leading: true,
    };
  // Page ranges point to the first page; keep the original range as evidence.
  const ranged = text.replace(/(\p{Nd}+)\s*[-–—]\s*\p{Nd}+\s*$/u, "$1");
  const m = ranged.match(endLabel);
  if (!m || m.index === 0) return null;
  const label = parsePageLabel(m[1], options);
  if (!label) return null;
  const before = ranged.slice(0, m.index),
    title = trimLeader(before);
  if (
    title.length < 2 ||
    title.length > 220 ||
    !/\p{L}/u.test(title) ||
    heading.test(norm(title))
  )
    return null;
  if (
    /[\d][,.]\d+$/u.test(before) ||
    (title.match(/\p{Nd}/gu) || []).length > title.length * 0.35
  )
    return null;
  // Latin letters must be separated: don't interpret the end of ordinary words.
  if (/[a-z]$/i.test(m[1]) && !/[\s\p{P}\p{S}]$/u.test(before)) return null;
  // Prevent a title ending in a year from becoming a confident entry.
  return {
    title,
    printedLabel: m[1],
    label,
    raw: text,
    confidence: /[.·…_—–]{2}|\s{2}/u.test(before) ? 90 : 65,
  };
}
const dot = (p, d) => p[0] * d[0] + p[1] * d[1];
const box = (f) =>
  f.quad || [
    [f.left, f.top],
    [f.right, f.top],
    [f.right, f.bottom],
    [f.left, f.bottom],
  ];
const median = (a) =>
  [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)] || 12;

// Work in the baseline's coordinate system. Vector leaders don't need text:
// geometric alignment connects the title and number across an empty gap.
export function tocRows(fragments, { direction = "auto" } = {}) {
  const groups = new Map();
  for (const f of fragments) {
    if (!f.text?.trim()) continue;
    let angle = direction === "vertical" ? 90 : f.angle || 0;
    if (direction === "horizontal") angle = 0;
    const key = Math.round(angle / 5) * 5;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  const result = [];
  for (const [angle, fs] of groups) {
    const rad = (angle * Math.PI) / 180,
      d = [Math.cos(rad), Math.sin(rad)],
      n = [-d[1], d[0]];
    const projected = fs
      .map((f) => {
        const q = box(f),
          us = q.map((p) => dot(p, d)),
          vs = q.map((p) => dot(p, n));
        return {
          ...f,
          u: Math.min(...us),
          v: Math.max(...vs),
          end: Math.max(...us),
          h: Math.max(2, Math.max(...vs) - Math.min(...vs)),
        };
      })
      .sort((a, b) => a.v - b.v || a.u - b.u);
    const rows = [];
    const isNumber = (f) => /^[\p{Nd}–—-]+$/u.test(f.text.trim());
    for (const f of [
      ...projected.filter((f) => !isNumber(f)),
      ...projected.filter(isNumber),
    ]) {
      const row = rows
        .filter((r) => {
          const superscript =
            /^[\p{Nd}–—-]+$/u.test(f.text.trim()) ||
            r.items.every((x) => /^[\p{Nd}–—-]+$/u.test(x.text.trim()));
          if (Math.max(r.h, f.h) / Math.min(r.h, f.h) > 4) return false;
          if (!superscript && Math.max(r.h, f.h) / Math.min(r.h, f.h) > 1.5)
            return false;
          return (
            Math.abs(r.v - f.v) <=
            (superscript ? Math.max(r.h, f.h) * 0.9 : Math.min(r.h, f.h) * 0.5)
          );
        })
        .sort((a, b) => Math.abs(a.v - f.v) - Math.abs(b.v - f.v))[0];
      if (row) row.items.push(f);
      else rows.push({ v: f.v, h: f.h, items: [f] });
    }
    for (const row of rows) {
      row.items.sort((a, b) => a.u - b.u);
      const parts = [];
      let part = [];
      for (const f of row.items) {
        const previous = part.at(-1);
        if (
          previous &&
          f.u - previous.end > Math.min(60, row.h * 5) &&
          /\p{L}/u.test(f.text) &&
          !parsePageLabel(f.text.trim()) &&
          /\p{L}/u.test(part.map((x) => x.text).join(""))
        ) {
          parts.push(part);
          part = [];
        }
        part.push(f);
      }
      if (part.length) parts.push(part);
      for (const items of parts) {
        const q = items.flatMap(box);
        result.push({
          items,
          angle,
          text: items.map((f) => f.text).join(" "),
          left: Math.min(...q.map((p) => p[0])),
          top: Math.min(...q.map((p) => p[1])),
          right: Math.max(...q.map((p) => p[0])),
          bottom: Math.max(...q.map((p) => p[1])),
          h: median(items.map((f) => f.h)),
        });
      }
    }
  }
  return result.sort((a, b) => a.top - b.top || a.left - b.left);
}

export function recognizeTocPage(page, options = {}) {
  const rows = tocRows(page.fragments, options).filter(
      (r) =>
        !page.height ||
        (r.top >= page.height * 0.045 && r.bottom <= page.height * 0.965) ||
        heading.test(norm(r.text)),
    ),
    entries = [],
    used = new Set();
  const add = (value, row, indices, extra = {}) => {
    if (!value) return;
    if (
      value.label?.value >= 1900 &&
      (row.top < page.height * 0.12 || row.bottom > page.height * 0.9)
    )
      return;
    entries.push({
      ...value,
      ...extra,
      sourcePage: page.page,
      bounds: [row.left, row.top, row.right, row.bottom],
      angle: row.angle,
      fontHeight: row.h,
      level: 1,
    });
    indices.forEach((i) => used.add(i));
  };
  rows.forEach((row, i) => {
    if (
      Math.abs(row.angle) % 180 === 90 &&
      row.items.every((f) => [...f.text.trim()].length === 1)
    ) {
      add(
        splitTocText(row.items.map((f) => f.text.trim()).join(""), options),
        row,
        [i],
      );
      return;
    }
    // Financial tables have several numeric cells on the same row.
    if (
      row.items.filter((f) => /^[\s()\d,.%$€¥+-]+$/u.test(f.text)).length >=
        4 &&
      row.items.filter((f) => /\p{L}/u.test(f.text)).length <= 1
    )
      return;
    // Split repeated title-number pairs on one physical row (multi-column TOC).
    let pending = [];
    for (const [fi, f] of row.items.entries()) {
      if (/^p(?:age)?\.?\s*\p{Nd}/iu.test(f.text) && pending.length) {
        const value = splitTocText(pending.join(" "), options);
        if (value) add(value, row, [i]);
        pending = [];
      }
      pending.push(f.text);
      const value = splitTocText(pending.join(" "), options);
      const next = row.items[fi + 1];
      if (
        value &&
        !value.leading &&
        (parsePageLabel(f.text.trim(), options) ||
          splitTocText(f.text, options)) &&
        (!next || next.u - f.end > row.h * 3 || value.confidence >= 85)
      ) {
        add(value, row, [i]);
        pending = [];
      }
    }
    if (pending.length) {
      const value = splitTocText(pending.join(" "), options);
      if (value) add(value, row, [i]);
    }
  });
  // Wrapped title followed by a number on its own line; preserve separate rows
  // when there is already an entry, and never join across distant columns.
  rows.forEach((row, i) => {
    if (used.has(i) || heading.test(norm(row.text))) return;
    const label = parsePageLabel(
      row.text.trim().replace(/^p(?:age)?\.?\s*/iu, ""),
      options,
    );
    if (label) {
      const prefixed = /^p(?:age)?\.?/iu.test(row.text.trim());
      const candidates = rows
        .map((r, j) => ({ r, j }))
        .filter(
          ({ r, j }) =>
            !used.has(j) &&
            j !== i &&
            !parsePageLabel(r.text.trim(), options) &&
            !heading.test(norm(r.text)) &&
            Math.abs(r.left - row.left) < Math.max(row.h * 3, 35) &&
            (!prefixed || r.top >= row.bottom - 2) &&
            Math.min(
              Math.abs(row.top - r.bottom),
              Math.abs(r.top - row.bottom),
            ) <
              row.h * 2.5,
        )
        .sort(
          (a, b) => Math.abs(a.r.top - row.top) - Math.abs(b.r.top - row.top),
        );
      if (candidates.length) {
        const { r, j } = candidates[0];
        add(
          {
            title: r.text.trim(),
            printedLabel: String(label.raw),
            label,
            confidence: 50,
            raw: r.text + " " + row.text,
            leading: prefixed,
          },
          r,
          [i, j],
          { artistic: true },
        );
      }
    }
  });
  // Continue an immediately preceding, unnumbered line into an entry.
  for (const e of entries) {
    const previous = rows
      .map((r, j) => ({ r, j }))
      .filter(
        ({ r, j }) =>
          !used.has(j) &&
          !heading.test(norm(r.text)) &&
          !parsePageLabel(r.text.trim(), options) &&
          r.bottom <= e.bounds[1] + 2 &&
          e.bounds[1] - r.bottom < r.h * 1.5 &&
          Math.abs(r.left - e.bounds[0]) < r.h * 1.5,
      )
      .at(-1);
    if (previous && !e.leading) {
      e.title = previous.r.text.trim() + " " + e.title;
      e.bounds[1] = previous.r.top;
      e.confidence = Math.min(e.confidence, 70);
      used.add(previous.j);
    }
    if (e.leading) {
      for (let count = 0; count < 5; count++) {
        const next = rows
          .map((r, j) => ({ r, j }))
          .find(
            ({ r, j }) =>
              !used.has(j) &&
              !heading.test(norm(r.text)) &&
              !parsePageLabel(r.text.trim(), options) &&
              r.top >= e.bounds[3] - r.h * 0.5 &&
              r.top - e.bounds[3] < r.h * 0.9 &&
              Math.abs(r.left - e.bounds[0]) < Math.min(30, r.h * 4) &&
              Math.max(r.h, e.fontHeight) / Math.min(r.h, e.fontHeight) < 1.35,
          );
        if (!next) break;
        e.title += " " + next.r.text.trim();
        e.bounds[3] = next.r.bottom;
        used.add(next.j);
      }
    }
  }
  const unique = entries.filter(
    (e, i) =>
      entries.findIndex(
        (x) =>
          norm(x.title) === norm(e.title) && x.printedLabel === e.printedLabel,
      ) === i,
  );
  unique.sort((a, b) => a.bounds[1] - b.bounds[1] || a.bounds[0] - b.bounds[0]);
  const indents = [
    ...new Set(unique.map((e) => Math.round(e.bounds[0] / 12))),
  ].sort((a, b) => a - b);
  for (const e of unique) {
    const numbered = e.title.match(/^\d+(?:\.\d+)+/);
    e.level = numbered
      ? Math.min(8, numbered[0].split(".").length)
      : Math.min(4, 1 + indents.indexOf(Math.round(e.bounds[0] / 12)));
    if (indents.length > 6)
      e.level = numbered ? Math.min(8, numbered[0].split(".").length) : 1;
  }
  const hasHeading = rows.some((r) => heading.test(norm(r.text)));
  const density = Math.min(1, unique.length / Math.max(1, rows.length));
  const score = Math.min(
    99,
    (hasHeading ? 45 : 0) +
      Math.min(40, unique.length * 8) +
      Math.round(density * 25),
  );
  const strong = unique.filter((e) => e.confidence >= 75).length;
  const result = {
    page: page.page,
    score,
    selected:
      unique.length >=
        (rows.some((r) => norm(r.text) === "highlights") ? 4 : 2) &&
      score >= 60 &&
      (hasHeading || strong >= unique.length * 0.4),
    hasHeading,
    entries: unique,
    rows: rows.length,
    empty: !page.fragments.length,
  };
  // Upright CJK glyphs often have horizontal text matrices despite being laid
  // out vertically. Compare a second geometric hypothesis for those pages.
  if (
    (!options.direction || options.direction === "auto") &&
    page.fragments.filter((f) => /^[\p{Script=Han}]$/u.test(f.text.trim()))
      .length >= Math.max(6, page.fragments.length * 0.3)
  ) {
    const vertical = recognizeTocPage(page, {
      ...options,
      direction: "vertical",
    });
    if (vertical.entries.length > unique.length && vertical.entries.length >= 2)
      return {
        ...vertical,
        hasHeading: hasHeading || vertical.hasHeading,
        selected: hasHeading || vertical.selected,
      };
  }
  return result;
}

export function resolveTocEntries(
  entries,
  pages,
  pageCount,
  pageLabels = [],
  excludedPages = [],
) {
  const nodes = entries.map((e, i) => ({
    ...makeNode(e.title, 1),
    id: String(i),
    origin: { printedPageLabel: e.printedLabel },
  }));
  const results = calibratePages({
    nodes,
    pages,
    pageCount,
    pageLabels,
    excludedPages,
  });
  const excluded = new Set(excludedPages),
    printed = new Map();
  for (const [p, lines] of Object.entries(pages)) {
    if (excluded.has(+p)) continue;
    for (const l of lines) {
      if (l.top > l.height * 0.12 && l.bottom < l.height * 0.88) continue;
      const label = parsePageLabel(l.text.trim(), {
        alphabetic: entries.some((e) => e.label?.system === "alphabetic"),
      });
      if (label) {
        if (!printed.has(label.key)) printed.set(label.key, new Set());
        printed.get(label.key).add(+p);
      }
    }
  }
  return entries.map((e, i) => {
    const result = results[i],
      candidates = result.candidates.map((c) => ({ ...c, reason: c.kind }));
    const label = e.label || parsePageLabel(e.printedLabel);
    const matches = new Set(label ? printed.get(label.key) || [] : []);
    if (label)
      pageLabels.forEach((v, k) => {
        if (
          parsePageLabel(v, { alphabetic: label.system === "alphabetic" })
            ?.key === label.key &&
          !excluded.has(k + 1)
        )
          matches.add(k + 1);
      });
    for (const p of matches)
      if (!candidates.some((c) => c.page === p))
        candidates.push({
          page: p,
          score: 55,
          reason: "page-label",
          target: { kind: "dest", page: p, mode: "Fit", args: [] },
        });
    // Printed numbers alone are review candidates, never silent destinations.
    return {
      ...e,
      candidates,
      target: result.status === "high" ? candidates[0]?.target : null,
      status: result.status,
      selected: result.status === "high",
      confidence: Math.min(e.confidence, result.confidence),
    };
  });
}

export function entriesToNodes(entries, pageCount) {
  const nodes = [],
    stack = [];
  for (const e of entries.filter((e) => e.selected)) {
    if (!e.title?.trim() || !e.target)
      throw Error("请校准已选条目的标题和实际页码");
    if (!Number.isInteger(e.level) || e.level < 1 || e.level > 8)
      throw Error("层级应为 1–8");
    const level = Math.min(e.level, stack.length + 1);
    stack.length = level - 1;
    const n = makeNode(e.title.trim(), e.target.page, stack.at(-1) || null);
    n.target = structuredClone(e.target);
    n.origin = {
      type: "smart-toc",
      sourcePage: e.sourcePage,
      printedPageLabel: e.printedLabel,
    };
    nodes.push(n);
    stack.push(n.id);
  }
  return validate(nodes, pageCount);
}
export { calibrationLines };
