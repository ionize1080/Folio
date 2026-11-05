import { selectBookmarkIds, calibrationPages, calibrationPlan, pageResult } from "./ai-efficient.mjs";
import { extractTocPage } from "./smart-toc-extract.mjs";
import { recognizeTocPages, resolveTocEntries, entriesToNodes, calibrationLines } from "./smart-toc.mjs";
import { icon } from "./icons.mjs";
import { catalog, guide, treeOperation } from "./ai-tools.mjs";
import { ocrPage } from "./ocr-data.mjs";
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
  let overlayFrame = 0;
  const updateOverlay = () => {
    overlayFrame = 0;
    const next = !!document.querySelector("dialog[open], details[open], #context-menu:not([hidden])");
    if (next !== overlay) {
      overlay = next;
      desktop.aiOverlay(next);
    }
  };
  new MutationObserver((records) => {
    // PDF text layers and virtual bookmark rows mutate continuously while scrolling.
    // Only menu/dialog mutations affect the native view; coalesce to one layout frame.
    const relevant = records.some(r => r.type === "attributes"
      ? r.target.matches?.("dialog, details, #context-menu")
      : [...r.addedNodes, ...r.removedNodes].some(n => n.nodeType === 1 &&
          (n.matches?.("dialog, details, #context-menu") || n.querySelector?.("dialog, details, #context-menu"))));
    if (relevant && !overlayFrame) overlayFrame = requestAnimationFrame(updateOverlay);
  }).observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ["open", "hidden"],
    childList: true,
  });
  let auto = false,
    queue = Promise.resolve();
  const ocrJobs = new Map();
  let cacheRevision, snapshot;
  const lineCache=new Map(), ocrCache=new Map();
  const bar = document.createElement("div");
  bar.className = "toolgroup";
  document.querySelector(".toolbar").append(bar);
  const open = document.createElement("button");
  open.innerHTML = icon("spark") + "<span>AI</span>";
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
    open.style.color = "";
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
    const direct = {folio_calibrate:"bookmark.calibrate",folio_whitespace:"bookmark.whitespace"};
    if (direct[name] || name === "folio_bookmarks" || name === "folio_document") {
      let op=direct[name];
      if(name==="folio_bookmarks")op="bookmark."+a.action;
      if(name==="folio_document")op=({describe:"document.describe",snapshot:"document.snapshot",toc:"document.toc",text:"page.text",ocr:"ocr.local",image:"page.image",objects:"page.objects"})[a.action];
      const {revision,selector,action,options,...rest}=a;
      return perform({name:"folio_operation",arguments:{operation:op,revision,options:{...options,...rest,...(selector?{selector}:{}),...(name==="folio_calibrate"?{apply:a.apply!==false}:{}),...(name==="folio_bookmarks"&&action==="read"?{detail:a.detail||"compact"}:{})}}},deadline);
    }
    if (name === "folio_ui") {
      setApproval(!auto);
      return { auto };
    }
    if (name === "pdf_help") {
      const { tools } = await desktop.aiPdf({ action: "list" });
      if(a.operation) {const tool=tools.find(t=>t.name===a.operation);if(!tool)throw Error("未知PDF工具");return tool;}
      const terms=String(a.query||"").toLowerCase().split(/\s+/).filter(Boolean);
      const matches=tools.map(tool=>({tool,score:terms.reduce((n,q)=>n+((tool.name+" "+tool.description).toLowerCase().includes(q)?1:0),0)+(terms.includes(tool.name.toLowerCase())?terms.length+1:0)}))
        .filter(item=>!terms.length||item.score>0).sort((a,b)=>b.score-a.score).map(item=>item.tool);
      return pageResult(matches.map(t=>({name:t.name,description:t.description.split("\n")[0].slice(0,220)})),{offset:a.offset,limit:a.limit||20});
    }
    if (name === "pdf_operation") {
      if(a.resultId)return desktop.aiPdf({action:"result",resultId:a.resultId,offset:a.offset,limit:a.limit});
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
    if (name === "folio_help") {
      if (a.operation) {
        const operation = ({image:"page.image", "folio_document.image":"page.image", text:"page.text", toc:"document.toc", calibrate:"bookmark.calibrate", whitespace:"bookmark.whitespace"})[a.operation] || a.operation;
        if (!catalog[operation]) throw Error("未知操作。使用 folio_document 的 action=describe/text/toc/ocr/image/objects/snapshot；书签使用 folio_bookmarks；或不传 operation 查询操作名。");
        return {operation,definition:catalog[operation]};
      }
      return {
            operations: Object.fromEntries(
              Object.entries(catalog).map(([k, v]) => [k, v[0]]),
            ),
            guide,
          };
    }
    if (name !== "folio_operation") throw Error("未知工具");
    const op = a.operation,
      p = {...(a.options || {})};
    if(p.selector)p.ids=selectBookmarkIds(S.nodes,p.selector);
    if(op==="bookmark.calibrate" && !p.ids)p.ids=S.nodes.map(n=>n.id);
    const progress=text=>desktop.aiProgress?.(text).catch(()=>{});
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
      "page.image",
      "document.snapshot",
      ...(p.apply ? [] : ["bookmark.calibrate", "document.toc"]),
      "ocr.local",
    ].includes(op);
    const before = rev(),
      session = S.sessionId,
      bytes = S.bytes;
    if(cacheRevision!==before){cacheRevision=before;lineCache.clear();ocrCache.clear();snapshot=null;}
    if ((!read || a.revision !== undefined) && a.revision !== before)
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
    const selectedNodes=S.nodes.filter(n=>!p.ids||p.ids.includes(n.id));
    const pages = p.pages || (op==="bookmark.calibrate" ? calibrationPages(selectedNodes,S.info.pageCount,p.radius??2) : (p.page !== undefined ? [p.page] : [S.page]));
    if (
      !Array.isArray(pages) ||
      pages.length > (op==="bookmark.calibrate"?1000:100) ||
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
        total: selectedNodes.length,
        nodes: selectedNodes.slice(offset, offset + limit).map(n=>p.detail==="compact"?{id:n.id,title:n.title,parent:n.parent,page:n.target?.page,bold:n.bold,italic:n.italic}:n),
        nextOffset: offset + limit < selectedNodes.length ? offset + limit : null,
      };
    }
    const localOcr = async page => {
      if(!ocrCache.has(page)) {progress(`正在本地识别第 ${page} 页文字`);const result=await nativeRequest({command:"ocr",bytes:await S.pdf.getData(),page,profile:"v6",skipText:false});fresh();ocrCache.set(page,result);lineCache.delete(page);}
      return ocrCache.get(page);
    };
    const effectiveOCR=page=>{const saved=ocrPage(S.ocr,page);return saved.length?saved:(ocrCache.get(page)?.blocks||[])};
    const lines = async (pageList=pages) => {
      const out=[];
      for (let i=0;i<pageList.length;i++) {
        const page=pageList[i];
        progress(`正在读取第 ${page} 页（${i+1}/${pageList.length}）`);
        if(!lineCache.has(page))lineCache.set(page,await extractLines(S.pdf,page,S.rotation[page]??(await S.pdf.getPage(page)).rotate,{ocr:effectiveOCR(page)}));
        out.push(...lineCache.get(page));fresh();
        if(out.length>250000)throw Error("文字行超过预算，请缩小页范围");
      }
      return out;
    };
    if (op === "document.snapshot") {
      if(!snapshot){const bytes = await exportPDF();fresh();snapshot=await desktop.aiSnapshot(bytes);}
      return {...snapshot, revision: before };
    }
    if (op === "page.text") {
      const all=await lines(), result=pageResult(all,p);
      return {revision:before,...result,items:undefined,lines:result.items.map(l=>p.detail==="full"?l:{page:l.page,text:l.text,x:l.x,y:l.y,top:l.top,bottom:l.bottom,height:l.height})};
    }
    if(op==="document.toc") {
      const extracted=[];
      for(const page of pages){
        progress(`正在本地识别第 ${page} 页目录`);
        const rotation=S.rotation[page]??(await S.pdf.getPage(page)).rotate;
        let result=await extractTocPage(S.pdf,page,rotation,effectiveOCR(page));
        if(!result.fragments.length){await localOcr(page);result=await extractTocPage(S.pdf,page,rotation,effectiveOCR(page));}
        extracted.push(result);fresh();
      }
      const found=recognizeTocPages(extracted), entries=found.flatMap(r=>r.entries);
      const bodyPages=p.bodyPages||Array.from({length:Math.min(S.info.pageCount,100)},(_,i)=>i+1);
      if(!Array.isArray(bodyPages)||bodyPages.length>100||bodyPages.some(n=>!Number.isInteger(n)||n<1||n>S.info.pageCount))throw Error("正文页范围无效，最多100页");
      const byPage={};for(const l of await lines(bodyPages))(byPage[l.page]??=[]).push(l);
      for(const page of Object.keys(byPage))byPage[page]=calibrationLines(byPage[page]);
      const resolved=resolveTocEntries(entries,byPage,S.info.pageCount,(await S.pdf.getPageLabels())||[],pages);
      const accepted=resolved.filter(e=>e.selected&&!e.needsReview),review=resolved.filter(e=>!e.selected||e.needsReview);
      fresh();
      if(p.apply && accepted.length)commit(p.replace?entriesToNodes(resolved.map(e=>({...e,selected:e.selected&&!e.needsReview})),S.info.pageCount):[...S.nodes,...entriesToNodes(resolved.map(e=>({...e,selected:e.selected&&!e.needsReview})),S.info.pageCount)]);
      return {revision:rev(),applied:!!p.apply,recognized:entries.length,accepted:accepted.length,review:pageResult(review,p),scannedPages:bodyPages,hasMorePages:S.info.pageCount>bodyPages.length,next:"复核review条目；扫描件先ocr.local，低置信度再请求page.image；不要猜测印刷页与PDF页偏移"};
    }
    if (op === "ocr.local") {
      const threshold =
        p.threshold ??
        Number(localStorage.getItem("folio-ai-ocr-threshold") || 0.95);
      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
        throw Error("置信度须在0到1之间");
      if (!Number.isInteger(p.page) || p.page < 1 || p.page > S.info.pageCount)
        throw Error("页码无效");
      const result=await localOcr(p.page);
      const jobId = crypto.randomUUID();
      if(ocrJobs.size>=8)ocrJobs.delete(ocrJobs.keys().next().value);
      ocrJobs.set(jobId, {
        revision: before,
        blocks: structuredClone(result.blocks),
      });
      return {
        revision: before,
        ...(p.detail==="full"?result:{page:p.page,blockCount:result.blocks.length}),
        jobId,
        threshold,
        lowConfidence: result.blocks.map((b,index)=>({...b,index})).filter(b=>(b.confidence??b.score??0)<threshold),
        next: "page.text可读取本次OCR的全部文字，无需先写入PDF。仅对lowConfidence使用归一化region的page.image复核；保留原始结果。",
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
      const objects=Array.isArray(result.objects)?result.objects:[];
      const selected=p.objectIndexes?objects.filter(o=>p.objectIndexes.includes(o.index)):objects;
      const paged=pageResult(selected,{offset:p.offset,limit:p.limit||30});
      return {revision:before,...result,objects:paged.items.map(o=>p.detail==="full"?o:Object.fromEntries(Object.entries(o).filter(([k])=>!["glyphs","clipBounds"].includes(k)))),total:paged.total,nextOffset:paged.nextOffset,next:"编辑前按objectIndexes读取detail=full；不要重复整页对象。"};
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
        throw Error("region须为归一化[left,top,width,height]，每项0..1，原点左上。上半页=[0,0,1,0.5]；不要使用PDF点数，整页省略region。");
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
      const all=await lines(), byPage={};
      for(const l of all)(byPage[l.page]??=[]).push(l);
      const candidates=matchTargets({...p,radius:p.radius??2,searchAll:true,nodes:selectedNodes,pages:byPage});
      const plan=calibrationPlan(candidates,p.threshold??0.95);
      if(p.apply && plan.accepted.length) {
        const result=await treeWorker({op:"bookmark.patch",args:{changes:plan.accepted.map(c=>({id:c.id,patch:{target:c.target}}))},nodes:S.nodes,pageCount:S.info.pageCount});
        fresh();commit(result.nodes);
      }
      return {revision:rev(),applied:!!p.apply,scannedPages:pages,matched:plan.accepted.length,changed:p.apply?plan.accepted.length:0,review:plan.review,...(!p.apply?{accepted:plan.accepted}:{}),next:"仅复核review。低置信度候选未修改；先局部文字/OCR，必要时page.image裁剪，再bookmark.patch批量应用。"};
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
    const changed=result.nodes.filter(n=>JSON.stringify(n)!==JSON.stringify(S.nodes.find(old=>old.id===n.id))).length + S.nodes.filter(n=>!result.nodes.some(next=>next.id===n.id)).length;
    if(changed)commit(result.nodes);
    const { nodes, changes, ...details } = result;
    return {
      ...details,
      node: details.id ? nodes.find((n) => n.id === details.id) : undefined,
      bookmarkCount: nodes.length,
      changeCount: changed,
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
