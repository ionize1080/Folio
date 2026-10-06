import { parsePageLabel, samePageLabel } from "./page-labels.mjs";
import { appendLine } from "./line-geometry.mjs";
import { clone, validate } from "./model.mjs";

const norm = (text) =>
  String(text || "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\s\p{P}\p{Cf}]/gu, "");
const finitePoint = (p) =>
  Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const margin = (l) => l.top < l.height * 0.08 || l.bottom > l.height * 0.92;
function similarity(a, b) {
  if (a === b) return 1;
  if (
    Math.min(a.length, b.length) < 6 ||
    Math.max(a.length, b.length) > 256 ||
    Math.min(a.length, b.length) / Math.max(a.length, b.length) < 0.8
  )
    return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(
        next[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    prev = next;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}
function leaderEntry(text) {
  const m = text.match(/(?:\.{2,}|…+|·{2,}|\s{2,})([^\n]+)$/u);
  return !!m && !!parsePageLabel(m[1].trim());
}
// Keep originals as well as joined alternatives; never replace original lines
// with a guessed paragraph. Do not join across a column or page boundary.
export function calibrationLines(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    let joined = lines[i];
    out.push(joined);
    for (let j = 1; j <= 2 && i + j < lines.length; j++) {
      const next = lines[i + j];
      if (
        next.page !== joined.page ||
        Math.abs(next.left - lines[i].left) > 15 ||
        next.top < joined.bottom - 2 ||
        next.top - joined.bottom > 20 ||
        leaderEntry(joined.text)
      )
        break;
      joined = appendLine(joined, next);
      out.push({ ...joined, joined: true });
    }
  }
  return out;
}
function candidateFor(
  n,
  l,
  title,
  printedLabel,
  labels,
  footers,
  headers,
  offset,
) {
  const text = norm(l.text),
    at = text.indexOf(title);
  let kind, score;
  if (text === title) {
    kind = "exact";
    score = 88;
  } else if (at >= 0) {
    kind = "contains";
    score = 40 + Math.round((20 * title.length) / Math.max(1, text.length));
  } else if (similarity(title, text) >= 0.84) {
    kind = "fuzzy";
    score = 70;
  } else return null;
  const point = l.segments?.find(
    (s) => norm(l.text.slice(0, s.end)).length > Math.max(0, at),
  )?.point || [l.x, l.y];
  if (!finitePoint(point)) return null;
  const evidence = [kind],
    warnings = [];
  if (title.length < 4) {
    score = Math.min(score, 64);
    warnings.push("short-title");
  }
  if (leaderEntry(l.text)) {
    score = Math.min(score, 40);
    warnings.push("toc-like");
  }
  if (margin(l)) {
    score -= 8;
    warnings.push("page-margin");
    if ((headers.get(text)?.size || 0) >= 3) {
      score = Math.min(score, 35);
      warnings.push("repeated-header");
    }
  }
  if (printedLabel) {
    const label = labels[l.page - 1];
    const footer = (footers.get(l.page) || []).some((s) =>
      samePageLabel(printedLabel, s),
    );
    if (samePageLabel(printedLabel, label)) {
      score += 6;
      evidence.push("page-label");
    }
    if (footer) {
      score += 8;
      evidence.push("printed-label");
    }
    if (label && parsePageLabel(label) && !samePageLabel(printedLabel, label))
      warnings.push("label-differs");
  }
  if (l.source === "OCR") {
    score -= 3;
    evidence.push("ocr");
  }
  if (l.joined) evidence.push("joined-lines");
  const zoom = n.target?.mode === "XYZ" ? (n.target.args?.[2] ?? null) : null;
  return {
    page: l.page,
    rankScore: score,
    score: Math.max(0, Math.min(98, score)),
    kind,
    text: l.text,
    top: l.top,
    source: l.source || "PDF",
    evidence,
    warnings,
    segments: l.segments || [],
    target: {
      kind: "dest",
      page: l.page,
      mode: "XYZ",
      args: [
        point[0] + (l.upX || 0) * offset,
        point[1] + (l.upY ?? 1) * offset,
        zoom,
      ],
    },
  };
}
// Independent global matching. Neither the current destination nor other rows'
// offsets constrain the search, ranking, or eligibility of any candidate.
// Confidence is a conservative rule score, NOT a calibrated probability.
export function calibratePages({
  nodes,
  pages,
  pageCount,
  pageLabels = [],
  excludedPages = [],
  offset = 14.1732283465,
  maxCandidates = 8,
}) {
  if (
    !Number.isInteger(pageCount) ||
    pageCount < 1 ||
    !Number.isFinite(offset) ||
    Math.abs(offset) > 3000
  )
    throw Error("Invalid calibration settings");
  const excluded = new Set(excludedPages),
    lines = [],
    headers = new Map(),
    footers = new Map();
  for (const [key, items] of Object.entries(pages)) {
    const page = +key;
    if (
      excluded.has(page) ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > pageCount
    )
      continue;
    for (const l of items) {
      if (
        !l.text?.trim() ||
        ![l.top, l.bottom, l.height].every(Number.isFinite)
      )
        continue;
      const item = { ...l, page };
      lines.push(item);
      if (margin(item)) {
        const t = norm(l.text);
        if (!headers.has(t)) headers.set(t, new Set());
        headers.get(t).add(page);
        if (parsePageLabel(l.text.trim())) {
          if (!footers.has(page)) footers.set(page, []);
          footers.get(page).push(l.text.trim());
        }
      }
    }
  }
  // Exact matches use an index; the bounded fuzzy fallback only visits lines
  // with compatible lengths. Work runs in a cancellable Web Worker.
  const byLength = new Map();
  for (const l of lines) {
    const len = norm(l.text).length;
    if (!byLength.has(len)) byLength.set(len, []);
    byLength.get(len).push(l);
  }
  const results = [];
  for (const n of nodes) {
    const title = norm(n.title),
      label = n.origin?.printedPageLabel || "",
      candidates = [];
    if (title) {
      // Include longer lines to expose body mentions rather than treating them
      // as independent headings. The timeout is an explicit resource limit.
      for (const [len, bucket] of byLength) {
        if (len < Math.floor(title.length * 0.8)) continue;
        for (const l of bucket) {
          const c = candidateFor(
            n,
            l,
            title,
            label,
            pageLabels,
            footers,
            headers,
            offset,
          );
          if (c) candidates.push(c);
        }
      }
    }
    candidates.sort(
      (a, b) => b.rankScore - a.rankScore || a.page - b.page || a.top - b.top,
    );
    const unique = [];
    for (const c of candidates) {
      if (
        unique.some(
          (u) =>
            u.page === c.page &&
            Math.hypot(
              u.target.args[0] - c.target.args[0],
              u.target.args[1] - c.target.args[1],
            ) < 2,
        )
      )
        continue;
      unique.push(c);
      if (unique.length >= Math.max(2, maxCandidates)) break;
    }
    const best = unique[0],
      gap = best ? best.rankScore - (unique[1]?.rankScore ?? 0) : 0;
    const ambiguous = !!unique[1] && gap < 12;
    const confidence = best ? Math.min(best.score, ambiguous ? 69 : 98) : 0;
    const high =
      !!best &&
      best.kind === "exact" &&
      confidence >= 85 &&
      !ambiguous &&
      !best.warnings.some((w) =>
        ["short-title", "toc-like", "repeated-header", "page-margin"].includes(
          w,
        ),
      );
    results.push({
      id: n.id,
      title: n.title,
      before: clone(n.target),
      printedLabel: label,
      candidates: unique,
      confidence,
      status: !best
        ? "unmatched"
        : ambiguous
          ? "ambiguous"
          : high
            ? "high"
            : "review",
      recommended: high ? 0 : -1,
      delta:
        best && Number.isInteger(n.target?.page)
          ? best.page - n.target.page
          : null,
    });
  }
  return results;
}

export function applyPageCalibration(nodes, results, choices, pageCount) {
  const out = clone(nodes),
    map = new Map(out.map((n) => [n.id, n]));
  let count = 0;
  for (const row of results) {
    const choice = choices.get(row.id),
      n = map.get(row.id);
    if (choice === undefined || choice === -1) continue;
    if (
      !n ||
      JSON.stringify(n.target) !== JSON.stringify(row.before) ||
      n.title !== row.title
    )
      throw Error("Calibration preview is stale");
    const target =
      typeof choice === "object" ? choice : row.candidates[choice]?.target;
    if (!target) throw Error("Invalid calibration choice");
    n.target = clone(target);
    count++;
  }
  return { nodes: validate(out, pageCount), count };
}
