const { BrowserWindow, session } = require("electron");
const fs = require("node:fs");
function validate(options = {}) {
  const url = new URL(options.url);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw Error("请输入不含登录信息的 HTTP/HTTPS 网页地址");
  const mode = options.mode || "reader";
  if (!["reader", "original"].includes(mode)) throw Error("无效阅读模式");
  const fontSize = Number(options.fontSize ?? 12),
    lineHeight = Number(options.lineHeight ?? 1.75);
  if (
    !Number.isFinite(fontSize) ||
    fontSize < 9 ||
    fontSize > 20 ||
    !Number.isFinite(lineHeight) ||
    lineHeight < 1.2 ||
    lineHeight > 2.4
  )
    throw Error("字号或行距超出范围");
  const theme = options.theme || "paper";
  if (!["paper", "white"].includes(theme)) throw Error("无效主题");
  return { url: url.href, mode, fontSize, lineHeight, theme };
}
async function render(options) {
  const o = validate(options),
    partition = "folio-web-" + require("node:crypto").randomUUID();
  const ses = session.fromPartition(partition);
  ses.setPermissionRequestHandler((_, __, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  ses.webRequest.onBeforeRequest((d, cb) =>
    cb({ cancel: !/^https?:|^data:|^about:/.test(d.url) }),
  );
  ses.on("will-download", (event) => event.preventDefault());
  const windows = [];
  const make = () => {
    const w = new BrowserWindow({
      show: false,
      webPreferences: {
        session: ses,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    windows.push(w);
    return w;
  };
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const page = make();
        await page.loadURL(o.url);
        const finalURL = page.webContents.getURL();
        let target = page,
          title = await page.webContents.executeJavaScript("document.title");
        if (o.mode === "reader") {
          const source = fs.readFileSync(
            require.resolve("@mozilla/readability/Readability.js"),
            "utf8",
          );
          const article =
            await page.webContents.executeJavaScriptInIsolatedWorld(194, [
              {
                code:
                  source +
                  ";new Readability(document.cloneNode(true), {maxElemsToParse:100000}).parse()",
              },
            ]);
          if (!article?.content || article.textContent.trim().length < 100)
            throw Error("未识别到足够正文，请使用原网页模式");
          if (article.content.length > 8 * 1024 * 1024)
            throw Error("网页正文过大");
          target = make();
          await target.loadURL("about:blank");
          title = article.title || title;
          const purifier = fs.readFileSync(
            require.resolve("dompurify/dist/purify.js"),
            "utf8",
          );
          await target.webContents.executeJavaScript(purifier);
          await target.webContents
            .executeJavaScript(`(()=>{const a=${JSON.stringify({ content: article.content, title, byline: article.byline || "", ...o, url: finalURL })};
    const base=document.createElement('base');base.href=a.url;document.head.append(base);document.title=a.title;
    const meta=document.createElement('meta');meta.httpEquiv='Content-Security-Policy';meta.content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; font-src 'none';";document.head.append(meta);
    const style=document.createElement('style');style.textContent='@page{size:A4;margin:22mm 23mm}body{margin:0;background:'+ (a.theme==='paper'?'#faf8f2':'white')+';color:#242424;font-family:Georgia,"Noto Serif CJK SC","SimSun",serif;font-size:'+a.fontSize+'pt;line-height:'+a.lineHeight+'}h1{font-size:28pt;line-height:1.25;letter-spacing:-.025em;margin:0 0 14pt}h2,h3{line-height:1.35;break-after:avoid}p{orphans:3;widows:3;margin:0 0 1em}img,svg{max-width:100%;height:auto}figure,table,pre{max-width:100%;break-inside:avoid}figcaption,.source{font-family:Arial,sans-serif;font-size:9pt;color:#666}a{color:#345b7e;overflow-wrap:anywhere}table{border-collapse:collapse;font-size:10pt}td,th{padding:6pt;border-bottom:1px solid #ddd}pre{white-space:pre-wrap;overflow-wrap:anywhere}blockquote{border-left:2pt solid #bbb;margin-left:0;padding-left:14pt;color:#555}';document.head.append(style);
    const h=document.createElement('h1');h.textContent=a.title;document.body.append(h);
    const p=document.createElement('p');p.className='source';p.textContent=a.byline;const link=document.createElement('a');link.href=a.url;link.textContent=a.url;p.append(document.createElement('br'),link);document.body.append(p);
    const main=document.createElement('main');main.innerHTML=DOMPurify.sanitize(a.content,{FORBID_TAGS:['style','form','input','button','iframe'],FORBID_ATTR:['style','srcset']});document.body.append(main);
    for(const img of document.images){img.loading='eager';img.removeAttribute('width');img.removeAttribute('height');}
   })()`);
        }
        await target.webContents.executeJavaScript(
          "Promise.all([document.fonts.ready,...Array.from(document.images).map(i=>i.complete?Promise.resolve():new Promise(r=>{i.onload=i.onerror=r;setTimeout(r,5000)}))])",
        );
        const bytes = await target.webContents.printToPDF({
          printBackground: true,
          pageSize: "A4",
          preferCSSPageSize: o.mode === "reader",
          generateTaggedPDF: true,
          generateDocumentOutline: true,
        });
        return { bytes, title, url: finalURL, mode: o.mode };
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("网页生成超过 60 秒，请稍后重试")),
          60000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    for (const w of windows) if (!w.isDestroyed()) w.destroy();
    await ses.clearStorageData();
  }
}
module.exports = { render, validate };
