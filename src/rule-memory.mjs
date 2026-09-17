// Persist parameters, never document object IDs or computed previews.
export class RuleMemory {
  constructor(storage, documentKey, namespace = "batch") {
    this.storage = storage;
    this.key = `folio-rule-memory-v1-${namespace}`;
    this.documentKey = documentKey || "unsaved";
    try { this.data = JSON.parse(storage.getItem(this.key) || "null"); } catch {}
    if (this.data?.schema !== 1 || !this.data.latest || !this.data.documents || !Array.isArray(this.data.history)) this.data = { schema: 1, latest: {}, documents: {}, history: [] };
  }
  get(operation) { return this.data.documents[this.documentKey]?.[operation] || this.data.latest[operation] || null; }
  lastOperation() { return this.data.operation || "replace"; }
  remember(operation, values) {
    const copy = structuredClone(values);
    this.data.operation = operation;
    this.data.latest[operation] = copy;
    this.data.documents[this.documentKey] ||= {};
    this.data.documents[this.documentKey][operation] = copy;
    const keys = Object.keys(this.data.documents);
    while (keys.length > 20) delete this.data.documents[keys.shift()];
    this.persist();
  }
  record(operation, values, name = "") {
    this.remember(operation, values);
    const item = { operation, values: structuredClone(values), name: name.slice(0, 80), time: Date.now() };
    this.data.history = [item, ...this.data.history.filter(x => JSON.stringify([x.operation,x.values,x.name]) !== JSON.stringify([operation,values,item.name]))].slice(0, 20);
    this.persist();
  }
  clearHistory() { this.data.history = []; this.persist(); }
  persist() { try { this.storage.setItem(this.key, JSON.stringify(this.data)); } catch {} }
}

export function captureFields(root) {
  return Object.fromEntries([...root.querySelectorAll("input,select,textarea")].map(e => [
    e.id || (e.dataset.parameter != null ? `parameter:${e.dataset.parameter}` : `value:${e.dataset.paramValue}`),
    e.type === "checkbox" ? e.checked : e.value,
  ]));
}
export function restoreFields(root, values) {
  for (const e of root.querySelectorAll("input,select,textarea")) {
    const key = e.id || (e.dataset.parameter != null ? `parameter:${e.dataset.parameter}` : `value:${e.dataset.paramValue}`);
    if (!Object.hasOwn(values || {}, key)) continue;
    if (e.type === "checkbox") e.checked = values[key] === true;
    else if (typeof values[key] === "string") e.value = values[key];
  }
}
