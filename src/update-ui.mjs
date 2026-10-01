import { getLanguage, onLanguageChange } from "./i18n.mjs";
import { localizedReleaseNotes } from "./release-notes.mjs";
export async function updateDialog({ modal, closeModal, setCleanup }) {
  const api = window.desktop;
  if (!api?.updateInfo) throw Error("检查更新需要桌面版");
  let info = await api.updateInfo(),
    closed = false;
  modal(
    "关于 Folio · 检查更新",
    `<p data-update-current></p><label>更新通道<select id="update-channel"><option value="stable">仅正式版</option><option value="preview">包含预发布</option></select></label><label>HTTP 代理<input id="update-proxy" placeholder="留空复用系统代理，例如 http://127.0.0.1:7890"></label><label class="check"><input id="update-auto" type="checkbox">启动时自动检查（下载和安装由你确认）</label><p class="hint">与首选项共用网络设置。安装保持当前程序目录名称；旧版保留在同级备份目录，设置保存在用户配置目录。</p><div class="adjust-tools"><button id="update-check">保存设置并检查更新</button><button id="update-download">下载更新</button><button id="update-cancel">取消下载</button><button id="update-install">安装并重启</button></div><progress id="update-progress" hidden></progress><p id="update-status" role="status"></p><pre id="update-notes" class="update-notes"></pre>`,
    [{ text: "关闭", run: closeModal }],
  );
  const $ = (s) => document.querySelector(s);
  $("#update-channel").value = info.settings.channel;
  $("#update-proxy").value = info.settings.proxy;
  $("#update-auto").checked = info.settings.autoCheck;
  const labels = {
    idle: "可检查新版本",
    checking: "正在检查 GitHub Releases…",
    available: "发现新版本",
    current: "当前通道没有更新版本",
    downloading: "正在下载并校验…",
    ready: "更新包已通过 SHA-256 校验，可安装",
    installing: "正在准备安装；校验成功后将自动关闭并重启…",
    error: "更新失败",
  };
  function render(r) {
    if (closed) return;
    info = r;
    $("[data-update-current]").textContent =
      `当前版本 ${r.current}${r.release ? " · 可用 " + r.release.version : ""}`;
    $("#update-status").textContent = r.error || labels[r.phase];
    $("#update-notes").textContent = localizedReleaseNotes(r.release?.notes, getLanguage());
    const busy = ["checking", "downloading", "installing"].includes(r.phase);
    $("#update-check").disabled = busy;
    $("#update-download").disabled = r.phase !== "available";
    $("#update-install").disabled = r.phase !== "ready" || !r.supported;
    $("#update-cancel").disabled = r.phase !== "downloading";
    $("#update-progress").hidden = !["downloading", "installing"].includes(
      r.phase,
    );
    $("#update-progress").max = r.total || 1;
    $("#update-progress").value = r.received || 0;
    if (r.phase === "installing")
      $("#update-progress").removeAttribute("value");
  }
  const run = (fn) => async () => {
    try {
      await fn();
    } catch (e) {
      if (!closed) $("#update-status").textContent = e.message;
    }
  };
  $("#update-check").onclick = run(async () => {
    await api.updateConfigure({
      channel: $("#update-channel").value,
      proxy: $("#update-proxy").value,
      autoCheck: $("#update-auto").checked,
    });
    render(await api.updateCheck());
  });
  $("#update-download").onclick = run(async () =>
    render(await api.updateDownload()),
  );
  $("#update-cancel").onclick = () => api.updateCancel();
  $("#update-install").onclick = run(() => api.updateInstall());
  const off = api.onUpdate(render);
  const offLanguage = onLanguageChange(() => render(info));
  setCleanup(() => {
    closed = true;
    off();
    offLanguage();
  });
  render(info);
}
