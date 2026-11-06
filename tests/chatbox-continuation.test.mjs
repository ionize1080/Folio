import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const window = {};
vm.runInNewContext(
  fs.readFileSync("integrations/chatbox/continuation.js", "utf8"),
  { window, Date, Map, Promise, Error },
);
const run = window.folioContinueStream;
async function collect(g) {
  const out = [];
  for await (const c of g) out.push(c);
  return out;
}
test("continues beyond 32 with transcript and original cancellation", async () => {
  let batches = 0,
    saves = 0;
  const signal = new AbortController().signal;
  const out = await collect(
    run({
      messages: [{ role: "user", content: "task" }],
      options: { signal },
      checkpoint: async () => saves++,
      history: async () => [{ role: "assistant", content: "completed tools" }],
      phase: () => {},
      model: {
        async *chatStream(messages, options) {
          assert.equal(options.signal, signal);
          if (batches++) assert.equal(messages[1].content, "completed tools");
          for (let i = 0; i < 32; i++)
            yield { type: "text-delta", text: String(i) };
          yield {
            type: "finish",
            finishReason: batches < 3 ? "tool-calls" : "stop",
          };
        },
      },
    }),
  );
  assert.equal(batches, 3);
  assert.equal(saves, 2);
  assert.equal(out.at(-1).finishReason, "stop");
  assert.equal(out.length, 97);
});
test("same revision write replay executes only once, repeated replay stops", async () => {
  let writes = 0;
  await assert.rejects(
    collect(
      run({
        messages: [],
        options: {
          tools: { edit: { execute: async () => ({ written: ++writes }) } },
        },
        checkpoint: async () => {},
        history: async () => [{}],
        phase: () => {},
        model: {
          async *chatStream(_, o) {
            await o.tools.edit.execute({ revision: "v1" });
            yield { type: "finish", finishReason: "tool-calls" };
          },
        },
      }),
    ),
    /反复/,
  );
  assert.equal(writes, 1);
});
test("reads remain live and identical no-progress cycles stop", async () => {
  let reads = 0;
  await assert.rejects(
    collect(
      run({
        messages: [],
        options: {
          tools: {
            read: {
              execute: async () => {
                reads++;
                return { revision: "v1" };
              },
            },
          },
        },
        checkpoint: async () => {},
        history: async () => [{}],
        phase: () => {},
        model: {
          async *chatStream(_, o) {
            await o.tools.read.execute({});
            yield { type: "finish", finishReason: "tool-calls" };
          },
        },
      }),
    ),
    /反复/,
  );
  assert.equal(reads, 3);
});
test("transport interruption and output length never retry unknown writes", async () => {
  for (const reason of [undefined, "length", "error"]) {
    let calls = 0;
    await collect(
      run({
        messages: [],
        options: {},
        model: {
          async *chatStream() {
            calls++;
            yield { type: "finish", finishReason: reason };
          },
        },
      }),
    );
    assert.equal(calls, 1);
  }
});
test("cancellation at checkpoint prevents another request", async () => {
  const c = new AbortController();
  let calls = 0;
  await collect(
    run({
      messages: [],
      options: { signal: c.signal },
      checkpoint: async () => c.abort(),
      history: async () => [{}],
      phase: () => {},
      model: {
        async *chatStream() {
          calls++;
          yield { type: "finish", finishReason: "tool-calls" };
        },
      },
    }),
  );
  assert.equal(calls, 1);
});
test("concurrent duplicate writes share one execution", async () => {
  let writes = 0;
  await collect(
    run({
      messages: [],
      options: {
        tools: { edit: { execute: async () => ({ written: ++writes }) } },
      },
      model: {
        async *chatStream(_, o) {
          const [a, b] = await Promise.all([
            o.tools.edit.execute({ revision: "r" }),
            o.tools.edit.execute({ revision: "r" }),
          ]);
          assert.deepEqual(a, b);
          yield { type: "finish", finishReason: "stop" };
        },
      },
    }),
  );
  assert.equal(writes, 1);
});
test("repeated failing unversioned tools stop without indefinite retries", async () => {
  let calls = 0;
  await assert.rejects(
    collect(
      run({
        messages: [],
        options: {
          tools: {
            read: {
              execute: async () => {
                calls++;
                throw Error("unavailable");
              },
            },
          },
        },
        checkpoint: async () => {},
        history: async () => [{}],
        phase: () => {},
        model: {
          async *chatStream(_, o) {
            try {
              await o.tools.read.execute({});
            } catch {}
            yield { type: "finish", finishReason: "tool-calls" };
          },
        },
      }),
    ),
    /连续失败/,
  );
  assert.equal(calls, 3);
});
