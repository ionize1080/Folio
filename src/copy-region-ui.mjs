import { extractLines } from "./text-lines.mjs";
import { selectRegion } from "./region-select.mjs";
export async function copyRegionDialog(ctx) {
  const { S, surface, modal, closeModal, setCleanup, guarded, copy } = ctx,
    $ = (s) => document.querySelector(s);
  if (!S.pdf) return;
  let closed = false,
    task,
    stop,
    lines = [],
    view;
  modal(
    "框选文字 · 按视觉行复制",
    `<p>在左侧拖框选择代码与名称等区域。右侧显示将复制的文字；大间隔可转换为制表符，方便粘贴到 Excel。</p><div class="native-workspace"><div class="native-preview"><canvas id="copy-region-canvas"></canvas></div><div class="native-properties"><button id="copy-region-pick">拖框选择 / 重新选择</button><label class="check"><input id="copy-region-tabs" type="checkbox">大间隔使用制表符</label><textarea id="copy-region-text" rows="14" spellcheck="false"></textarea><small>按片段范围提取，复制前可手动校对。</small></div></div>`,
    [
      { text: "关闭", run: closeModal },
      {
        text: "复制",
        primary: true,
        run: () => copy($("#copy-region-text").value),
      },
    ],
  );
  setCleanup(() => {
    closed = true;
    task?.cancel();
    stop?.();
  });
  const p = await S.pdf.getPage(S.page);
  if (closed) return;
  const base = p.getViewport({ scale: 1, rotation: surface.rotation(S.page) });
  view = p.getViewport({
    scale: Math.min(680 / base.width, 1.2),
    rotation: surface.rotation(S.page),
  });
  const c = $("#copy-region-canvas"),
    ratio = Math.min(devicePixelRatio || 1, 2);
  c.width = Math.ceil(view.width * ratio);
  c.height = Math.ceil(view.height * ratio);
  c.style.width = view.width + "px";
  c.style.height = view.height + "px";
  task = p.render({
    canvasContext: c.getContext("2d"),
    viewport: view,
    transform: [ratio, 0, 0, ratio, 0, 0],
  });
  await task.promise;
  if (closed) return;
  let selected = [];
  const output = () => {
    $("#copy-region-text").value = selected
      .map((l) =>
        $("#copy-region-tabs").checked ? l.replace(/ {2,}/g, "\t") : l,
      )
      .join("\n");
  };
  const pick = () => {
    stop?.();
    stop = selectRegion(c, (r) =>
      guarded(async () => {
        const scale = view.scale;
        lines = await extractLines(S.pdf, S.page, surface.rotation(S.page), {
          visualRows: true,
          ocr: S.ocr,
        });
        if (closed) return;
        selected = lines
          .map((l) => {
            const parts = l.segments.filter((f) => {
              const x = (f.left + f.right) / 2,
                y = (f.top + f.bottom) / 2;
              return (
                x >= r[0] / scale &&
                x <= r[2] / scale &&
                y >= r[1] / scale &&
                y <= r[3] / scale
              );
            });
            let t = "";
            for (let i = 0; i < parts.length; i++) {
              const f = parts[i],
                prev = parts[i - 1];
              t +=
                (prev
                  ? f.left - prev.right > Math.max(24, (f.bottom - f.top) * 2)
                    ? "  "
                    : f.left - prev.right > 3
                      ? " "
                      : ""
                  : "") + f.text;
            }
            return t;
          })
          .filter(Boolean);
        output();
      }),
    );
  };
  $("#copy-region-pick").onclick = pick;
  $("#copy-region-tabs").onchange = output;
  pick();
}
