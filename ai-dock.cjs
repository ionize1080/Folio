const { spawn } = require("node:child_process"),
  path = require("node:path");
class AIDock {
  constructor({ app, win, onState }) {
    this.app = app;
    this.win = win;
    this.onState = onState;
    this.mode = "sidebar";
    this.visible = true;
    this.handle = null;
    this.helper = null;
    win.on("resize", () => this.layout());
    win.on("move", () => this.layout());
    for (const event of ["minimize", "restore", "hide", "show"])
      win.on(event, () => this.layout());
  }
  ready(handle, client) {
    if (!/^\d+$/.test(handle)) throw Error("Invalid window handle");
    this.handle = handle;
    this.visible = true;
    this.lastMode = null;
    this.client = client;
    this.layout();
  }
  state() {
    return { mode: this.mode, open: !!this.handle && this.visible };
  }
  toggle() {
    if (this.mode === "window") {
      this.client?.write(JSON.stringify({ action: "focus" }) + "\n");
    } else {
      this.visible = !this.visible;
      this.layout();
    }
  }
  setOverlay(hidden) {
    this.overlay = hidden;
    this.layout();
  }
  setMode(mode) {
    if (!["sidebar", "window"].includes(mode))
      throw Error("Invalid display mode");
    this.mode = mode;
    this.visible = true;
    this.layout();
    return this.state();
  }
  layout() {
    this.onState(this.state());
    if (!this.handle) return;
    if (this.mode === "window" && this.lastMode === "window") return;
    this.lastMode = this.mode;
    if (process.platform !== "win32") return;
    if (!this.helper) {
      this.helper = spawn(
        this.app.isPackaged
          ? path.join(process.resourcesPath, "native/runtime/python.exe")
          : path.join(__dirname, "native/runtime/python.exe"),
        [
          "-u",
          path.join(
            this.app.isPackaged
              ? path.join(process.resourcesPath, "Chatbox")
              : path.join(__dirname, "integrations/chatbox"),
            "dock.py",
          ),
        ],
        { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] },
      );
      this.helper.on("error", () => {
        this.helper = null;
      });
      this.helper.stderr.on("data", (error) =>
        console.warn("Chatbox docking:", error.toString()),
      );
    }
    const { screen } = require("electron"),
      bounds = this.win.getContentBounds(),
      scale = screen.getDisplayMatching(bounds).scaleFactor;
    const h = this.win.getNativeWindowHandle(),
      parent = (
        h.length === 8 ? h.readBigUInt64LE() : BigInt(h.readUInt32LE())
      ).toString();
    const b = this.bounds || {
      x: bounds.width - 480,
      y: 96,
      width: 480,
      height: bounds.height - 128,
    };
    const message = {
      mode: this.mode,
      hidden:
        !this.visible || (this.mode === "sidebar" &&
          (this.overlay === true || this.win.isMinimized() || !this.win.isVisible())),
      child: this.handle,
      parent,
      x: Math.round(
        (this.mode === "sidebar" ? Math.max(0, b.x) : bounds.x + 80) * scale,
      ),
      y: Math.round((this.mode === "sidebar" ? b.y : bounds.y + 80) * scale),
      width: Math.round(
        (this.mode === "sidebar"
          ? b.width
          : Math.min(1000, bounds.width - 80)) * scale,
      ),
      height: Math.round(
        (this.mode === "sidebar"
          ? Math.max(240, b.height)
          : Math.min(800, bounds.height - 80)) * scale,
      ),
    };
    this.helper?.stdin.write(JSON.stringify(message) + "\n");
    if (!this.client?.destroyed)
      this.client?.write(
        JSON.stringify({ action: "mode", mode: this.mode }) + "\n",
      );
  }
  close() {
    this.handle = null;
    this.helper?.kill();
    this.helper = null;
    this.onState(this.state());
  }
}
module.exports = { AIDock };
