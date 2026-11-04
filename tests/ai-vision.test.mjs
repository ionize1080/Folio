import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { normalize } = createRequire(import.meta.url)(
  "../integrations/chatbox/vision-body.cjs",
);
test("native AI SDK MCP content arrays are converted during automatic tool loops", () => {
  const body = {
    messages: [
      {
        role: "assistant",
        tool_calls: [
          { id: "a", function: { name: "mcp__folio_pdf__folio_operation" } },
        ],
      },
      {
        role: "tool",
        tool_call_id: "a",
        content: JSON.stringify([
          { type: "text", text: "page metadata" },
          { type: "image-data", mediaType: "image/png", data: "YWJj" },
        ]),
      },
    ],
  };
  const out = JSON.parse(normalize(JSON.stringify(body)));
  assert.equal(out.messages.length, 3);
  assert(!out.messages[1].content.includes("YWJj"));
  assert.equal(
    out.messages[2].content[1].image_url.url,
    "data:image/png;base64,YWJj",
  );
});
test("MCP image is sent as vision input rather than base64 text, after all tool replies", () => {
  const body = {
    messages: [
      {
        role: "assistant",
        tool_calls: [
          { id: "a", function: { name: "mcp__folio_pdf__folio_operation" } },
          { id: "b", function: { name: "other" } },
        ],
      },
      {
        role: "tool",
        tool_call_id: "a",
        content: JSON.stringify({
          content: [
            { type: "text", text: "page 1" },
            { type: "image", mimeType: "image/png", data: "YWJj" },
          ],
        }),
      },
      { role: "tool", tool_call_id: "b", content: "done" },
    ],
  };
  const out = JSON.parse(normalize(JSON.stringify(body)));
  assert.equal(out.messages.length, 4);
  assert.equal(out.messages[2].tool_call_id, "b");
  assert(!out.messages[1].content.includes("YWJj"));
  assert.equal(
    out.messages[3].content[1].image_url.url,
    "data:image/png;base64,YWJj",
  );
  assert.deepEqual(JSON.parse(normalize(JSON.stringify(out))), out);
});
test("unrelated tool output is preserved", () => {
  const body = JSON.stringify({
    messages: [
      {
        role: "tool",
        tool_call_id: "unknown",
        content:
          '{"content":[{"type":"image","mimeType":"image/png","data":"YWJj"}]}',
      },
    ],
  });
  assert.deepEqual(JSON.parse(normalize(body)), JSON.parse(body));
});
