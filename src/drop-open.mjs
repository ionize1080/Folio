export function installDropOpen({ open, toast, isBusy }) {
  const veil = document.createElement("div");
  veil.className = "file-drop-veil";
  veil.hidden = true;
  veil.textContent = "松开以打开 PDF 或 Folio 工程";
  document.body.append(veil);
  let depth = 0;
  const isFile = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  const hide = () => {
    depth = 0;
    veil.hidden = true;
  };
  document.addEventListener("dragenter", (e) => {
    if (isFile(e)) {
      e.preventDefault();
      depth++;
      veil.hidden = false;
    }
  });
  document.addEventListener("dragover", (e) => {
    if (isFile(e)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  });
  document.addEventListener("dragleave", (e) => {
    if (isFile(e) && --depth <= 0) hide();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
  document.addEventListener(
    "drop",
    async (e) => {
      if (!isFile(e)) return;
      e.preventDefault();
      e.stopPropagation();
      hide();
      if (isBusy()) {
        toast("正在处理文档，请完成当前操作后再拖入");
        return;
      }
      const files = [...e.dataTransfer.files].filter((f) =>
        /\.(pdf|folio)$/i.test(f.name),
      );
      if (!files.length) {
        toast("请拖入 PDF 或 .folio 文件；文件夹和快捷方式暂不支持");
        return;
      }
      const read = async (f) =>
        window.desktop?.droppedFile
          ? window.desktop.droppedFile(f)
          : { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
      try {
        if (files.length === 1) await open(await read(files[0]));
        else {
          const dlg = document.createElement("dialog");
          dlg.className = "drop-choice";
          const heading = document.createElement("h2");
          heading.textContent = "选择要打开的文档";
          dlg.append(heading);
          for (const f of files) {
            const b = document.createElement("button");
            b.textContent = f.name;
            b.onclick = async () => {
              dlg.close();
              dlg.remove();
              try {
                await open(await read(f));
              } catch (err) {
                toast(err.message);
              }
            };
            dlg.append(b);
          }
          const cancel = document.createElement("button");
          cancel.textContent = "取消";
          cancel.onclick = () => {
            dlg.close();
            dlg.remove();
          };
          dlg.append(cancel);
          document.body.append(dlg);
          dlg.addEventListener("cancel", () => dlg.remove());
          dlg.showModal();
        }
      } catch (err) {
        toast(err.message);
      }
    },
    true,
  );
}
