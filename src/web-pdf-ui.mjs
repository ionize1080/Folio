import { icon } from "./icons.mjs";
export function installWebPDF({ writeFile }) {
  const run = async (options) => {
    const result = await window.desktop.webPDF(options);
    const name =
      (result.title || "网页")
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
        .slice(0, 100) + ".pdf";
    const saved = await writeFile(name, new Uint8Array(result.bytes), "pdf");
    return {
      saved: !!saved,
      title: result.title,
      url: result.url,
      mode: result.mode,
    };
  };
  const button = document.createElement("button");
  button.id = "web-pdf";
  button.innerHTML = icon("globe") + "网页转 PDF";
  document.querySelector(".more-tools-menu").append(button);
  button.onclick = () => {
    button.closest("details").open = false;
    const d = document.createElement("dialog");
    d.className = "assembly-dialog";
    d.innerHTML =
      '<header><h2>网页转 PDF</h2><button data-close>×</button></header><label>网页地址<input data-url type="url" placeholder="https://…"></label><label>版式<select data-mode><option value="reader">精致阅读 · 正文与图片</option><option value="original">原网页 · 网站打印版式</option></select></label><p>阅读模式去除导航等干扰，保留正文和来源。适合文章；复杂应用页面请选择原网页。</p><div class="form-grid"><label>字号（pt）<input data-font type="number" min="9" max="20" value="12"></label><label>行距<input data-line type="number" min="1.2" max="2.4" step="0.05" value="1.75"></label><label>纸张<select data-theme><option value="paper">柔和米白</option><option value="white">纯白</option></select></label></div><p data-status role="status"></p><footer><button data-run>生成并另存…</button></footer>';
    document.body.append(d);
    d.showModal();
    const q = (s) => d.querySelector(s);
    let busy = false;
    const close = () => {
      if (!busy) {
        d.close();
        d.remove();
      }
    };
    q("[data-close]").onclick = close;
    d.oncancel = (e) => {
      e.preventDefault();
      close();
    };
    q("[data-run]").onclick = async () => {
      if (busy) return;
      busy = true;
      q("[data-run]").disabled = true;
      q("[data-status]").textContent = "正在渲染网页与排版…";
      try {
        const r = await run({
          url: q("[data-url]").value,
          mode: q("[data-mode]").value,
          fontSize: Number(q("[data-font]").value),
          lineHeight: Number(q("[data-line]").value),
          theme: q("[data-theme]").value,
        });
        q("[data-status]").textContent = r.saved ? "已保存 PDF" : "已取消保存";
      } catch (e) {
        q("[data-status]").textContent = e.message;
      } finally {
        busy = false;
        q("[data-run]").disabled = false;
      }
    };
  };
  return run;
}
