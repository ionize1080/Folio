import { nativeRequest, releaseSource } from "./native-source.mjs";
import { icon } from "./icons.mjs";
import {structureFields,structureOptions,structureResult} from './structure-controls.mjs';
const actions = [
  ["文档", "inspect", "文档信息", "file"],
  ["文档", "metadata", "属性与元数据", "settings"],
  ["优化", "linearize", "快速 Web 查看", "link"],
  ["优化", "compress", "缩小文件", "rules"],
  ["优化", "pdfa", "PDF/A 归档", "archive"],
  ["优化", "validate-pdfa", "验证 PDF/A", "archive-check"],
  ["印刷", "pdfx", "PDF/X 印刷", "print"],
  ["印刷", "preflight-pdfx", "印刷预检", "print-check"],
  ["结构", "layers", "图层", "pages"],
  ["结构", "tags", "标签与阅读顺序", "text-lines"],
  ["结构", "validate-pdfua", "验证无障碍", "accessibility"],
  ["保护", "encrypt", "密码加密", "unlock"],
  ["表单", "forms", "查看字段", "table"],
  ["表单", "fill", "填写表单", "text-box"],
  ["表单", "create-form", "创建字段", "field-add"],
  ["导出", "export-images", "导出图片", "image-box"],
  ["导出", "export-word", "导出 Word", "word"],
  ["导出", "export-excel", "导出 Excel", "excel"],
  ["导出", "export-text", "导出文本", "text-lines"],
];
export function installDocumentUtilities({ S, exportPDF, session, writeFile }) {
  const run = async (a) => {
    if (!S.pdf || S.busy) throw Error("请先打开文档");
    const capture = session.capture();
    let bytes = await exportPDF();const sources=new Set([bytes]);
    session.assert(capture);
    try {
      const options={...(a.options||{})};
      let plan,ocrWarnings=[];
      if(['export-word','export-excel'].includes(a.action)){
        plan=await nativeRequest({command:'document-utilities',bytes,action:'conversion-plan',options});
        const scans=plan.pages.filter(p=>p.scanned);
        if(scans.length&&options.ocr!==false){
          if(scans.length>10)throw Error('扫描转换请分批选择，每批最多 10 页。');
          const blocks=[];
          for(const page of scans){session.assert(capture);const r=await nativeRequest({command:'ocr',bytes,page:page.page,profile:'v6',skipText:false});blocks.push(...r.blocks);}
          session.assert(capture);
          if(blocks.length){
            if(options.skipOCRReview)for(const block of blocks)if(block.needsReview)block.reviewSkipped=true;
            const r=await nativeRequest({command:'apply',bytes,edits:[],ocr:blocks});bytes=new Uint8Array(r.bytes);sources.add(bytes);plan=await nativeRequest({command:'document-utilities',bytes,action:'conversion-plan',options});options.ocrPages=scans.map(p=>p.page);}
          const uncertain=blocks.filter(b=>(b.confidence??b.score??0)<.95).length;
          ocrWarnings.push(`已本地识别 ${scans.length} 页扫描件；${uncertain} 个文本块需复核，OCR 置信度不等于准确率。`);
        }
      }
      if (['export-word','export-excel'].includes(a.action) && options.ai !== false) {
        await window.desktop.aiOpen();
        options.review={pages:[]};
        const start=Date.now();
        for(const page of plan.pages){
          session.assert(capture);
          if(Date.now()-start>240000)throw Error('AI 复核超过本批次时间预算，请减少页码范围后重试。');
          const review=await window.desktop.reviewConversion({kind:'office',pages:[page]});
          if(!Array.isArray(review?.pages))throw Error('AI 未返回结构报告');
          options.review.pages.push(...review.pages);
        }
      }
      const r = await nativeRequest({
        command: "document-utilities",
        bytes,
        action: a.action,
        options,
      });
      session.assert(capture);
      if(ocrWarnings.length)r.warnings=[...(r.warnings||[]),...ocrWarnings];
      if (!r.bytes) return r;
      let data = Uint8Array.from(atob(r.bytes), (c) => c.charCodeAt(0));
      if(a.action==='organize-pages'){
        const {appendSnapshot}=await import('./incremental-pdf.mjs');
        data=await appendSnapshot(bytes,data);session.assert(capture);
      }
      const saved = await writeFile(
        a.filename || S.name.replace(/\.pdf$/i, "") + "-" + a.action + "." + r.extension,
        data,
        r.extension,
      );
      const { bytes: _, ...info } = r;
      return { ...info, saved: !!saved };
    } finally {
      for(const source of sources)if (source !== S.bytes) await releaseSource(source);
    }
  };
  const b = document.createElement("button");
  b.id = "document-utilities";
  b.dataset.doc = "";
  b.innerHTML = icon("file") + "文档工具";
  document.querySelector(".more-tools-menu").append(b);
  const open = async (initialAction='inspect') => {
    b.closest("details").open = false;
    if (!S.pdf) return;
    const d = document.createElement("dialog");
    d.className = "document-tools";
    d.setAttribute("aria-label", "文档工具");
    d.innerHTML =
      '<header><div><h2>文档工具</h2><p data-name></p></div><button data-close aria-label="关闭">' +
      icon("close") +
      '</button></header><div class="document-tools-body"><nav aria-label="工具分类"></nav><section class="document-tool-detail"><h3 data-title></h3><p data-summary class="hint"></p><div data-fields></div><p data-status role="status" aria-live="polite"></p><div data-result></div></section></div><footer><span>所有结果另存为副本</span><button data-run class="primary">继续…</button></footer>';
    document.body.append(d);
    d.showModal();
    const q = (s) => d.querySelector(s);
    q("[data-name]").textContent = S.name;
    let busy = false,
      action = "inspect",
      metadata = {},
      formFields = [];
    const close = () => {
      if (!busy) {
        d.close();
        d.remove();
        b.focus();
      }
    };
    q("[data-close]").onclick = close;
    d.oncancel = (e) => {
      e.preventDefault();
      close();
    };
    const field = (name, label, value = "", type = "text") => {
      const l = document.createElement("label");
      l.textContent = label;
      const input = document.createElement("input");
      input.type = type;
      input.value = value;
      input.dataset.key = name;
      if (type === "password") input.autocomplete = "off";
      l.append(input);
      return l;
    };
    const grid = () => {
      const el = document.createElement("div");
      el.className = "form-grid";
      q("[data-fields]").append(el);
      return el;
    };
    const selectAction = (a) => {
      if (busy) return;
      action = a;
      q('[data-run]').textContent=a==='export-word'?'导出 Word…':a==='export-excel'?'导出 Excel…':'继续…';
      q("[data-title]").textContent = actions.find((x) => x[1] === a)[2];
      q("[data-status]").textContent = "";
      q("[data-result]").replaceChildren();
      q("[data-fields]").replaceChildren();
      d.querySelectorAll("nav button").forEach((el) =>
        el.setAttribute("aria-pressed", String(el.dataset.utilityAction === a)),
      );
      q("[data-summary]").textContent = {
        inspect: "查看标准与自定义属性。",
        metadata: "修改标题、作者、生成程序等属性；已有字段会保留。",
        linearize: "优化 PDF 的加载顺序，让支持的阅读器更快显示首页。",
        compress: "选择无损优化或按用途调整图片分辨率与质量。文字与矢量保持可编辑。",
        encrypt: "使用 AES-256 加密。所有者密码控制文档权限；打开密码可选。",
        forms: "列出可填写字段及其当前值。",
        fill: "填写现有表单，保留交互能力。",
        "create-form":
          "在指定页面添加文本框，坐标以页面左上角为原点，单位为 pt。",
        "export-images": "每页生成一张 PNG，以 ZIP 打包。一次最多导出 100 页。",
        "export-text": "导出可搜索文字；扫描页请先执行 OCR。",
        "export-word": "保留页面布局，或重建可编辑的流动文本。AI 复核标题和表格结构；原文覆盖率随结果显示。扫描件请先 OCR。",
        "export-excel": "识别表格与合并单元格，保留原文依据工作表。AI 复核可改善无边框表格；数值和文本始终来自原文。",
        pdfa: "生成长期归档副本，由 veraPDF 独立验证后才能保存。表单和签名会改变，请保留原件。",
        "validate-pdfa": "对所选标准进行独立合规检查，显示通过与失败规则。",
        pdfx:'生成带印刷输出配置的 PDF/X 副本，并运行结构预检。',
        'preflight-pdfx':'检查印刷标识、输出意图、页面框、嵌入字体及部分内容规则；不代表完整 ISO 认证。',
        layers:'查看和设置图层名称、显示状态与锁定状态，或把指定页面内容加入新图层。',
        tags:'检查结构树，为图形补充替代文字，设置语言和标签角色，调整子标签顺序。',
        'validate-pdfua':'验证 PDF/UA 机器可检查规则；保留准确的失败规则与定位。',
      }[a];
      q("[data-run]").textContent = ["inspect", "forms", "validate-pdfa","layers","tags","preflight-pdfx","validate-pdfua"].includes(a)
        ? "读取信息"
        : a === "export-word" ? "导出 Word…" : a === "export-excel" ? "导出 Excel…" : "另存结果…";
      q('.document-tool-detail').scrollTop=0;
      q('nav [aria-pressed=true]')?.scrollIntoView({block:'nearest'});
      structureFields(a,q('[data-fields]'));
      if (a === "metadata") {
        const g = grid();
        const names = {
          Title: "标题",
          Author: "作者",
          Subject: "主题",
          Keywords: "关键词",
          Creator: "生成程序",
          Producer: "PDF 制作程序",
          CreationDate: "创建日期",
          ModDate: "修改日期",
        };
        for (const key of new Set([
          ...Object.keys(names),
          ...Object.keys(metadata),
        ]))
          g.append(field(key, names[key] || key, metadata[key] || ""));
        const add = document.createElement("button");
        add.textContent = "添加自定义属性";
        add.onclick = () => {
          const row = document.createElement("div");
          row.className = "form-grid custom-meta";
          row.append(
            field("custom-name", "属性名"),
            field("custom-value", "属性值"),
          );
          q("[data-fields]").insertBefore(row, add);
        };
        q("[data-fields]").append(add);
      }
      if (a === "encrypt") {
        const g = grid();
        g.append(
          field("ownerPassword", "所有者密码", "", "password"),
          field("userPassword", "打开密码（可选）", "", "password"),
        );
      }
      if (a === "compress") {
        const l = document.createElement("label");
        l.textContent = "压缩预设";
        const sel = document.createElement("select");
        sel.dataset.key = "level";
        for (const [value, text] of [
          [3, "快速"],
          [6, "均衡 · 推荐"],
          [9, "最大压缩"],
        ]) {
          const o = new Option(text, value);
          sel.add(o);
        }
        sel.value = "6";
        l.append(sel);
        q("[data-fields]").append(l);
        const extra=document.createElement('div');extra.className='form-grid';
        extra.innerHTML='<label>图片策略<select data-key="preset"><option value="lossless">无损 · 保留原始图片</option><option value="screen">屏幕阅读 · 96 DPI</option><option value="balanced">日常分享 · 150 DPI</option><option value="print">高质量打印 · 300 DPI</option><option value="custom">自定义</option></select></label><label>图片分辨率<input data-key="image-dpi" type="number" min="72" max="600" value="150"></label><label>JPEG 质量<input data-key="quality" type="number" min="20" max="100" value="78"></label><label>色彩<select data-key="grayscale"><option value="false">保留彩色</option><option value="true">灰度</option></select></label>';
        const preset=extra.querySelector('[data-key="preset"]');const sync=()=>{const defaults={screen:[96,60],balanced:[150,78],print:[300,90]};if(defaults[preset.value]){extra.querySelector('[data-key="image-dpi"]').value=defaults[preset.value][0];extra.querySelector('[data-key="quality"]').value=defaults[preset.value][1];}extra.querySelectorAll('input,select:not([data-key="preset"])').forEach(el=>el.disabled=preset.value==='lossless');};preset.onchange=sync;sync();q('[data-fields]').append(extra);
      }
      if (a === "fill") {
        const g = grid();
        for (const f of formFields) {
          const el = field(f.name, f.name, f.value ?? "");
          el.querySelector("input").dataset.form = "true";
          g.append(el);
        }
        if (!formFields.length)
          q("[data-status]").textContent = "未发现可填写字段。";
      }
      if (a === "create-form") {
        const g = grid();
        for (const [key, label, value] of [
          ["name", "字段名", "name"],
          ["page", "页码", "1"],
          ["x", "左边距", "60"],
          ["y", "上边距", "60"],
          ["width", "宽度", "200"],
          ["height", "高度", "30"],
        ])
          g.append(
            field(key, label, value, key === "name" ? "text" : "number"),
          );
      }
      if (a === "export-images") {
        const el = field("dpi", "分辨率（72–600 DPI）", "150", "number");
        el.querySelector("input").min = 72;
        el.querySelector("input").max = 600;
        q("[data-fields]").append(el);
      }
      if(['pdfa','validate-pdfa'].includes(a)){
        q('[data-fields]').innerHTML='<label>归档标准<select data-key="standard"><option value="2b">PDF/A-2b · 推荐</option><option value="1b">PDF/A-1b · 传统归档</option><option value="3b">PDF/A-3b</option></select></label>';
      }
      if(['export-word','export-excel'].includes(a)){
        q('[data-fields]').innerHTML='<label>转换方式<select data-key="ai"><option value="false">本地转换 · 无需 Office</option><option value="true">AI 辅助复核结构</option></select></label><p class="hint">直接生成 DOCX / XLSX，无需安装 Word、Excel 或 LibreOffice。可选 AI 复核会发送所选页文字和坐标到您配置的服务。</p><label>扫描文字处理<select data-key="ocr-policy"><option value="review">识别并检查疑点</option><option value="skip-review">识别并跳过疑点确认（仅本次导出）</option><option value="skip">跳过 OCR，仅导出已有文字</option></select></label><p class="hint">跳过确认会保留识别文字，可能包含错字；跳过 OCR 时扫描页可能没有可编辑文字。</p><label>页码范围<input data-key="pages" placeholder="全部，或 1-3,5"></label>'+(a==='export-word'?'<label>版式<select data-key="layout"><option value="faithful">保留页面布局</option><option value="flow">流动文本 · 易于编辑</option></select></label>':'<label>数据类型<select data-key="numeric"><option value="true">识别简单数值与百分比</option><option value="false">全部保留为文本</option></select></label>');
      }
    };
    let group;
    for (const [category, a, label, symbol] of actions) {
      if (group !== category) {
        group = category;
        const h = document.createElement("h4");
        h.textContent = category;
        q("nav").append(h);
      }
      const button = document.createElement("button");
      button.dataset.utilityAction = a;
      button.innerHTML = icon(symbol);
      button.append(document.createTextNode(label));
      button.onclick = () => selectAction(a);
      q("nav").append(button);
    }
    selectAction(initialAction);
    q("[data-run]").onclick = async () => {
      if (busy) return;
      busy = true;
      q("[data-run]").disabled = true;
      q("[data-status]").textContent = "正在处理…";
      try {
        let options = {};
        const get = (key) =>
          q("[data-fields]").querySelector('[data-key="' + key + '"]')?.value;
        if (action === "metadata") {
          options.fields = {};
          for (const el of q("[data-fields]").querySelectorAll(
            "input[data-key]",
          ))
            if (
              !el.closest(".custom-meta") &&
              el.value !== (metadata[el.dataset.key] || "")
            )
              options.fields[el.dataset.key] = el.value;
          for (const row of q("[data-fields]").querySelectorAll(
            ".custom-meta",
          )) {
            const k = row
              .querySelector('[data-key="custom-name"]')
              .value.trim();
            if (k)
              options.fields[k] = row.querySelector(
                '[data-key="custom-value"]',
              ).value;
          }
        }
        if (action === "fill") {
          options.fields = {};
          for (const el of q("[data-fields]").querySelectorAll(
            "input[data-form]",
          ))
            options.fields[el.dataset.key] = el.value;
        }
        if (action === "create-form") {
          const x = Number(get("x")),
            y = Number(get("y"));
          options.fields = [
            {
              name: get("name"),
              page: Number(get("page")),
              rect: [x, y, x + Number(get("width")), y + Number(get("height"))],
              type: "text",
            },
          ];
        }
        if (action === "encrypt")
          options = {
            ownerPassword: get("ownerPassword"),
            userPassword: get("userPassword"),
          };
        if (action === "compress") options={level:Number(get('level')),preset:get('preset'),dpi:Number(get('image-dpi')),quality:Number(get('quality')),grayscale:get('grayscale')==='true'};
        if (action === "export-images") options.dpi = Number(get("dpi"));
        if(['pdfa','validate-pdfa'].includes(action))options.standard=get('standard');
        if(['export-word','export-excel'].includes(action)){
          options.ocr=get('ocr-policy')!=='skip';options.skipOCRReview=get('ocr-policy')==='skip-review';options.ai=get('ai')==='true'; options.layout=get('layout')||'faithful';options.numeric=get('numeric')!=='false';
          const range=get('pages')?.trim();
          if(range){options.pages=[];for(const piece of range.split(',')){const match=piece.trim().match(/^(\d+)(?:-(\d+))?$/);if(!match)throw Error('页码格式示例：1-3,5');const first=Number(match[1]),last=Number(match[2]||match[1]);if(last<first||last-first>99)throw Error('单次最多 100 页');for(let p=first;p<=last;p++)options.pages.push(p);}}
        }
        options=await structureOptions(action,q('[data-fields]'))||options;
        const r = await run({ action, options });
        q("[data-status]").textContent =
          "saved" in r ? (r.saved ? "结果已保存" : "已取消保存") : "读取完成";
        q("[data-result]").replaceChildren();
        structureResult(action,r,q('[data-result]'),run,writeFile);
        if(r.reduction!==undefined){const p=document.createElement('p');p.textContent=`体积减少 ${(r.reduction*100).toFixed(1)}% · 已优化 ${r.imagesChanged} 张图片`;q('[data-result]').append(p);}
        if(r.metrics||r.validation||'compliant' in r||r.warnings){
          const detail=document.createElement('p');detail.className='conversion-report';
          const v=r.validation||r;
          detail.textContent=[v.validator?`${v.standard} · ${v.compliant===null?(v.preflightPassed?'所列预检项通过 · 非完整合规验证':'预检发现问题'):v.compliant?'验证通过':'未通过'} · ${v.validator}`:'',r.metrics?.textCoverage!==undefined?`原文字符覆盖：${(r.metrics.textCoverage*100).toFixed(1)}%`:'',r.metrics?.evidenceCoverage!==undefined?`原文依据保留：${(r.metrics.evidenceCoverage*100).toFixed(1)}% · 归入表格：${(r.metrics.tableAssignmentCoverage*100).toFixed(1)}% · 表格外文字：${r.metrics.unassignedTokens} 项（见 Source 页；保留率不代表单元格正确率）`:'',...(r.warnings||[])].filter(Boolean).join('\n');
          q('[data-result]').append(detail);
        }
        if (action === "inspect") {
          metadata = r.metadata;
          const dl = document.createElement("dl");
          for (const [k, v] of Object.entries({
            页数: r.pages,
            ...r.metadata,
          })) {
            const dt = document.createElement("dt"),
              dd = document.createElement("dd");
            dt.textContent = k;
            dd.textContent = String(v);
            dl.append(dt, dd);
          }
          q("[data-result]").append(dl);
        }
        if (action === "forms") {
          formFields = r.fields;
          const ul = document.createElement("ul");
          for (const f of formFields) {
            const li = document.createElement("li");
            li.textContent =
              f.name + " · " + f.type + " · 第 " + f.page + " 页 · " + f.value;
            ul.append(li);
          }
          q("[data-result]").append(ul);
        }
        for (const el of d.querySelectorAll('input[type="password"]'))
          el.value = "";
      } catch (e) {
        q("[data-status]").textContent = e.message;
      } finally {
        busy = false;
        q("[data-run]").disabled = false;
      }
    };
    if(['export-word','export-excel'].includes(initialAction))return;
    busy = true;
    q("[data-run]").disabled = true;
    try {
      const [info, forms] = await Promise.all([
        run({ action: "inspect" }),
        run({ action: "forms" }),
      ]);
      metadata = info.metadata;
      formFields = forms.fields;
    } catch (e) {
      q("[data-status]").textContent = e.message;
    } finally {
      busy = false;
      q("[data-run]").disabled = false;
    }
  };
  b.onclick=()=>open();
  for(const [action,label,symbol] of [['export-word','导出 Word','word'],['export-excel','导出 Excel','excel']]){
    const shortcut=document.createElement('button');shortcut.id=action;shortcut.dataset.doc='';shortcut.innerHTML=icon(symbol)+label;shortcut.onclick=()=>open(action);document.querySelector('.more-tools-menu').append(shortcut);
  }
  return run;
}
