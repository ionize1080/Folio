// Immutable edit versions are shared by live state and history; large fragments
// are never serialized into each history record or dirty-state comparison.
const frozen = new WeakSet(),
  identities = new WeakMap(),
  sizes = new WeakMap();
export function immutableEdits(value = []) {
  if (frozen.has(value)) return value;
  function freeze(v) {
    if (!v || typeof v !== "object" || frozen.has(v)) return;
    for (const x of Object.values(v)) freeze(x);
    Object.freeze(v);
    frozen.add(v);
  }
  freeze(value);
  return value;
}
export function editIdentity(value) {
  immutableEdits(value);
  if (!identities.has(value)) identities.set(value, crypto.randomUUID());
  return identities.get(value);
}
export function editBytes(value) {
  if (!value) return 0;
  if (!sizes.has(value)) {
    // Count the retained representation. Base64 text is not decoded by history.
    const walk = (v) =>
      typeof v === "string"
        ? v.length * 2
        : !v || typeof v !== "object"
          ? 8
          : Object.entries(v).reduce(
              (n, [k, x]) => n + k.length * 2 + walk(x),
              32,
            );
    sizes.set(value, walk(value));
  }
  return sizes.get(value);
}
export class EditAssets {
  constructor() {
    this.values = new Map();
  }
  put(value) {
    const id = editIdentity(value);
    this.values.set(id, value);
    return id;
  }
  get(id) {
    if (!this.values.has(id)) throw Error("撤销资源缺失");
    return this.values.get(id);
  }
  retain(ids) {
    const live = new Set(ids);
    for (const id of this.values.keys())
      if (!live.has(id)) this.values.delete(id);
  }
  bytes(ids) {
    const versions = [...new Set(ids)]
      .map((id) => this.values.get(id))
      .filter(Boolean);
    return (
      versions.length * 32 +
      [...new Set(versions.flat())].reduce((n, edit) => n + editBytes(edit), 0)
    );
  }
}
