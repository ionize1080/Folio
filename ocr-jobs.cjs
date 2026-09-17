const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto");
const { NativeBridge } = require("./native-bridge.cjs");
const { Converter } = require("opencc-js");
const toSimple = Converter({ from: "tw", to: "cn" }),
  toTraditional = Converter({ from: "cn", to: "tw" });
const GB = 1024 ** 3;
function resourcePlan(
  { mode = "auto", workers = 1, threads = 2 },
  free = os.freemem(),
  cores = os.availableParallelism?.() || os.cpus().length,
  measured = 1.8 * GB,
) {
  const reserve = Math.max(
    1.2 * GB,
    os.totalmem() * (mode === "high" ? 0.08 : 0.12),
  );
  const t =
    mode === "custom"
      ? Math.max(1, Math.min(cores, Math.floor(+threads) || 1))
      : Math.min(2, cores);
  const desired =
    mode === "low"
      ? 1
      : mode === "custom"
        ? Math.max(1, Math.min(16, +workers || 1))
        : Math.min(
            8,
            Math.max(1, Math.floor((cores - (mode === "high" ? 0 : 2)) / t)),
          );
  const byMemory = Math.max(
    1,
    Math.floor(Math.max(0, free - reserve) / Math.max(0.75 * GB, measured)),
  );
  return {
    workers: Math.min(desired, byMemory, Math.max(1, Math.floor(cores / t))),
    desired,
    threads: t,
    cores,
    freeGB: +(free / GB).toFixed(2),
    memoryLimited: byMemory < desired,
    reserveGB: reserve / GB,
  };
}
function normalizeBlocks(
  blocks,
  {
    outputScript = "preserve",
    languages = ["zh-Hans", "en"],
    allowOther = true,
  } = {},
) {
  return blocks.map((b, i) => {
    const raw = b.rawText ?? b.text;
    const simple = toSimple(raw),
      traditional = toTraditional(raw);
    const mismatch =
      (languages.includes("zh-Hans") &&
        !languages.includes("zh-Hant") &&
        simple !== raw) ||
      (languages.includes("zh-Hant") &&
        !languages.includes("zh-Hans") &&
        traditional !== raw);
    const text =
      outputScript === "simplified"
        ? simple
        : outputScript === "traditional"
          ? traditional
          : raw;
    return {
      ...b,
      id: b.id || `${b.page}:${i}`,
      rawText: raw,
      text,
      normalized: text !== raw,
      scriptIssue: outputScript === "preserve" && mismatch,
      languageReview: !allowOther && mismatch,
    };
  });
}
class OCRJobs {
  constructor(root, store, python) {
    this.root = root;
    this.store = store;
    this.python = python;
    this.job = null;
    this.references = new Map();
    this.commandChain = Promise.resolve();
  }
  async stop() {
    const j = this.job;
    if (!j) return;
    j.stopped = true;
    clearTimeout(j.timer);
    for (const w of j.pool.values()) w.bridge.cancel();
    await j.completion;
    j.running = false;
  }
  async start(args) {
    await this.stop();
    return this.startJob(args);
  }
  async startJob({
    bytes,
    pages,
    profile = "v6",
    dpi = 180,
    skipText = true,
    skipMode = "coverage",
    region = null,
    mode = "auto",
    workers = 1,
    threads = 2,
    batch = 6,
    resume = true,
    languages = ["zh-Hans", "en"],
    allowOther = true,
    outputScript = "preserve",
  }) {
    if (
      !bytes ||
      bytes.length > 768 * 1024 ** 2 ||
      !Array.isArray(pages) ||
      !pages.length ||
      pages.length > 100000 ||
      pages.some((p) => !Number.isInteger(p) || p < 1)
    )
      throw Error("OCR 文档或页码无效");
    if (!["v5", "v6"].includes(profile) || ![180, 240, 300].includes(+dpi))
      throw Error("OCR 参数无效");
    if (
      region &&
      (!Array.isArray(region) ||
        region.length !== 4 ||
        region.some((v) => !Number.isFinite(v) || v < 0 || v > 1) ||
        region[2] <= 0 ||
        region[3] <= 0 ||
        region[0] + region[2] > 1 ||
        region[1] + region[3] > 1)
    )
      throw Error("OCR 区域无效");
    const data = Buffer.from(bytes),
      options = {
        profile,
        dpi: +dpi,
        skipText: !!skipText,
        skipMode: skipMode === "any" ? "any" : "coverage",
        region,
        batch: Math.max(1, Math.min(32, +batch || 6)),
      };
    // Recognition caches raw text. Display/normalization preferences do not invalidate costly inference.
    const engineHash = crypto
      .createHash("sha256")
      .update(await fs.readFile(path.join(this.root, "runtime-lock.json")))
      .update(await fs.readFile(path.join(this.root, "worker.py")))
      .update(await fs.readFile(path.join(this.root, "models/manifest.json")))
      .digest("hex");
    const id = crypto
        .createHash("sha256")
        .update(data)
        .update(JSON.stringify(options))
        .update(engineHash)
        .digest("hex"),
      dir = path.join(this.store, id),
      input = path.join(dir, "input.pdf");
    await fs.mkdir(dir, { recursive: true });
    try {
      await fs.access(input);
    } catch {
      await fs.writeFile(input, data);
    }
    const unique = [...new Set(pages)].sort((a, b) => a - b),
      done = [],
      pending = [],
      states = new Map();
    for (const page of unique) {
      try {
        if (!resume) throw Error();
        const r = JSON.parse(
          await fs.readFile(path.join(dir, `${page}.json`), "utf8"),
        );
        if (
          r.schema !== 5 ||
          r.page !== page ||
          r.document !== id ||
          !Array.isArray(r.blocks)
        )
          throw Error();
        done.push(page);
        states.set(page, this.pageSummary(page, r));
      } catch {
        pending.push(page);
        states.set(page, { page, state: "pending" });
      }
    }
    const plan = resourcePlan({ mode, workers, threads });
    plan.workers = Math.min(plan.workers, Math.max(1, pending.length));
    let resolve;
    const j = (this.job = {
      id,
      dir,
      input,
      options,
      prefs: { languages, allowOther, outputScript },
      pages: unique,
      done,
      failed: [],
      pending,
      states,
      events: [],
      revision: 0,
      pool: new Map(),
      serial: 0,
      stopped: false,
      running: true,
      active: new Set(),
      started: Date.now(),
      plan,
      restored: done.length,
      timings: {},
      recent: [],
      pressure: false,
      lastExpansion: 0,
      samples: [],
      config: { mode, workers, threads },
      completion: new Promise((r) => (resolve = r)),
      finish: () => resolve(),
    });
    j.tasks = [j.completion];
    await fs.writeFile(
      path.join(dir, "task.json"),
      JSON.stringify({
        schema: 5,
        id,
        options,
        pages: unique,
        created: Date.now(),
        bytes: data.length,
      }),
    );
    this.pump(j);
    return this.status();
  }
  pageSummary(page, r) {
    return {
      page,
      state: r.skipped ? "skipped" : "done",
      count: r.blocks.length,
      low: r.blocks.filter(
        (b) => !b.excluded && b.confidence < 0.85 && !b.corrected,
      ).length,
      corrected: r.blocks.filter((b) => b.corrected).length,
      reason: r.skipped ? "检测到已有文字，可选此页强制重识别" : undefined,
    };
  }
  event(j, value) {
    j.states.set(value.page, value);
    j.events.push({ ...value, revision: ++j.revision });
    if (j.events.length > 3000) j.events.splice(0, 1000);
  }
  pump(j) {
    if (j !== this.job) return;
    clearTimeout(j.timer);
    if ((j.stopped || !j.pending.length) && j.pool.size === 0) {
      j.running = false;
      j.finishedAt = Date.now();
      j.finish();
      return;
    }
    if (j.stopped) return;
    const free = os.freemem(),
      low = free < 1.2 * GB;
    j.pressure = low;
    const measured = j.samples.length
      ? Math.max(...j.samples.slice(-24)) + 0.3 * GB
      : 1.8 * GB;
    // Account for already resident workers when estimating total sustainable concurrency.
    const plan = resourcePlan(
      j.config,
      free + j.pool.size * measured,
      undefined,
      measured,
    );
    const target = low
      ? 1
      : Math.min(plan.workers, j.pending.length + j.pool.size);
    j.target = target;
    j.measured = measured;
    j.plan.memoryLimited = target < j.plan.desired;
    const room = Math.floor(
      Math.max(0, free - j.plan.reserveGB * GB) / measured,
    );
    const mayGrow =
      j.pool.size === 0 || (Date.now() - j.lastExpansion > 2500 && room > 0);
    if (j.pending.length && j.pool.size < target && mayGrow) {
      // Initial measured-free budget allows planned workers; later growth is gradual.
      const count =
        j.serial === 0 ? Math.min(j.plan.workers, j.pending.length) : 1;
      for (let n = 0; n < count; n++) this.launch(j);
      j.lastExpansion = Date.now();
    }
    if (j.running) j.timer = setTimeout(() => this.pump(j), 500);
  }
  launch(j) {
    const id = j.serial++,
      bridge = new NativeBridge(this.root, this.python),
      w = { bridge, id };
    j.pool.set(id, w);
    (async () => {
      try {
        while (!j.stopped && j.pending.length) {
          if (
            j.pool.size > 1 &&
            (os.freemem() < 1.2 * GB ||
              j.pool.size > (j.target || j.plan.workers))
          )
            break;
          const page = j.pending.shift();
          j.active.add(page);
          this.event(j, { page, state: "running" });
          const started = Date.now();
          try {
            const r = await bridge.request({
              command: "ocr",
              input: j.input,
              page,
              ...j.options,
              threads: j.plan.threads,
            });
            if (j.stopped) break;
            r.schema = 5;
            r.page = page;
            r.document = j.id;
            r.blocks = r.blocks.map((b, i) => ({
              ...b,
              id: `${page}:${i}`,
              rawText: b.text,
            }));
            await this.writePage(j, page, r);
            j.done.push(page);
            this.event(j, this.pageSummary(page, r));
            const wallSeconds = (Date.now() - started) / 1000;
            j.timings[page] = { wallSeconds, ...r.timing };
            if (!r.skipped)
              j.recent.push({
                at: Date.now(),
                started,
                seconds: wallSeconds,
                cold: (r.timing?.load || 0) > 0.2,
              });
            if (j.recent.length > 60) j.recent.shift();
            if (r.rss) j.samples.push(r.rss);
            if (j.samples.length > 100) j.samples.shift();
          } catch (e) {
            if (!j.stopped) {
              j.failed.push({ page, error: e.message });
              this.event(j, { page, state: "failed", error: e.message });
            }
          } finally {
            j.active.delete(page);
          }
        }
      } finally {
        bridge.cancel();
        j.pool.delete(id);
        this.pump(j);
      }
    })().catch((e) => {
      j.failed.push({ page: 0, error: e.message });
      j.stopped = true;
      this.pump(j);
    });
  }
  async writePage(j, page, r) {
    const tmp = path.join(j.dir, `${page}.${crypto.randomUUID()}.tmp`);
    await fs.writeFile(tmp, JSON.stringify(r));
    await fs.rename(tmp, path.join(j.dir, `${page}.json`));
  }
  status({ since, details = false } = {}) {
    const j = this.job;
    if (!j) return null;
    const now = j.finishedAt || Date.now(),
      recent = j.recent.filter((r) => now - r.at < 60000 && !r.cold);
    const seconds = recent.length
      ? (now -
          Math.max(now - 60000, Math.min(...recent.map((r) => r.started)))) /
        1000
      : 0;
    const active = j.pool.size;
    const rate = seconds > 0 ? (recent.length / seconds) * 60 : 0;
    const counts = { pending: 0, running: 0, done: 0, skipped: 0, failed: 0 };
    for (const s of j.states.values())
      counts[s.state] = (counts[s.state] || 0) + 1;
    const full =
      since === undefined || since < (j.events[0]?.revision || 0) - 1;
    return {
      id: j.id,
      total: j.pages.length,
      done: full ? [...j.done].sort((a, b) => a - b) : undefined,
      pages: full ? j.pages : undefined,
      states: full ? [...j.states.values()] : undefined,
      changes: full ? [] : j.events.filter((e) => e.revision > since),
      revision: j.revision,
      failed: j.failed,
      running: j.running,
      stopped: j.stopped,
      active: [...j.active],
      actualWorkers: active,
      targetWorkers: j.target || j.plan.workers,
      plan: j.plan,
      reason: j.pressure
        ? "可用内存偏低，暂减并行"
        : active < (j.target || 1) && j.running
          ? "等待资源稳定后恢复并行"
          : j.plan.memoryLimited
            ? "受可用内存限制"
            : "",
      counts,
      rate,
      eta: rate
        ? Math.ceil(((counts.pending + counts.running) / rate) * 60)
        : null,
      restored: j.restored,
      elapsed: (Date.now() - j.started) / 1000,
      timings: details ? j.timings : undefined,
    };
  }
  async page({ id, page, preferences }) {
    const j = this.job;
    if (!j || id !== j.id || !j.done.includes(page))
      throw Error("识别结果不存在或任务已变化");
    const r = JSON.parse(
      await fs.readFile(path.join(j.dir, `${page}.json`), "utf8"),
    );
    return { ...r, blocks: normalizeBlocks(r.blocks, preferences || j.prefs) };
  }
  async correct({ id, page, blocks }) {
    const j = this.job;
    if (
      !j ||
      id !== j.id ||
      !j.done.includes(page) ||
      !Array.isArray(blocks) ||
      blocks.length > 100000 ||
      blocks.some(
        (b) =>
          b.page !== page ||
          !Array.isArray(b.quad) ||
          b.quad.length !== 4 ||
          b.quad.some(
            (p) => p.length !== 2 || p.some((x) => !Number.isFinite(x)),
          ),
      )
    )
      throw Error("校对页或坐标无效");
    const prior = JSON.parse(
      await fs.readFile(path.join(j.dir, `${page}.json`), "utf8"),
    );
    const r = {
      ...prior,
      blocks: blocks.map((b) => {
        const old = prior.blocks.find((o) => o.id === b.id);
        return {
          ...b,
          originalText:
            b.originalText ?? old?.originalText ?? old?.rawText ?? old?.text,
          rawText:
            b.corrected || b.text !== old?.text
              ? b.text
              : (b.rawText ?? b.text),
        };
      }),
    };
    await this.writePage(j, page, r);
    this.event(j, this.pageSummary(page, r));
    return true;
  }
  async collect({
    id,
    base = [],
    preferences,
    excludeUnsupported = false,
    pages,
  }) {
    const j = id ? this.job : null;
    if (id && (!j || j.id !== id || j.running))
      throw Error("请等待识别停止后应用");
    const selected = id ? pages || j.done : [];
    if (!Array.isArray(selected) || selected.some((p) => !j.done.includes(p)))
      throw Error("应用页范围无效");
    const replaced = new Set(),
      collected = [];
    for (const page of selected) {
      const r = await this.page({ id, page, preferences });
      if (!r.skipped) {
        replaced.add(page);
        collected.push(...r.blocks);
      }
    }
    const blocks = base
      .filter((b) => !replaced.has(b.page))
      .map((b) => ({ ...b }))
      .concat(collected)
      .sort((a, b) => a.page - b.page);
    const allowed = new Set([
      ...JSON.parse(
        await fs.readFile(
          path.join(this.root, "fonts/codepoints.json"),
          "utf8",
        ),
      ),
      ...JSON.parse(
        await fs.readFile(
          path.join(this.root, "fonts/fallback-codepoints.json"),
          "utf8",
        ),
      ),
    ]);
    const issues = [];
    let count = 0,
      cleaned = 0;
    for (const b of blocks) {
      if (b.excluded) continue;
      const missing = [
        ...new Set(
          [...b.text].filter(
            (c) =>
              !allowed.has(c.codePointAt(0)) &&
              !["\n", "\r", "\t", "\u200b", "\ufeff"].includes(c),
          ),
        ),
      ];
      if (missing.length) {
        count++;
        if (issues.length < 200)
          issues.push({
            page: b.page,
            id: b.id,
            text: b.text,
            characters: missing.map(
              (c) => `${c} U+${c.codePointAt(0).toString(16).toUpperCase()}`,
            ),
          });
        if (excludeUnsupported) {
          b.excluded = true;
          b.exclusionReason = "字体缺字";
        }
      }
      cleaned += (b.text.match(/[\u200b\ufeff]/g) || []).length;
    }
    if (count && !excludeUnsupported) return { issues, count, cleaned };
    const reference = crypto.randomUUID(),
      dir = path.join(this.store, "snapshots");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, reference + ".jsonl");
    const h = await fs.open(file, "wx");
    try {
      for (let i = 0; i < blocks.length; i += 250)
        await h.write(
          blocks
            .slice(i, i + 250)
            .map((b) => JSON.stringify(b))
            .join("\n") + "\n",
        );
    } finally {
      await h.close();
    }
    this.references.set(reference, file);
    return { reference, blocks, issues, count, cleaned };
  }
  resolveReference(id) {
    if (typeof id !== "string" || !this.references.has(id))
      throw Error("OCR 结果版本已失效，请重新应用");
    return this.references.get(id);
  }
  async history() {
    await fs.mkdir(this.store, { recursive: true });
    const out = [];
    for (const e of await fs.readdir(this.store, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name === "snapshots") continue;
      try {
        const meta = JSON.parse(
          await fs.readFile(path.join(this.store, e.name, "task.json"), "utf8"),
        );
        const files = await fs.readdir(path.join(this.store, e.name));
        out.push({
          ...meta,
          completed: files.filter((n) => /^\d+\.json$/.test(n)).length,
          bytes: (
            await Promise.all(
              files.map((n) =>
                fs
                  .stat(path.join(this.store, e.name, n))
                  .then((s) => (s.isFile() ? s.size : 0))
                  .catch(() => 0),
              ),
            )
          ).reduce((a, b) => a + b, 0),
          active: e.name === this.job?.id,
        });
      } catch {}
    }
    return out.sort((a, b) => b.created - a.created);
  }
  async remove({ id }) {
    if (!/^[a-f0-9]{64}$/.test(id) || id === this.job?.id)
      throw Error("当前任务不能清理");
    await fs.rm(path.join(this.store, id), { recursive: true, force: true });
    return true;
  }
  async run({ action, ...args }) {
    if (["start", "stop", "correct", "collect", "remove"].includes(action)) {
      const run = () => this.dispatch(action, args);
      const next = this.commandChain.then(run, run);
      this.commandChain = next.catch(() => {});
      return next;
    }
    return this.dispatch(action, args);
  }
  async dispatch(action, args) {
    if (action === "start") return this.start(args);
    if (action === "status") return this.status(args);
    if (action === "stop") {
      await this.stop();
      return this.status();
    }
    if (action === "page") return this.page(args);
    if (action === "correct") return this.correct(args);
    if (action === "collect") return this.collect(args);
    if (action === "history") return this.history();
    if (action === "remove") return this.remove(args);
    throw Error("未知 OCR 操作");
  }
}
module.exports = { OCRJobs, resourcePlan, normalizeBlocks };
