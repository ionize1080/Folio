// Page previews share the unchanged document. A full PDF is materialized only
// for save/export, and its bytes are tied to this immutable edit revision.
const versions = new WeakMap();

export function pagePreview(previous, pageKeys, renderPage, materialize) {
  let old = versions.get(previous);
  if (!old) {
    old = { root: { pdf: previous, refs: 1 }, pages: new Map() };
    versions.set(previous, old);
  }
  const root = old.root;
  root.refs++;
  const state = { root, pages: new Map(), closed: false, bytes: null };
  for (const [number, entry] of old.pages) {
    if (pageKeys.get(number) === entry.key) {
      entry.refs++;
      state.pages.set(number, entry);
    }
  }
  const methods = {
    async getPage(number) {
      if (state.closed) throw Error("页面预览已关闭");
      if (!pageKeys.has(number)) return root.pdf.getPage(number);
      let entry = state.pages.get(number);
      if (!entry) {
        entry = { key: pageKeys.get(number), refs: 1 };
        entry.promise = Promise.resolve().then(() => renderPage(number));
        state.pages.set(number, entry);
      }
      const doc = await entry.promise;
      if (state.closed) throw Error("页面预览已关闭");
      const page = await doc.getPage(1);
      return new Proxy(page, {
        get(target, property) {
          if (property === "pageNumber") return number;
          // Cross-page destinations belong to the original document.
          if (property === "getAnnotations")
            return async (...args) =>
              (await root.pdf.getPage(number)).getAnnotations(...args);
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
    async getData() {
      if (state.closed) throw Error("页面预览已关闭");
      state.bytes ||= Promise.resolve()
        .then(materialize)
        .catch((error) => {
          state.bytes = null;
          throw error;
        });
      return new Uint8Array(await state.bytes).slice();
    },
    destroy() {
      return disposePreview(proxy);
    },
  };
  const proxy = new Proxy(root.pdf, {
    get(target, property) {
      if (property in methods) return methods[property];
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  versions.set(proxy, state);
  return proxy;
}

export async function disposePreview(pdf) {
  const state = versions.get(pdf);
  if (!state) return pdf.destroy();
  if (state.closed) return;
  state.closed = true;
  const pending = [];
  for (const entry of state.pages.values()) {
    if (--entry.refs === 0)
      pending.push(
        entry.promise.then(
          (doc) => doc.destroy(),
          () => {},
        ),
      );
  }
  state.pages.clear();
  if (--state.root.refs === 0) pending.push(state.root.pdf.destroy());
  await Promise.all(pending);
}
