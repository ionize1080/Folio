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
    .replace(/[\s.·…_—–\-:：*★•⋅]+$/gu, "")
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
  const pageFirst = () => {
    const first = text.match(/^(\p{Nd}{1,6})\s+(.+)$/u);
    if (
      !first ||
      !parsePageLabel(first[1]) ||
      first[2].length < 2 ||
      !/\p{L}/u.test(first[2])
    )
      return null;
    return {
      title: first[2].trim(),
      printedLabel: first[1],
      label: parsePageLabel(first[1]),
      raw: text,
      confidence: 45,
      leading: true,
    };
  };
  const m = ranged.match(endLabel);
  if (!m || m.index === 0) return pageFirst();
  const label = parsePageLabel(m[1], options);
  if (!label) return pageFirst();
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
  if (/[a-z]$/i.test(m[1]) && /[a-z]$/i.test(before)) return pageFirst();
  // Prevent a title ending in a year from becoming a confident entry.
  return {
    title: title.replace(/\s+/gu, " "),
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
    // A running title followed by the current folio is not a contents entry.
    if (
      page.height &&
      row.top < page.height * 0.08 &&
      value.confidence < 75 &&
      value.label?.value === page.page
    )
      return;
    const content = row.items.find((f) => /\p{L}/u.test(f.text));
    const links = (page.links || []).filter((link) => {
      const b = link.bounds;
      const overlap = Math.max(
        0,
        Math.min(row.bottom, b[3]) - Math.max(row.top, b[1]),
      );
      return (
        overlap >= Math.min(row.bottom - row.top, b[3] - b[1]) * 0.6 &&
        Math.max(row.left, b[0]) < Math.min(row.right, b[2])
      );
    });
    const targets = [
      ...new Map(
        links.map((l) => [JSON.stringify(l.target), l.target]),
      ).values(),
    ];
    entries.push({
      ...value,
      ...extra,
      ocrEvidence: indices
        .flatMap((i) => rows[i].items)
        .filter((f) => f.source === "OCR")
        .map((f) => ({
          confidence: f.confidence,
          needsReview: f.needsReview,
          diagnostic: f.diagnostic,
          reviewed: f.reviewed,
        })),
      sourcePage: page.page,
      bounds: [row.left, row.top, row.right, row.bottom],
      angle: row.angle,
      fontHeight: row.h,
      indent: content ? Math.min(...box(content).map((p) => p[0])) : row.left,
      linkedTarget: targets.length === 1 ? targets[0] : null,
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

// Analyse pages together: recurring marginal text and hierarchy are document
// properties, not independent guesses for each continuation page.
export function recognizeTocPages(pages, options = {}) {
  const marginal = new Map();
  const key = (row, page) =>
    norm(row.text.replace(/\s*\p{Nd}+\s*$/u, "")) +
    ":" +
    Math.round((row.top / page.height) * 40);
  const rowsByPage = pages.map((p) => tocRows(p.fragments, options));
  pages.forEach((page, i) =>
    rowsByPage[i].forEach((row) => {
      if (
        !page.height ||
        heading.test(norm(row.text)) ||
        (row.top >= page.height * 0.085 && row.bottom <= page.height * 0.93)
      )
        return;
      const k = key(row, page);
      if (!marginal.has(k)) marginal.set(k, new Set());
      marginal.get(k).add(page.page);
    }),
  );
  const results = pages.map((page, i) => {
    const removed = new Set();
    for (const row of rowsByPage[i]) {
      if (
        page.height &&
        (row.top < page.height * 0.085 || row.bottom > page.height * 0.93) &&
        !heading.test(norm(row.text)) &&
        (marginal.get(key(row, page))?.size || 0) >= 3
      )
        row.items.forEach((f) => removed.add(f.quad));
    }
    const result = recognizeTocPage(
      {
        ...page,
        fragments: page.fragments.filter((f) => !removed.has(f.quad)),
      },
      options,
    );
    result.auxiliary = rowsByPage[i].some((r) =>
      /^(list of (examples|figures|tables)|图表目录|插图目录|表格目录)$/iu.test(
        r.text.trim(),
      ),
    );
    if (result.auxiliary) result.selected = false;
    return result;
  });
  let group = [];
  const finish = () => {
    const values = group
      .flatMap((r) => r.entries)
      .filter((e) => Math.abs(e.angle) < 5);
    const chapterRows = values.filter((e) => /^\d{1,3}\s+\p{L}/u.test(e.title));
    // A two-digit chapter number may share a PDF text fragment with its title,
    // unlike one-digit chapters. Align those fragments to the same heading tier.
    if (chapterRows.length >= 2) {
      const anchor = Math.max(...chapterRows.map((e) => e.indent));
      for (const e of chapterRows)
        if (anchor - e.indent <= e.fontHeight * 2.5) e.indent = anchor;
    }
    const indents = [];
    for (const x of values.map((e) => e.indent).sort((a, b) => a - b)) {
      if (!indents.length || x - indents.at(-1) > 7) indents.push(x);
    }
    if (indents.length <= 6)
      for (const e of values) {
        const numbered = e.title.match(/^\d+(?:\.\d+)+/);
        e.level = numbered
          ? Math.min(8, numbered[0].split(".").length)
          : 1 + indents.findIndex((x) => Math.abs(x - e.indent) <= 7);
      }
    group = [];
  };
  for (const r of results) {
    if (
      group.length &&
      (r.page !== group.at(-1).page + 1 ||
        r.auxiliary !== group.at(-1).auxiliary ||
        !r.selected)
    )
      finish();
    if (r.selected || r.auxiliary) group.push(r);
  }
  finish();
  return results;
}

export function resolveTocEntries(
  entries,
  pages,
  pageCount,
  pageLabels = [],
  excludedPages = [],
) {
  const nodes = entries.map((e, i) => ({
    ...makeNode(e.title.replace(/^\d+(?:\.\d+)*\s+/u, ""), 1),
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
    // Internal links are useful evidence, but still require an independent
    // title match on their destination page. Conflicting links remain reviewable.
    const linked = e.linkedTarget;
    const verifiedLink =
      linked &&
      result.status === "high" &&
      result.candidates[0]?.page === linked.page;
    if (
      linked &&
      linked.page >= 1 &&
      linked.page <= pageCount &&
      !excluded.has(linked.page)
    )
      candidates[verifiedLink ? "unshift" : "push"]({
        page: linked.page,
        score: verifiedLink ? 98 : 60,
        reason: verifiedLink ? "verified-link" : "pdf-link",
        target: linked,
      });
    const entryReady =
      e.confidence >= 75 &&
      !e.needsReview &&
      !(e.ocrEvidence || []).some(
        (o) =>
          !o.reviewed &&
          (o.needsReview ||
            o.diagnostic?.reasons?.length ||
            (typeof o.diagnostic === "string" && o.diagnostic.trim()) ||
            !Number.isFinite(o.confidence) ||
            o.confidence < 0.85),
      );
    const high = entryReady && result.status === "high";
    // Printed numbers alone are review candidates, never silent destinations.
    return {
      ...e,
      candidates,
      target: verifiedLink
        ? linked
        : result.status === "high"
          ? result.candidates[0]?.target
          : null,
      status: high
        ? "high"
        : result.status === "high"
          ? "review"
          : result.status,
      recognitionConfidence: e.confidence,
      locationConfidence: result.confidence,
      needsReview: !entryReady,
      selected: !!high,
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
