const {
  Client,
} = require("../.ai-runtime/Chatbox/node_modules/@modelcontextprotocol/sdk/dist/cjs/client/index.js");
const {
  StdioClientTransport,
} = require("../.ai-runtime/Chatbox/node_modules/@modelcontextprotocol/sdk/dist/cjs/client/stdio.js");
const fs = require("fs"),
  path = require("path"),
  assert = require("assert/strict");
const root = process.env.FOLIO_PDF_SAMPLES || "D:/APP/PDF Samples";
(async () => {
  const c = new Client({ name: "Folio corpus audit", version: "2" });
  await c.connect(
    new StdioClientTransport({
      command: path.resolve(".ai-runtime/pdf-runtime/python.exe"),
      args: [path.resolve(".ai-runtime/pdf-runtime/pdf-server.py")],
      stderr: "pipe",
    }),
  );
  const rows = [];
  try {
    const tools = (await c.listTools()).tools;
    assert.equal(tools.length, 60);
    async function call(name, args) {
      const r = await c.callTool({ name, arguments: args }, undefined, {
        timeout: 240000,
      });
      assert(!r.isError, JSON.stringify(r));
      return (
        r.structuredContent ||
        JSON.parse(r.content.find((b) => b.type === "text").text)
      );
    }
    for (const name of fs.readdirSync(root).filter((n) => n.endsWith(".pdf"))) {
      const file = path.join(root, name),
        start = Date.now();
      const info = await call("pdf_object_operation", {
        path: file,
        operation: "document.info",
        options: {},
      });
      const outline = await call("pdf_object_operation", {
        path: file,
        operation: "outline.read",
        options: {},
      });
      const page = Math.min(4, info.pageCount);
      const render = await c.callTool({
        name: "pdf_object_operation",
        arguments: {
          path: file,
          operation: "page.render",
          options: { page, purpose: "classify" },
        },
      });
      assert(!render.isError, JSON.stringify(render));
      assert.equal(render.content[1].type, "image");
      const meta = JSON.parse(render.content[0].text);
      assert(Math.max(meta.width, meta.height) <= 962);
      await call("get_pdf_text_blocks", { pdf_path: file, pages: [page] });
      rows.push({
        name,
        bytes: fs.statSync(file).size,
        pages: info.pageCount,
        bookmarks: outline.toc.length,
        image: meta,
        seconds: (Date.now() - start) / 1000,
      });
      console.log("PASS stdio PDF", name, info.pageCount + " pages");
    }
    const large = path.join(
      root,
      fs.readdirSync(root).find((n) => n.includes("中国交通年鉴")),
    );
    const ocr = await call("pdf_local_ocr", {
      path: large,
      page: 12,
      threshold: 0.95,
    });
    assert(ocr.blocks.length > 0);
    assert.equal(ocr.threshold, 0.95);
    console.log("PASS large-file Paddle OCR", ocr.blocks.length, "blocks");
    fs.writeFileSync(
      "tests/output/ai-corpus/pdf-mcp.json",
      JSON.stringify(
        {
          tools: tools.length,
          documents: rows,
          largeOCR: {
            blocks: ocr.blocks.length,
            lowConfidence: ocr.lowConfidence.length,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await c.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
