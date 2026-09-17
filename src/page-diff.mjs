export async function pageDiff({
  S,
  source,
  output,
  pdfjs,
  modal,
  closeModal,
  setCleanup,
  guarded,
  surface,
  esc,
}) {
  let closed = false,
    epoch = 0,
    tasks = [];
  const docs = [];
  modal(
    "全页输出对照",
    `<div class="diff-controls"><label>PDF 页<input id="diff-page" type="number" min="1" max="${S.info.pageCount}" value="${S.page}"></label><button id="diff-prev">上一处变化页</button><button id="diff-next">下一处变化页</button><label>显示<select id="diff-mode"><option value="side">并排</option><option value="overlay">叠加</option><option value="changes">变化标记</option></select></label><label>叠加强度<input id="diff-opacity" type="range" min="0" max="1" step="0.05" value="0.5"></label></div><p id="diff-status" role="status">正在读取实际输出…</p><div class="diff-pages"><figure><figcaption>打开时的原件</figcaption><canvas id="diff-before"></canvas></figure><figure><figcaption>当前待保存输出</figcaption><div class="diff-output"><canvas id="diff-after"></canvas><canvas id="diff-map"></canvas></div></figure></div><p class="hint">点击输出中的变化区域可定位到页面。标记来自整页像素差异，含文字、图片、边框和位移；轻微抗锯齿差异已过滤，仍需人工核对。</p>`,
    [{ text: "关闭", run: closeModal }],
  );
  document.querySelector("#modal").classList.add("page-diff-dialog");
  setCleanup(() => {
    closed = true;
    epoch++;
    tasks.forEach((t) => t.cancel());
    docs.forEach((d) => d.destroy());
    document.querySelector("#modal").classList.remove("page-diff-dialog");
  });
  const $ = (q) => document.querySelector(q),
    impacted = [
      ...new Set([
        S.page,
        ...(S.nativeEdits || []).map((e) => e.page),
        ...(S.ocr || []).map((e) => e.page),
        ...(S.annotations || []).map((e) => e.page),
        ...Object.keys(S.rotation || {}).map(Number),
      ]),
    ]
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
  for (const bytes of [source, output]) {
    const d = await pdfjs.getDocument({
      data: bytes.slice(),
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
    if (closed) {
      d.destroy();
      return;
    }
    docs.push(d);
  }
  let beforePixels,
    afterPixels,
    scale = 1,
    current = S.page;
  function display() {
    if (!beforePixels) return;
    const mode = $("#diff-mode").value,
      c = $("#diff-after"),
      g = c.getContext("2d");
    g.putImageData(afterPixels, 0, 0);
    if (mode === "overlay") {
      const temp = document.createElement("canvas");
      temp.width = c.width;
      temp.height = c.height;
      temp.getContext("2d").putImageData(beforePixels, 0, 0);
      g.globalAlpha = +$("#diff-opacity").value;
      g.drawImage(temp, 0, 0);
      g.globalAlpha = 1;
    }
    $(".diff-pages").classList.toggle("single", mode !== "side");
    $("#diff-map").hidden = mode !== "changes";
  }
  async function render(n) {
    if (!Number.isInteger(n) || n < 1 || n > docs[1].numPages)
      throw Error("页码超出范围");
    const rev = ++epoch;
    tasks.forEach((t) => t.cancel());
    tasks = [];
    current = n;
    $("#diff-page").value = n;
    $("#diff-status").textContent = `正在比较第 ${n} 页…`;
    const off = [];
    for (let i = 0; i < 2; i++) {
      const p = await docs[i].getPage(Math.min(n, docs[i].numPages)),
        v = p.getViewport({ scale: 1 });
      scale = Math.min(1.5, 900 / v.width);
      const vp = p.getViewport({ scale }),
        c = document.createElement("canvas");
      c.width = Math.ceil(vp.width);
      c.height = Math.ceil(vp.height);
      const task = p.render({
        canvasContext: c.getContext("2d"),
        viewport: vp,
      });
      tasks.push(task);
      await task.promise;
      if (closed || rev !== epoch) return;
      off.push(c);
    }
    const w = Math.max(...off.map((c) => c.width)),
      h = Math.max(...off.map((c) => c.height));
    const images = off.map((c) => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const g = canvas.getContext("2d");
      g.fillStyle = "white";
      g.fillRect(0, 0, w, h);
      g.drawImage(c, 0, 0);
      return g.getImageData(0, 0, w, h);
    });
    [beforePixels, afterPixels] = images;
    for (const [id, data] of [
      ["diff-before", beforePixels],
      ["diff-after", afterPixels],
    ]) {
      const c = $("#" + id);
      c.width = w;
      c.height = h;
      c.getContext("2d").putImageData(data, 0, 0);
    }
    const map = $("#diff-map");
    map.width = w;
    map.height = h;
    const g = map.getContext("2d");
    g.fillStyle = "#eb8d283a";
    g.strokeStyle = "#c77416";
    let changed = 0,
      regions = 0;
    for (let y = 0; y < h; y += 24)
      for (let x = 0; x < w; x += 24) {
        let count = 0;
        for (let yy = y; yy < Math.min(y + 24, h); yy++)
          for (let xx = x; xx < Math.min(x + 24, w); xx++) {
            const i = (yy * w + xx) * 4;
            if (
              Math.max(
                ...[0, 1, 2].map((k) =>
                  Math.abs(beforePixels.data[i + k] - afterPixels.data[i + k]),
                ),
              ) > 35
            )
              count++;
          }
        changed += count;
        if (count > 6) {
          regions++;
          g.fillRect(x, y, 24, 24);
          g.strokeRect(x, y, 24, 24);
        }
      }
    $("#diff-status").textContent =
      `第 ${n} 页 · ${regions} 个变化网格 · 显著差异像素 ${((changed / (w * h)) * 100).toFixed(2)}% · 当前输出已成功重新解析和渲染`;
    display();
  }
  $("#diff-mode").onchange = display;
  $("#diff-opacity").oninput = display;
  $("#diff-page").onchange = () =>
    guarded(() => render(+$("#diff-page").value));
  for (const [id, dir] of [
    ["diff-prev", -1],
    ["diff-next", 1],
  ])
    $("#" + id).onclick = () =>
      guarded(() =>
        render(
          dir > 0
            ? impacted.find((n) => n > current) || impacted[0]
            : [...impacted].reverse().find((n) => n < current) ||
                impacted.at(-1),
        ),
      );
  $(".diff-output").onclick = async (e) => {
    const c = $("#diff-after"),
      r = c.getBoundingClientRect(),
      x = ((e.clientX - r.left) * c.width) / r.width / scale,
      y = ((e.clientY - r.top) * c.height) / r.height / scale;
    const p = await S.pdf.getPage(current),
      vp = p.getViewport({ scale: 1, rotation: surface.rotation(current) }),
      point = vp.convertToPdfPoint(x, y);
    closeModal();
    await surface.go(current, {
      mode: "XYZ",
      args: [point[0], point[1], null],
    });
  };
  await render(current);
}
