// Preserve the headers produced by Chatbox's provider SDK. Chromium may replace
// forbidden headers (including User-Agent); Node fetch does not use Electron net.
module.exports = function ({ ipcMain, app }) {
  const requests = new Map();
  ipcMain.handle(
    "folio:fetch",
    async (e, { id, url, method, headers, body }) => {
      if (
        e.senderFrame !== e.sender.mainFrame ||
        !e.senderFrame.url.startsWith("file:")
      )
        throw Error("Invalid sender");
      const parsed = new URL(url);
      if (!["https:", "http:"].includes(parsed.protocol))
        throw Error("Unsupported URL");
      if (typeof id !== "string" || requests.has(id))
        throw Error("Invalid request ID");
      const controller = new AbortController();
      requests.set(id, { controller, sender: e.sender });
      const abort = () => controller.abort();
      e.sender.once("destroyed", abort);
      try {
        body = require("./vision-body.cjs").normalize(body);
        const response = await fetch(url, {
          method,
          headers,
          body,
          signal: controller.signal,
          redirect: "error",
        });
        const reader = response.body?.getReader();
        setImmediate(async () => {
          try {
            if (reader)
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (!e.sender.isDestroyed())
                  e.sender.send("folio:fetch-chunk", {
                    id,
                    data: Buffer.from(value).toString("base64"),
                  });
              }
            if (!e.sender.isDestroyed())
              e.sender.send("folio:fetch-chunk", { id, done: true });
          } catch (error) {
            if (!e.sender.isDestroyed())
              e.sender.send("folio:fetch-chunk", { id, error: error.message });
          } finally {
            requests.delete(id);
            e.sender.removeListener("destroyed", abort);
          }
        });
        return {
          status: response.status,
          statusText: response.statusText,
          headers: [...response.headers],
        };
      } catch (error) {
        requests.delete(id);
        e.sender.removeListener("destroyed", abort);
        throw error;
      }
    },
  );
  ipcMain.handle("folio:fetch-cancel", (e, id) => {
    const r = requests.get(id);
    if (r?.sender === e.sender) r.controller.abort();
  });
  app.on("before-quit", () => {
    for (const r of requests.values()) r.controller.abort();
  });
};
