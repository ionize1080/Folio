import { nativeRequest, releaseSource } from "./native-source.mjs";
import { icon } from "./icons.mjs";
const actions = [
  ["文档", "inspect", "文档信息", "file"],
  ["文档", "metadata", "属性与元数据", "settings"],
  ["优化", "linearize", "快速 Web 查看", "link"],
  ["优化", "compress", "缩小文件", "rules"],
  ["保护", "encrypt", "密码加密", "unlock"],
  ["表单", "forms", "查看字段", "table"],
  ["表单", "fill", "填写表单", "text-box"],
  ["表单", "create-form", "创建字段", "text-box"],
  ["导出", "export-images", "导出图片", "image-box"],
  ["导出", "export-text", "导出文本", "text-lines"],
];
export function installDocumentUtilities({ S, exportPDF, session, writeFile }) {
  const run = async (a) => {
    if (!S.pdf || S.busy) throw Error("请先打开文档");
    const capture = session.capture(),
      bytes = await exportPDF();
    session.assert(capture);
    try {
      const r = await nativeRequest({
        command: "document-utilities",
        bytes,
        action: a.action,
        options: a.options || {},
      });
      session.assert(capture);
      if (!r.bytes) return r;
      const data = Uint8Array.from(atob(r.bytes), (c) => c.charCodeAt(0));
      const saved = await writeFile(
        S.name.replace(/\.pdf$/i, "") + "-" + a.action + "." + r.extension,
        data,
        r.extension,
      );
      const { bytes: _, ...info } = r;
      return { ...info, saved: !!saved };
    } finally {
      if (bytes !== S.bytes) await releaseSource(bytes);
    }
  };
  const b = document.createElement("button");
  b.id = "document-utilities";
  b.dataset.doc = "";
  b.innerHTML = icon("file") + "文档工具";
  document.querySelector(".more-tools-menu").append(b);
  b.onclick = async () => {
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
        compress: "保留文字、图片质量和表单。已有充分压缩的文档可能不会变小。",
        encrypt: "使用 AES-256 加密。所有者密码控制文档权限；打开密码可选。",
        forms: "列出可填写字段及其当前值。",
        fill: "填写现有表单，保留交互能力。",
        "create-form":
          "在指定页面添加文本框，坐标以页面左上角为原点，单位为 pt。",
        "export-images": "每页生成一张 PNG，以 ZIP 打包。一次最多导出 100 页。",
        "export-text": "导出可搜索文字；扫描页请先执行 OCR。",
      }[a];
      q("[data-run]").textContent = ["inspect", "forms"].includes(a)
        ? "读取信息"
        : "另存结果…";
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
    selectAction("inspect");
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
        if (action === "compress") options.level = Number(get("level"));
        if (action === "export-images") options.dpi = Number(get("dpi"));
        const r = await run({ action, options });
        q("[data-status]").textContent =
          "saved" in r ? (r.saved ? "结果已保存" : "已取消保存") : "读取完成";
        q("[data-result]").replaceChildren();
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
  return run;
}
