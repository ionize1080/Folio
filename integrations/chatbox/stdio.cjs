const { Server } = require("@modelcontextprotocol/sdk/server/index.js"),
  {
    StdioServerTransport,
  } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const net = require("node:net"),
  readline = require("node:readline");
const pipe = process.env.FOLIO_MCP_PIPE,
  token = process.env.FOLIO_MCP_TOKEN;
if (!pipe || !token) process.exit(1);
const socket = net.createConnection(pipe),
  pending = new Map();
let sequence = 0;
socket.on("error", () => process.exit(1));
socket.on("close", () => process.exit(0));
readline.createInterface({ input: socket }).on("line", (line) => {
  try {
    const m = JSON.parse(line),
      p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    clearTimeout(p.timer);
    m.error ? p.reject(Error(m.error)) : p.resolve(m.result);
  } catch {}
});
function call(params) {
  return new Promise((resolve, reject) => {
    const id = ++sequence,
      timer = setTimeout(() => {
        pending.delete(id);
        reject(Error("操作超时"));
      }, 310000);
    pending.set(id, { resolve, reject, timer });
    socket.write(JSON.stringify({ id, token, params }) + "\n");
  });
}
const server = new Server(
  { name: "Folio PDF", version: "2.0.0" },
  { capabilities: { tools: {}, resources: {} } },
);
const tools = [
  {
    name: "folio_help",
    description: "按需获取Folio能力目录、完整参数和操作指南；先查询再操作",
    inputSchema: {
      type: "object",
      properties: { operation: { type: "string" } },
    },
  },
  {
    name: "folio_operation",
    description:
      "操作当前Folio文档，修改须传最新revision。OCR优先本地，复杂页面按需请求page.image。",
    inputSchema: {
      type: "object",
      properties: {
        operation: { type: "string" },
        revision: { type: "string" },
        options: { type: "object" },
      },
      required: ["operation"],
    },
  },
];
tools.push(
  {
    name: "pdf_help",
    description:
      "按需查询完整开源PDF MCP工具目录和参数；OCR优先使用folio_operation ocr.local",
    inputSchema: {
      type: "object",
      properties: { operation: { type: "string" } },
    },
  },
  {
    name: "pdf_operation",
    description:
      "调用开源PDF MCP原生操作；先pdf_help获取准确参数。文件操作受Folio审批。",
    inputSchema: {
      type: "object",
      properties: {
        operation: { type: "string" },
        options: { type: "object" },
      },
      required: ["operation"],
    },
  },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    if (!tools.some((t) => t.name === req.params.name)) throw Error("未知工具");
    if (
      req.params.name.endsWith("_operation") &&
      typeof req.params.arguments?.operation !== "string"
    )
      throw Error(
        "Missing required operation field alongside options, for example operation=page.image. Help does not set the next operation.",
      );
    const result = await call(req.params);
    return result?.content
      ? result
      : { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: e.message }] };
  }
});
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    { uri: "folio://guide", name: "Folio指南", mimeType: "application/json" },
  ],
}));
server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  if (req.params.uri !== "folio://guide") throw Error("未知资源");
  return {
    contents: [
      {
        uri: "folio://guide",
        mimeType: "application/json",
        text: JSON.stringify(await call({ name: "folio_help" })),
      },
    ],
  };
});
server.connect(new StdioServerTransport()).catch(() => process.exit(1));
process.stdin.on("end", () => {
  socket.destroy();
  process.exit(0);
});
