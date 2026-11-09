const {
  Client,
} = require("../.ai-runtime/Chatbox/node_modules/@modelcontextprotocol/sdk/dist/cjs/client/index.js");
const {
  StdioClientTransport,
} = require("../.ai-runtime/Chatbox/node_modules/@modelcontextprotocol/sdk/dist/cjs/client/stdio.js");
const fs = require("fs"),
  path = require("path"),
  assert = require("assert/strict"),
  crypto = require("crypto");
(async () => {
  const c = new Client({ name: "Folio regression", version: "1" });
  await c.connect(
    new StdioClientTransport({
      command: path.resolve(".ai-runtime/pdf-runtime/python.exe"),
      args: [path.resolve(".ai-runtime/pdf-runtime/pdf-server.py")],
      stderr: "pipe",
    }),
  );
  try {
    const { tools } = await c.listTools();
    assert.equal(tools.length, 64);
    const source = path.resolve("tests/output/modes.pdf"),
      hash = () =>
        crypto
          .createHash("sha256")
          .update(fs.readFileSync(source))
          .digest("hex"),
      before = hash();
    const dir = fs.mkdtempSync(path.resolve("tests/output/pdf-objects-"));
    let current = source,
      step = 0;
    async function call(operation, options = {}, write = false) {
      const result = await c.callTool({
        name: "pdf_object_operation",
        arguments: {
          path: current,
          operation,
          options,
          ...(write ? { output: path.join(dir, ++step + ".pdf") } : {}),
        },
      });
      assert(!result.isError, JSON.stringify(result));
      const value =
        result.structuredContent ||
        JSON.parse(result.content.find((x) => x.type === "text").text);
      if (write) current = value.output;
      return value;
    }
    await call(
      "outline.write",
      {
        toc: [
          [1, "Root", 1],
          [2, "Child", 2],
        ],
      },
      true,
    );
    assert.equal((await call("outline.read")).toc.length, 2);
    const { xref } = await call("document.catalog");
    await call(
      "object.set",
      { xref, key: "FolioQA", value: "(verified)" },
      true,
    );
    assert.equal(
      (await call("object.get", { xref, key: "FolioQA" })).value[1],
      "verified",
    );
    await call(
      "attachments.add",
      { name: "qa.txt", base64: Buffer.from("attachment").toString("base64") },
      true,
    );
    assert.equal(
      Buffer.from(
        (await call("attachments.read", { name: "qa.txt" })).base64,
        "base64",
      ).toString(),
      "attachment",
    );
    await call(
      "page.labels.write",
      {
        labels: [{ startpage: 0, prefix: "QA-", style: "D", firstpagenum: 1 }],
      },
      true,
    );
    assert.equal((await call("page.labels.read")).labels[0].prefix, "QA-");
    await call(
      "page.links.insert",
      {
        page: 1,
        link: { kind: 1, from: [10, 10, 80, 30], page: 1, to: [0, 0] },
      },
      true,
    );
    assert((await call("page.links.read", { page: 1 })).links.length > 0);
    const denied = await c.callTool({
      name: "pdf_object_operation",
      arguments: {
        path: source,
        operation: "object.set",
        options: { xref: 1, key: "X", value: "null" },
        output: source,
      },
    });
    assert(denied.isError);
    assert.equal(hash(), before);
    console.log(
      "PASS 64 tools, outline, raw object, attachment, labels, links, source protection",
    );
  } finally {
    await c.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
