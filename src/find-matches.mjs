const word = "[\\p{L}\\p{M}\\p{N}_]";

export function findPattern(query, { caseSensitive, wholeWord, useRegex }) {
  const literal = query.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
  let source = useRegex ? query : literal;
  if (wholeWord) source = "(?<!" + word + ")(?:" + source + ")(?!" + word + ")";
  // A lookahead preserves overlapping literal matches and original UTF-16 offsets.
  if (!useRegex) source = "(?=(" + source + "))";
  return new RegExp(source, caseSensitive ? "gu" : "gui");
}

export function* findRanges(text, pattern, literal = false) {
  // matchAll advances empty matches by Unicode code point, including surrogate pairs.
  for (const match of text.matchAll(pattern)) {
    const length = (literal ? match[1] : match[0]).length;
    if (length) yield [match.index, length];
  }
}

export function regexPages(pattern, signal) {
  const worker = new Worker(new URL("./find-worker.mjs", import.meta.url), { type: "module" });
  let pending;
  signal.addEventListener("abort", () => {
    worker.terminate();
    pending?.reject(signal.reason);
  }, { once: true });
  worker.onmessage = event => pending?.resolve(event.data);
  worker.onerror = event => pending?.reject(new Error(event.message));
  return async (text, limit) => {
    signal.throwIfAborted();
    let timer;
    try {
      return await new Promise((resolve, reject) => {
        pending = { resolve, reject };
        timer = setTimeout(() => reject(new Error("正则表达式运行超时")), 2000);
        worker.postMessage({ pattern, text, limit });
      });
    } finally {
      clearTimeout(timer);
      pending = null;
    }
  };
}
