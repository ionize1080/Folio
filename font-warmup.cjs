const os = require('node:os');
const { NativeBridge } = require('./native-bridge.cjs');

// One background process, one small work unit at a time. Foreground work
// preempts it; atomic disk mappings survive cancellation and process recycling.
class FontWarmup {
  constructor(root, python, sources, { bridge, idleMs = 1800 } = {}) {
    this.sources = sources;
    this.bridge = bridge || new NativeBridge(root, python);
    this.bridge.priority = os.constants.priority.PRIORITY_LOW;
    this.bridge.environment = { OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1' };
    this.idleMs = idleMs;
    this.jobs = new Map();
    this.active = null;
    this.timer = null;
    this.foreground = 0;
    this.closed = false;
    this.generation = 0;
    this.seen = new Set();
  }
  add(handle, page = 1) {
    if (this.closed) return { queued: false };
    if (!this.jobs.has(handle)) this.jobs.set(handle, {
      handle, first: Math.max(1, Math.trunc(page) || 1), cursor: 1,
      pages: null, visited: new Set(), fonts: [], retries: 0,
    });
    this.schedule(this.idleMs);
    return { queued: true };
  }
  schedule(delay) {
    clearTimeout(this.timer);
    if (this.closed || this.foreground || this.active) return;
    if (!this.jobs.size) {
      this.timer = setTimeout(() => this.bridge.cancel(), 15000);
    } else this.timer = setTimeout(() => void this.step(), delay);
    this.timer.unref?.();
  }
  beginForeground() {
    this.foreground++;
    this.generation++;
    clearTimeout(this.timer);
    if (this.active) this.bridge.cancel();
  }
  endForeground() {
    this.foreground = Math.max(0, this.foreground - 1);
    this.schedule(this.idleMs);
  }
  async foregroundTask(task) {
    this.beginForeground();
    try { return await task(); }
    finally { this.endForeground(); }
  }
  forget(handle) {
    this.jobs.delete(handle);
    if (!this.active || this.active.handle === handle) this.bridge.cancel();
    this.schedule(this.idleMs);
  }
  async step() {
    if (this.closed || this.foreground || this.active) return;
    const job = this.jobs.values().next().value;
    if (!job) return;
    this.active = job;
    const generation = this.generation;
    const began = Date.now();
    let lease;
    try {
      lease = this.sources.acquire(job.handle);
      let result;
      if (job.fonts.length) {
        const item = job.fonts[0];
        result = await this.bridge.request({ command: 'font-warm', ...item });
        this.seen.add(`${item.fontKey}:${item.script}`);
        if (this.seen.size > 512) this.seen.delete(this.seen.values().next().value);
        job.fonts.shift();
      } else {
        const page = job.visited.size ? job.cursor : job.first;
        result = await this.bridge.request({ command: 'font-scan', input: lease.file, page });
        job.pages = result.pages; job.visited.add(page);
        while (job.visited.has(job.cursor)) job.cursor++;
        for (const font of result.fonts || []) {
          if (!font.fontKey) continue;
          for (const script of ['latin', 'cjk']) {
            if (this.seen.has(`${font.fontKey}:${script}`) || job.fonts.some(f => f.fontKey === font.fontKey && f.script === script)) continue;
            job.fonts.push({ fontKey: font.fontKey, script });
          }
        }
      }
      job.retries = 0;
      if (result.memoryBytes > 256 * 1024 ** 2) this.bridge.cancel();
      if (!job.fonts.length && job.pages && job.cursor > job.pages) this.jobs.delete(job.handle);
      else if (this.jobs.has(job.handle)) { this.jobs.delete(job.handle); this.jobs.set(job.handle, job); }
    } catch (error) {
      // Foreground cancellation is a yield, not a failed document. Bad input
      // gets a bounded retry without surfacing an unrelated editing error.
      if (generation === this.generation && !this.foreground && ++job.retries > 2) this.jobs.delete(job.handle);
    } finally {
      await lease?.release();
      this.active = null;
      this.schedule(Math.max(this.idleMs, Math.min(5000, (Date.now() - began) * 2)));
    }
  }
  close() {
    this.closed = true; clearTimeout(this.timer); this.jobs.clear(); this.bridge.cancel();
  }
}
module.exports = { FontWarmup };
