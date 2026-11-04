(() => {
  const original = window.fetch.bind(window),
    pending = new Map();
  window.folioTransport.subscribe((m) => {
    const state = pending.get(m.id);
    if (!state) return;
    if (m.error) {
      state.cleanup?.();
      state.error = Error(m.error);
      state.controller?.error(state.error);
      pending.delete(m.id);
    } else if (m.done) {
      state.cleanup?.();
      state.done = true;
      state.controller?.close();
      pending.delete(m.id);
    } else {
      const bytes = Uint8Array.from(atob(m.data), (c) => c.charCodeAt(0));
      if (state.controller) state.controller.enqueue(bytes);
      else state.chunks.push(bytes);
    }
  });
  window.fetch = async (input, init = {}) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    // Provider requests only. Keep Chatbox's ordinary web and asset requests intact.
    if (
      !/^https?:/.test(url) ||
      !(
        /\/(chat\/completions|responses|messages)(?:[?/#]|$)/.test(url) ||
        /:streamGenerateContent|:generateContent/.test(url)
      )
    )
      return original(input, init);
    const id = crypto.randomUUID(),
      state = { chunks: [] };
    pending.set(id, state);
    const signal = init.signal;
    const abort = () => window.folioTransport.cancel(id);
    if (signal?.aborted) {
      pending.delete(id);
      throw new DOMException("Aborted", "AbortError");
    }
    signal?.addEventListener("abort", abort, { once: true });
    state.cleanup = () => signal?.removeEventListener("abort", abort);
    try {
      const result = await window.folioTransport.start({
        id,
        url,
        method: init.method || "POST",
        headers: [...new Headers(init.headers)],
        body: init.body,
      });
      const stream = new ReadableStream({
        start(controller) {
          state.controller = controller;
          if (state.error) return controller.error(state.error);
          for (const c of state.chunks) controller.enqueue(c);
          state.chunks = [];
          if (state.done) controller.close();
        },
        cancel() {
          abort();
          pending.delete(id);
        },
      });
      return new Response(stream, result);
    } catch (error) {
      pending.delete(id);
      signal?.removeEventListener("abort", abort);
      throw error;
    }
  };
})();
