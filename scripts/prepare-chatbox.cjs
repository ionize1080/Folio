const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  asar = require("@electron/asar");
const source = process.argv[2];
if (!source) throw Error("Pass extracted official Chatbox installer directory");
const archive = path.join(source, "resources/app.asar"),
  hash = (p) =>
    crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
if (
  hash(archive) !==
  "e43647af8168b731caa9afaed269a4700f8686c257fbc4dd6a254da42729fa01"
)
  throw Error("Chatbox 1.20.3 checksum mismatch");
const out = path.resolve(".ai-runtime/Chatbox");
fs.mkdirSync(out, { recursive: true });
asar.extractAll(archive, path.join(out, "native"));
for (const name of ["assets", "app.asar.unpacked"])
  fs.cpSync(
    path.join(source, "resources", name),
    path.join(out, "resources", name),
    { recursive: true },
  );
const main = path.join(out, "native/dist/main/main.js"),
  before = hash(main),
  anchor =
    'await createWindow(),ensureTray(),new AppUpdater(()=>mainWindow?.webContents.send("update-downloaded",{}))';
const text = fs.readFileSync(main, "utf8");
if (text.split(anchor).length !== 2) throw Error("Patch anchor mismatch");
fs.writeFileSync(main, text.replace(anchor, "await createWindow(),void 0"));
for (const name of [
  "bootstrap.cjs",
  "stdio.cjs",
  "network.cjs",
  "vision-body.cjs",
  "dock.ps1",
])
  fs.copyFileSync(
    path.join(__dirname, "../integrations/chatbox", name),
    path.join(out, name),
  );
fs.writeFileSync(
  path.join(out, "package.json"),
  JSON.stringify({
    name: "chatbox",
    version: "1.20.3",
    main: "bootstrap.cjs",
    private: true,
  }),
);

console.log(out);

fs.appendFileSync(
  path.join(out, "native/dist/preload/index.js"),
  fs.readFileSync(
    path.join(__dirname, "../integrations/chatbox/network-preload.cjs"),
    "utf8",
  ),
);
fs.appendFileSync(
  path.join(out, "native/dist/renderer/js/index.TlLbGKvw.js"),
  fs.readFileSync(
    path.join(__dirname, "../integrations/chatbox/network-renderer.js"),
    "utf8",
  ),
);

const inputFile = path.join(
    out,
    "native/dist/renderer/js/InputBox.DH3jG147.js",
  ),
  input = fs.readFileSync(inputFile, "utf8"),
  toolbar =
    "rr.knowledgeBase&&!M&&o.jsx(Bo,{currentKnowledgeBaseId:de?.id,onSelect:nn,";
if (input.split(toolbar).length !== 2) throw Error("Toolbar anchor mismatch");
fs.writeFileSync(
  inputFile,
  input.replace(toolbar, 'o.jsx("span",{id:"folio-toolbar-slot"}),' + toolbar),
);
fs.appendFileSync(
  path.join(out, "native/dist/renderer/js/index.TlLbGKvw.js"),
  fs.readFileSync(
    path.join(__dirname, "../integrations/chatbox/controls.js"),
    "utf8",
  ),
);

const readyInput = fs.readFileSync(inputFile, "utf8"),
  captureAnchor = "constructedMessage:E.message,needGenerating:s,";
if (readyInput.split(captureAnchor).length !== 2)
  throw Error("Message anchor mismatch");
fs.writeFileSync(
  inputFile,
  readyInput.replace(
    captureAnchor,
    "constructedMessage:await window.folioCaptureMessage(E.message),needGenerating:s,",
  ),
);
fs.appendFileSync(
  path.join(out, "native/dist/renderer/js/index.TlLbGKvw.js"),
  `
window.folioToolsStatus=()=>({state:mcpController.getServer('folio-pdf')?.status?.state,count:Object.keys(mcpController.getAvailableTools()).filter(n=>n.includes('folio_')||n.includes('pdf_help')).length});
window.folioCaptureMessage=async message=>{message=structuredClone(message);const server=mcpController.getServer('folio-pdf');if(!server)return message;const start=Date.now();while(!window.folioToolsStatus().count){if(Date.now()-start>15000)throw Error('Folio工具尚未连接，请打开Folio后重试');await new Promise(r=>setTimeout(r,100));}return message;};
`,
);

const rendererFile = path.join(
    out,
    "native/dist/renderer/js/index.TlLbGKvw.js",
  ),
  rendererSource = fs.readFileSync(rendererFile, "utf8"),
  messagesAnchor =
    "maxContextMessageCount:nu.maxContextMessageCount});const yu=[];";
if (rendererSource.split(messagesAnchor).length !== 2)
  throw Error("Model messages anchor mismatch");
fs.writeFileSync(
  rendererFile,
  rendererSource.replace(
    messagesAnchor,
    "maxContextMessageCount:nu.maxContextMessageCount});ku=window.folioExpandImages(ku);const yu=[];",
  ),
);
fs.appendFileSync(
  rendererFile,
  fs.readFileSync(
    path.join(__dirname, "../integrations/chatbox/vision.js"),
    "utf8",
  ),
);

fs.appendFileSync(rendererFile, `
window.folioLayout=mode=>{document.body.dataset.folioDisplay=mode;if(mode==='sidebar')uiStore.getState().setShowSidebar(false);};
window.folioLayout('sidebar');
window.folioControls.subscribe(state=>{if(state.mode)window.folioLayout(state.mode);});
const folioStyle=document.createElement('style');folioStyle.textContent='body[data-folio-display="sidebar"] .controls.self-start {display:none!important;}';document.head.append(folioStyle);
`);

const modified = [
  "dist/main/main.js",
  "dist/preload/index.js",
  "dist/renderer/js/index.TlLbGKvw.js",
  "dist/renderer/js/InputBox.DH3jG147.js",
];
fs.writeFileSync(
  path.join(out, "provenance.json"),
  JSON.stringify(
    {
      upstream: "https://github.com/chatboxai/chatbox/releases/tag/v1.20.3",
      sourceCommit: "d3cd0ad1e6a1127bbbf3991bb5296c181f4cbdeb",
      archiveSha256: hash(archive),
      patches: modified.map((file) => ({
        file,
        sha256: hash(path.join(out, "native", file)),
      })),
      network:
        "Native Chatbox provider SDK headers forwarded unchanged through Node fetch; MCP image results mapped to vision attachments",
    },
    null,
    2,
  ),
);
fs.cpSync(
  path.join(__dirname, "../integrations/chatbox/node_modules"),
  path.join(out, "node_modules"),
  { recursive: true },
);
fs.copyFileSync(
  path.join(__dirname, "../.ai-runtime/chatbox-source/LICENSE"),
  path.join(out, "CHATBOX-LICENSE.txt"),
);
