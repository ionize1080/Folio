// Identity changes invalidate all work launched against an earlier document.
export class DocumentSession {
  constructor() {
    this.id = crypto.randomUUID();
    this.revision = 0;
  }
  replace() {
    this.id = crypto.randomUUID();
    this.revision = 0;
  }
  change() {
    this.revision++;
  }
  capture() {
    return { id: this.id, revision: this.revision };
  }
  current(token) {
    return token.id === this.id && token.revision === this.revision;
  }
  assert(token) {
    if (!this.current(token)) throw Error("文档已变化，本次结果未应用");
  }
}
export function safeJSON(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}
export function readSettings(defaults, text) {
  const value = safeJSON(text, {}),
    out = { ...defaults };
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  const enums = {
    layout: ["single", "continuous", "two", "two-continuous", "horizontal"],
    leftMode: ["full", "narrow", "hidden"],
    rightMode: ["full", "narrow", "hidden"],
    theme: ["light", "dark"],
    whitespaceUnit: ["pt", "mm", "cm", "in"],
  };
  const ranges = {
    undo: [1, 200],
    sidebar: [180, 520],
    inspectorWidth: [220, 520],
    row: [24, 64],
    quality: [1, 4],
  };
  for (const key of Object.keys(defaults)) {
    const v = value[key];
    if (enums[key]) {
      if (enums[key].includes(v)) out[key] = v;
    } else if (ranges[key]) {
      if (typeof v === "number" && Number.isFinite(v))
        out[key] = Math.min(
          ranges[key][1],
          Math.max(ranges[key][0], Math.round(v)),
        );
    } else if (typeof defaults[key] === "boolean") {
      if (typeof v === "boolean") out[key] = v;
    } else if (
      key === "shortcuts" &&
      v &&
      typeof v === "object" &&
      !Array.isArray(v)
    ) {
      out[key] = Object.fromEntries(
        Object.entries(v).filter(
          ([k, x]) =>
            k.length < 80 &&
            typeof x === "string" &&
            x.length < 80 &&
            !["__proto__", "constructor", "prototype"].includes(k),
        ),
      );
    }
  }
  return out;
}
