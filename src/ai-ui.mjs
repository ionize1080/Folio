import { icon } from "./icons.mjs";
import { catalog, guide, treeOperation } from "./ai-tools.mjs";
import { extractLines } from "./text-lines.mjs";
import { matchTargets } from "./calibrate-worker.mjs";
import { nativeRequest } from "./native-source.mjs";
function treeWorker(data) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./ai-worker.mjs", import.meta.url), {
      type: "module",
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(Error("操作计算超时，未应用修改"));
    }, 15000);
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    worker.onmessage = (e) => {
      finish();
      e.data.error ? reject(Error(e.data.error)) : resolve(e.data.result);
    };
    worker.onerror = (e) => {
      finish();
      reject(Error(e.message));
    };
    worker.postMessage(data);
  });
}
export function installAI({
  S,
  commit,
  undo,
  redo,
  session,
  exportPDF,
  applyContent,
  getLargeDocument,
}) {
  const desktop = window.desktop;
  if (!desktop?.aiOpen) return;
  let overlay = false;
  new MutationObserver(() => {
    const next = !!document.querySelector("dialog[open]");
    if (next !== overlay) {
      overlay = next;
      desktop.aiOverlay(next);
    }
  }).observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ["open"],
  });
  let auto = false,
    queue = Promise.resolve();
  const ocrJobs = new Map();
  const bar = document.createElement("div");
  bar.className = "toolgroup";
  document.querySelector(".toolbar").append(bar);
  const open = document.createElement("button");
  open.innerHTML = icon("chat") + "<span>AI</span>";
  open.className = "folio-ai-open";
  open.title = "AI 助手 · Chatbox";
  open.setAttribute("aria-pressed", "false");
  bar.append(open);
  let opening = false,
    displayMode = "sidebar";
  open.onclick = async () => {
    if (opening) return;
    opening = true;
    open.disabled = true;
    try {
      await desktop.aiOpen();
    } catch (e) {
      alert(e.message);
    } finally {
      opening = false;
      open.disabled = false;
    }
  };
  const setApproval = (enabled) => {
    if (enabled && !auto) {
      if (
        !confirm(
          "启用自动审批？AI 将可以修改当前文档，并按需将文字和页面图像发送给所选模型。",
        )
      )
        return false;
      if (
        !confirm(
          "再次确认：本次会话自动执行 AI 操作，包括外部图像辅助。可随时切回手动审批。",
        )
      )
        return false;
    }
    auto = enabled;
    open.style.color = auto ? "#d71920" : "";
    open.title = auto ? "AI 助手 · 自动审批已开启" : "AI 助手 · Chatbox";
    desktop.aiApproval(auto);
    return true;
  };
  desktop.onAIState((state) => {
    displayMode = state.mode;
    open.setAttribute("aria-pressed", String(state.open));
    document.body.classList.toggle(
      "ai-sidebar-open",
      state.open && state.mode === "sidebar",
    );
    requestAnimationFrame(dockBounds);
  });
  let lastBounds = "";
  const dockBounds = () => {
    const r = document.querySelector(".inspector").getBoundingClientRect();
    const key = [r.x, r.y, r.width, r.height].join(",");
    if (key === lastBounds) return;
    lastBounds = key;
    desktop.aiBounds({ x: r.x, y: r.y, width: r.width, height: r.height });
  };
  new ResizeObserver(dockBounds).observe(document.querySelector("main"));
  new ResizeObserver(dockBounds).observe(document.querySelector(".inspector"));
  const revision = () => JSON.stringify(session.capture());
  let prior = "",
    counter = 0;
  const rev = () => {
    const now = revision();
    if (now !== prior) {
      prior = now;
      counter++;
    }
    return String(counter);
  };
  async function perform({ name, arguments: a = {} }, deadline = Infinity) {
    const timely = () => {
      if (Date.now() > deadline) throw Error("请求已过期，未应用修改");
    };
    timely();
    if (name === "folio_ui") {
      setApproval(!auto);
      return { auto };
    }
    if (name === "pdf_help") {
      const { tools } = await desktop.aiPdf({ action: "list" });
      return a.operation
        ? tools.find((t) => t.name === a.operation)
        : tools.map((t) => ({ name: t.name, description: t.description }));
    }
    if (name === "pdf_operation") {
      if (
        !auto &&
        !confirm(
          "开源 PDF MCP 操作：" +
            a.operation +
            "\n" +
            JSON.stringify(a.options || {}, null, 2) +
            "\n可能读取或写入指定文件。外部模型仅通过Chatbox调用。",
        )
      )
        throw Error("用户拒绝操作");
      timely();
      return desktop.aiPdf({
        action: "call",
        name: a.operation,
        options: a.options,
      });
    }
    if (name === "folio_help")
      return a.operation
        ? {
            operation: a.operation,
            definition: catalog[a.operation] || null,
            guide,
          }
        : {
            operations: Object.fromEntries(
              Object.entries(catalog).map(([k, v]) => [k, v[0]]),
            ),
            guide,
          };
    if (name !== "folio_operation") throw Error("未知工具");
    const op = a.operation,
      p = a.options || {};
    if (!Object.hasOwn(catalog, op))
      throw Error(
        "缺少或未知必填字段 operation：" +
          String(op) +
          '。必须与options同级传入，例如 {operation:"page.image",revision:"最新版本",options:{page:1,purpose:"classify"}}。查询folio_help只提供说明，不会记住下一次操作。',
      );
    const large = getLargeDocument?.();
    if (large) {
      const state = large.aiDescribe();
      if (op === "document.describe")
        return {
          ...state,
          path: state.hasUnsavedChanges
            ? null
            : await desktop.largeSource(state.handle),
          next: "大文件使用pdf_help/pdf_operation按文件处理，输出新副本；当前大文件工作区修改须先保存。",
        };
      throw Error(
        "当前为大文件工作区，请使用document.describe返回的path和pdf_help/pdf_operation，不操作后台普通文档",
      );
    }
    if (!S.pdf) throw Error("请先打开PDF");
    if (op === "document.describe")
      return {
        name: S.name,
        pageCount: S.info.pageCount,
        bookmarkCount: S.nodes.length,
        busy: !!S.busy,
        revision: rev(),
      };
    const read = [
      "bookmark.read",
      "page.objects",
      "page.text",
      "bookmark.calibrate",
      "ocr.local",
    ].includes(op);
    const before = rev(),
      session = S.sessionId,
      bytes = S.bytes;
    if (!read && a.revision !== before)
      throw Error("文档版本已变化，请重新读取document.describe");
    if (
      !auto &&
      !confirm(
        "AI 请求：" +
          op +
          "\n" +
          JSON.stringify(p, null, 2).slice(0, 5000) +
          (op === "page.image" ? "\n页面图像会发送给当前对话模型。" : ""),
      )
    )
      throw Error("用户拒绝操作");
    timely();
    if (S.busy) throw Error("文档正在处理");
    const fresh = () => {
      timely();
      if (S.sessionId !== session || S.bytes !== bytes || rev() !== before)
        throw Error("文档已变化，结果未应用");
    };
    const pages = p.pages || (p.page !== undefined ? [p.page] : [S.page]);
    if (
      !Array.isArray(pages) ||
      pages.length > 100 ||
      pages.some((n) => !Number.isInteger(n) || n < 1 || n > S.info.pageCount)
    )
      throw Error("页码无效或超过100页预算");
    if (op === "bookmark.read") {
      const offset = p.offset ?? 0,
        limit = p.limit ?? 500;
      if (
        !Number.isInteger(offset) ||
        offset < 0 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 5000
      )
        throw Error("分页无效");
      return {
        revision: before,
        total: S.nodes.length,
        nodes: S.nodes.slice(offset, offset + limit),
        nextOffset: offset + limit < S.nodes.length ? offset + limit : null,
      };
    }
    const lines = async () => {
      const out = [];
      for (const page of pages)
        out.push(
          ...(await extractLines(S.pdf, page, S.rotation[page] || 0, {})),
        );
      fresh();
      return out;
    };
    if (op === "document.snapshot") {
      const bytes = await exportPDF();
      fresh();
      return { ...(await desktop.aiSnapshot(bytes)), revision: before };
    }
    if (op === "page.text") return { revision: before, lines: await lines() };
    if (op === "ocr.local") {
      const threshold =
        p.threshold ??
        Number(localStorage.getItem("folio-ai-ocr-threshold") || 0.95);
      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
        throw Error("置信度须在0到1之间");
      if (!Number.isInteger(p.page) || p.page < 1 || p.page > S.info.pageCount)
        throw Error("页码无效");
      const result = await nativeRequest({
        command: "ocr",
        bytes: await S.pdf.getData(),
        page: p.page,
        profile: "v6",
        skipText: false,
      });
      fresh();
      const jobId = crypto.randomUUID();
      ocrJobs.clear();
      ocrJobs.set(jobId, {
        revision: before,
        blocks: structuredClone(result.blocks),
      });
      return {
        revision: before,
        ...result,
        jobId,
        threshold,
        lowConfidence: result.blocks.filter(
          (b) => (b.confidence ?? b.score ?? 0) < threshold,
        ),
        next: "使用page.image按需获取整页或region=[x,y,width,height]归一化区域，再复核低置信度文字。保留原始结果。",
      };
    }
    if (op === "page.objects") {
      if (!Number.isInteger(p.page) || p.page < 1 || p.page > S.info.pageCount)
        throw Error("页码无效");
      const result = await nativeRequest({
        command: "inspect",
        bytes: S.bytes,
        page: p.page,
      });
      fresh();
      return { revision: before, ...result };
    }
    if (op === "page.edit") {
      if (!Array.isArray(p.edits) || p.edits.length > 1000)
        throw Error("编辑列表无效");
      fresh();
      await applyContent([...S.nativeEdits, ...p.edits], S.ocr);
      return { applied: true, revision: rev() };
    }
    if (op === "ocr.apply") {
      const job = ocrJobs.get(p.jobId);
      if (!job || job.revision !== before)
        throw Error("OCR任务已过期，请重新识别");
      const blocks = structuredClone(job.blocks);
      for (const correction of p.corrections || []) {
        if (
          !Number.isInteger(correction.index) ||
          !blocks[correction.index] ||
          typeof correction.text !== "string" ||
          correction.text.length > 32768
        )
          throw Error("文字修正无效");
        blocks[correction.index].originalText = blocks[correction.index].text;
        blocks[correction.index].text = correction.text;
        blocks[correction.index].reviewed = true;
      }
      fresh();
      const pages = new Set(blocks.map((b) => b.page));
      await applyContent(S.nativeEdits, [
        ...S.ocr.filter((b) => !pages.has(b.page)),
        ...blocks,
      ]);
      ocrJobs.delete(p.jobId);
      return { applied: true, revision: rev() };
    }
    if (op === "page.image") {
      if (!Number.isInteger(p.page) || p.page < 1 || p.page > S.info.pageCount)
        throw Error("页码无效");
      const page = await S.pdf.getPage(p.page),
        base = page.getViewport({
          scale: 1,
          rotation: S.rotation[p.page] ?? page.rotate,
        });
      const region = p.region || [0, 0, 1, 1];
      const [x, y, w, h] = region;
      if (
        region.length !== 4 ||
        region.some((n) => !Number.isFinite(n) || n < 0 || n > 1) ||
        w <= 0 ||
        h <= 0 ||
        x + w > 1 ||
        y + h > 1
      )
        throw Error("区域无效");
      const budgets = { classify: 960, toc: 1600, locate: 2200 };
      const purpose = p.purpose || "classify";
      if (!budgets[purpose]) throw Error("purpose须为classify/toc/locate");
      const scale =
        p.scale ??
        Math.min(
          3,
          budgets[purpose] / Math.max(base.width * w, base.height * h),
        );
      if (!Number.isFinite(scale) || scale <= 0 || scale > 3)
        throw Error("缩放范围大于0至3");
      const viewport = page.getViewport({
        scale,
        rotation: S.rotation[p.page] ?? page.rotate,
      });
      const image = document.createElement("canvas");
      image.width = Math.ceil(viewport.width * w);
      image.height = Math.ceil(viewport.height * h);
      if (image.width * image.height > 6000000)
        throw Error("图像过大，请缩小区域");
      const ox = viewport.width * x,
        oy = viewport.height * y;
      await page.render({
        canvasContext: image.getContext("2d"),
        viewport,
        transform: [1, 0, 0, 1, -ox, -oy],
      }).promise;
      const origin = viewport.convertToPdfPoint(ox, oy),
        px = viewport.convertToPdfPoint(ox + 1, oy),
        py = viewport.convertToPdfPoint(ox, oy + 1);
      const imageToPdf = [
        px[0] - origin[0],
        px[1] - origin[1],
        py[0] - origin[0],
        py[1] - origin[1],
        ...origin,
      ];
      fresh();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              page: p.page,
              region,
              purpose,
              width: image.width,
              height: image.height,
              imageToPdf,
              revision: before,
            }),
          },
          {
            type: "image",
            mimeType: "image/png",
            data: image.toDataURL("image/png").split(",")[1],
          },
        ],
      };
    }
    if (op === "bookmark.calibrate") {
      const all = await lines(),
        byPage = {};
      for (const l of all) (byPage[l.page] ??= []).push(l);
      return {
        revision: before,
        candidates: matchTargets({
          ...p,
          nodes: S.nodes.filter((n) => !p.ids || p.ids.includes(n.id)),
          pages: byPage,
        }),
      };
    }
    if (op === "history.undo" || op === "history.redo") {
      fresh();
      await (op.endsWith("undo") ? undo() : redo());
      return { applied: true, revision: rev() };
    }
    const context = { pages: S.info.pages, rotations: S.rotation };
    if (op === "bookmark.generate") context.lines = await lines();
    const result = await treeWorker({
      op,
      args: p,
      nodes: S.nodes,
      pageCount: S.info.pageCount,
      context,
    });
    fresh();
    commit(result.nodes);
    const { nodes, changes, ...details } = result;
    return {
      ...details,
      node: details.id ? nodes.find((n) => n.id === details.id) : undefined,
      bookmarkCount: nodes.length,
      changeCount: changes?.length,
      applied: true,
      revision: rev(),
    };
  }
  desktop.onAIRequest(async (message) => {
    const work = queue.then(() => perform(message.params, message.deadline));
    queue = work.catch(() => {});
    try {
      await desktop.aiReply({ id: message.id, result: await work });
    } catch (e) {
      await desktop.aiReply({ id: message.id, error: e.message });
    }
  });
  return {
    getSettings: () => ({
      auto,
      display: displayMode,
      threshold:
        Number(localStorage.getItem("folio-ai-ocr-threshold") || 0.95) * 100,
    }),
    applySettings: ({ threshold, auto: enabled, display }) => {
      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100)
        throw Error("OCR 复核阈值应为 0 至 100%");
      if (!setApproval(enabled)) return false;
      localStorage.setItem("folio-ai-ocr-threshold", String(threshold / 100));
      if (display !== displayMode) desktop.aiDisplay(display);
      return true;
    },
  };
}
