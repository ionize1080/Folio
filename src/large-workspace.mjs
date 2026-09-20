// File-backed reading / outline channel. No full source PDF enters the renderer.
export async function openLargeWorkspace(file, ctx) {
  const api = window.desktop;
  const host = document.createElement("dialog");
  host.className = "large-workspace";
  host.innerHTML = `<header><strong>Folio · 大文件</strong><span data-name></span><button data-save>另存书签副本</button><button data-cancel>停止任务</button><button data-close>关闭</button></header>
  <div class="large-body"><aside><form data-unlock hidden><label>文档密码<input data-password type="password" autocomplete="off"></label><button>解锁文档</button></form><p class="callout">此通道支持阅读和书签整理。原件保留，修改另存副本。OCR、页上编辑与工程续编请使用普通工作区。</p><div class="large-actions"><button data-add>添加</button><button data-remove>删除</button><button data-undo>撤销</button></div><label>筛选书签<input data-filter type="search"></label><select data-list size="10" aria-label="书签列表"></select><div class="large-actions"><button data-prev-list>上一组</button><span data-list-count></span><button data-next-list>下一组</button></div><label>标题<input data-title></label><div class="large-actions"><label>级别<input data-level type="number" min="1" max="64"></label><label>物理页<input data-target type="number" min="1"></label></div><button data-update>更新所选书签</button><details><summary>自动书签 · 预览后追加</summary><label>每行一个层级的正则<textarea data-rules rows="3" placeholder="^第.+章\n^第.+节"></textarea></label><div class="large-actions"><label>开始页<input data-from type="number" value="1" min="1"></label><label>结束页<input data-to type="number" min="1"></label></div><button data-scan>扫描文字</button><pre data-preview></pre><button data-apply disabled>追加预览结果</button><p>扫描图需先有文字层；扫描不会自动执行 OCR。</p></details></aside>
  <section><nav><button data-prev>上一页</button><input data-page type="number" min="1" aria-label="当前页"><span data-pages></span><button data-next>下一页</button><select data-zoom aria-label="缩放"><option value="fit">适合宽度</option><option value="1">100%</option><option value="1.5">150%</option><option value="2">200%</option><option value="3">300%</option></select></nav><div class="large-canvas"><img data-image alt="当前 PDF 页面"></div></section></div><footer data-status role="status"></footer>`;
  const $ = (s) => host.querySelector(s);
  let info,
    rows = [],
    history = [],
    selected = -1,
    page = 1,
    dirty = false,
    busy = false,
    closed = false,
    serial = 0,
    listOffset = 0,
    preview = [];
  const status = (s) => ($("[data-status]").textContent = s);
  const mark = () => {
    dirty = true;
    api.setDirty(true);
    $("[data-name]").textContent = file.name + " · 书签未保存";
  };
  const checkpoint = () => {
    history.push(structuredClone(rows));
    if (history.length > 30) history.shift();
  };
  const guarded = (fn) => async () => {
    try {
      await fn();
    } catch (e) {
      if (!closed) status(e.message || String(e));
    }
  };
  const ensureIdle = () => {
    if (busy) throw Error("请先等待当前任务或停止");
  };
  function list() {
    const filter = $("[data-filter]").value.toLocaleLowerCase();
    const matches = rows
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.title.toLocaleLowerCase().includes(filter));
    listOffset = Math.min(
      listOffset,
      Math.max(0, Math.floor((matches.length - 1) / 200) * 200),
    );
    $("[data-list]").replaceChildren();
    for (const { r, i } of matches.slice(listOffset, listOffset + 200)) {
      const o = document.createElement("option");
      o.value = i;
      o.textContent = `${"　".repeat(Math.min(8, r.level - 1))}${r.title} · ${r.page > 0 ? r.page : "原动作"}`;
      $("[data-list]").append(o);
    }
    $("[data-list]").value = selected;
    $("[data-list-count]").textContent =
      `${matches.length ? listOffset + 1 : 0}–${Math.min(listOffset + 200, matches.length)} / ${matches.length}`;
  }
  function select(index) {
    selected = index;
    const r = rows[index];
    if (!r) return;
    $("[data-title]").value = r.title;
    $("[data-level]").value = r.level;
    $("[data-target]").value = r.page > 0 ? r.page : "";
    $("[data-target]").placeholder = "保留原动作";
  }
  async function render() {
    const token = ++serial;
    page = Math.max(1, Math.min(info.pages, Math.trunc(page) || 1));
    $("[data-page]").value = page;
    const zoom = $("[data-zoom]").value;
    const viewport = $(".large-canvas");
    status(`读取第 ${page} 页…`);
    // Native page dimensions are known after render; fit uses conservative width
    // first and adapts the CSS width without allocating a source-sized buffer.
    const scale =
      zoom === "fit"
        ? Math.min(
            3,
            Math.max(
              1,
              (viewport.clientWidth / 595) * (window.devicePixelRatio || 1),
            ),
          )
        : +zoom * (window.devicePixelRatio || 1);
    const r = await api.largePage({
      handle: file.handle,
      page,
      scale: Math.min(6, scale),
    });
    if (closed || token !== serial) return;
    const image = $("[data-image]");
    image.src = "data:image/png;base64," + r.image;
    image.style.width = zoom === "fit" ? "100%" : `${r.width * +zoom}px`;
    status(
      `第 ${page} / ${info.pages} 页 · ${(file.size / 1024 ** 3).toFixed(2)} GiB · ${dirty ? "书签未保存" : "原件未改变"}`,
    );
  }
  function matchPage(patterns, lines, p) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL("./large-rules-worker.mjs", import.meta.url),
        { type: "module" },
      );
      const timer = setTimeout(() => {
        worker.terminate();
        reject(Error("正则执行超时，请简化表达式"));
      }, 2000);
      worker.onmessage = ({ data }) => {
        clearTimeout(timer);
        worker.terminate();
        data.error ? reject(Error(data.error)) : resolve(data.results);
      };
      worker.onerror = (e) => {
        clearTimeout(timer);
        worker.terminate();
        reject(Error(e.message));
      };
      worker.postMessage({ patterns, lines, page: p });
    });
  }
  async function close() {
    ensureIdle();
    if (
      dirty &&
      !(await ctx.confirmDiscard("书签修改尚未保存，关闭大文件工作区？"))
    )
      return false;
    closed = true;
    serial++;
    api.largeCancel();
    await api.largeRelease(file.handle);
    host.close();
    host.remove();
    api.setDirty(ctx.originalDirty);
    ctx.onClose();
    return true;
  }
  ctx.onReady({ close, isDirty: () => dirty, isBusy: () => busy });
  document.body.append(host);
  host.showModal();
  $("[data-name]").textContent = file.name;
  status("正在读取文档结构…");
  host.addEventListener("cancel", (e) => {
    e.preventDefault();
    guarded(close)();
  });
  host.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      $("[data-save]").click();
    }
  });
  $("[data-close]").onclick = guarded(close);
  $("[data-cancel]").onclick = () => {
    serial++;
    api.largeCancel();
    status("已请求停止，正在清理任务…");
  };
  $("[data-list]").onchange = guarded(async () => {
    select(+$("[data-list]").value);
    if (rows[selected]?.page > 0) {
      page = rows[selected].page;
      await render();
    }
  });
  $("[data-filter]").oninput = () => {
    listOffset = 0;
    list();
  };
  $("[data-prev-list]").onclick = () => {
    listOffset = Math.max(0, listOffset - 200);
    list();
  };
  $("[data-next-list]").onclick = () => {
    listOffset += 200;
    list();
  };
  $("[data-update]").onclick = guarded(() => {
    ensureIdle();
    if (!rows[selected]) return;
    const level = +$("[data-level]").value,
      target = $("[data-target]").value.trim();
    if (!Number.isInteger(level) || level < 1 || level > 64)
      throw Error("级别无效");
    if (
      target &&
      (!Number.isInteger(+target) || +target < 1 || +target > info.pages)
    )
      throw Error("页码无效");
    checkpoint();
    rows[selected] = {
      ...rows[selected],
      title: $("[data-title]").value,
      level,
      page: target ? +target : rows[selected].page,
    };
    mark();
    list();
  });
  $("[data-add]").onclick = guarded(() => {
    ensureIdle();
    checkpoint();
    rows.push({
      id: "new-" + crypto.randomUUID(),
      level: 1,
      title: `第 ${page} 页`,
      page,
    });
    selected = rows.length - 1;
    listOffset = Math.floor(selected / 200) * 200;
    mark();
    list();
    select(selected);
  });
  $("[data-remove]").onclick = guarded(() => {
    ensureIdle();
    if (selected < 0) return;
    checkpoint();
    const level = rows[selected].level;
    let end = selected + 1;
    while (end < rows.length && rows[end].level > level) end++;
    rows.splice(selected, end - selected);
    selected = -1;
    mark();
    list();
  });
  $("[data-undo]").onclick = guarded(() => {
    ensureIdle();
    if (history.length) {
      rows = history.pop();
      selected = -1;
      mark();
      list();
    }
  });
  $("[data-prev]").onclick = guarded(async () => {
    ensureIdle();
    page--;
    await render();
  });
  $("[data-next]").onclick = guarded(async () => {
    ensureIdle();
    page++;
    await render();
  });
  $("[data-page]").onchange = guarded(async () => {
    ensureIdle();
    page = +$("[data-page]").value;
    await render();
  });
  $("[data-zoom]").onchange = guarded(render);
  $("[data-save]").onclick = guarded(async () => {
    ensureIdle();
    busy = true;
    status("正在复制原件并写入书签，请保留足够磁盘空间…");
    try {
      const r = await api.largeSave({ handle: file.handle, outlines: rows });
      if (!r.cancelled) {
        dirty = false;
        api.setDirty(ctx.originalDirty);
        $("[data-name]").textContent = file.name;
        status(
          `已保存 ${r.name} · ${r.bookmarks} 个书签已核对；当前仍阅读原件`,
        );
      }
    } finally {
      busy = false;
    }
  });
  $("[data-scan]").onclick = guarded(async () => {
    ensureIdle();
    const patterns = $("[data-rules]")
      .value.split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const from = +$("[data-from]").value,
      to = +$("[data-to]").value;
    if (
      !patterns.length ||
      patterns.length > 8 ||
      patterns.some((p) => p.length > 1000)
    )
      throw Error("请输入 1–8 层正则，每层不超过 1000 字符");
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < 1 ||
      to > info.pages ||
      from > to
    )
      throw Error("扫描页范围无效");
    preview = [];
    $("[data-apply]").disabled = true;
    busy = true;
    const token = ++serial;
    try {
      for (let p = from; p <= to; p++) {
        if (closed || serial !== token) throw Error("扫描已停止，预览未应用");
        status(`扫描第 ${p} / ${to} 页…`);
        const r = await api.largePage({
          handle: file.handle,
          page: p,
          textOnly: true,
        });
        preview.push(...(await matchPage(patterns, r.lines, p)));
        if (preview.length > 10000) throw Error("命中过多，请缩小范围");
      }
      if (serial !== token) throw Error("扫描已停止");
      $("[data-preview]").textContent =
        preview
          .slice(0, 80)
          .map((r) => `${r.level} · ${r.title} → ${r.page}`)
          .join("\n") + `\n共 ${preview.length} 项`;
      $("[data-apply]").disabled = !preview.length;
      status("扫描完成，请核对预览后追加");
    } finally {
      busy = false;
    }
  });
  $("[data-apply]").onclick = guarded(() => {
    ensureIdle();
    let previous = 0;
    for (const r of preview) {
      if (r.level > previous + 1)
        throw Error("预览有缺少父级的命中，请调整规则后重新扫描");
      previous = r.level;
    }
    const seen = new Set(rows.map((r) => `${r.title}\0${r.page}`));
    if (preview.some((r) => seen.has(`${r.title}\0${r.page}`)))
      throw Error("预览包含已有同名同页书签，请缩小范围，避免破坏父子归属");
    checkpoint();
    for (const r of preview)
      rows.push({ ...r, id: "new-" + crypto.randomUUID() });
    preview = [];
    $("[data-apply]").disabled = true;
    mark();
    list();
  });
  async function load(password = "") {
    try {
      busy = true;
      info = await api.largeInfo({ handle: file.handle, password });
      $("[data-password]").value = "";
      $("[data-unlock]").hidden = true;
      rows = info.outlines;
      $("[data-save]").disabled = !info.incremental;
      $("[data-save]").title = info.incremental ? "保留原件，另存书签副本" : "此文件无法增量写入，当前仅供阅读";
      $("[data-pages]").textContent = `/ ${info.pages}`;
      $("[data-page]").max = info.pages;
      $("[data-to]").value = info.pages;
      list();
      busy = false;
      await render();
    } catch (e) {
      busy = false;
      if (String(e.message).includes("密码")) $("[data-unlock]").hidden = false;
      status(e.message + "；可关闭工作区，原件未改变");
    }
  }
  $("[data-unlock]").onsubmit = (e) => {
    e.preventDefault();
    if (!busy) void load($("[data-password]").value);
  };
  await load();
}
