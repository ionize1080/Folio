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
        const verifyFinish=/\/chat\/completions(?:[?/#]|$)/.test(url) && response.headers.get('content-type')?.includes('text/event-stream');
        const decoder=new TextDecoder();let frame='',finished=false;
        const incomplete=()=>Error('模型连接结束，但没有收到正常完成标记。任务可能未完成，已应用的修改保留；请发送“继续”，先核对文档再处理剩余工作。');
        const inspect=bytes=>{
          if(!verifyFinish)return;
          frame+=decoder.decode(bytes,{stream:true});
          let at;
          while((at=frame.indexOf('\n'))>=0){
            const line=frame.slice(0,at).trim();frame=frame.slice(at+1);
            if(!line.startsWith('data:'))continue;
            const data=line.slice(5).trim();
            if(data==='[DONE]'){if(!finished)throw incomplete();continue;}
            let value;try{value=JSON.parse(data);}catch{continue;}
            if(value.choices?.some(c=>c.finish_reason!=null))finished=true;
            // Let the provider SDK surface its structured API error.
            if(value.error)finished=true;
          }
        };
        setImmediate(async () => {
          try {
            if (reader)
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                inspect(value);
                if (!e.sender.isDestroyed())
                  e.sender.send("folio:fetch-chunk", {
                    id,
                    data: Buffer.from(value).toString("base64"),
                  });
              }
            if(verifyFinish&&!finished)throw incomplete();
            if (!e.sender.isDestroyed())
              e.sender.send("folio:fetch-chunk", { id, done: true });
          } catch (error) {
            await reader?.cancel().catch(()=>{});
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
