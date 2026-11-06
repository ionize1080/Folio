// A continuation retains the same cancellation signal and completed tool transcript.
// Never retry an interrupted transport: the outcome of a write may be unknown.
window.folioContinueStream = async function* ({
  model,
  messages,
  options,
  checkpoint,
  history,
  phase,
}) {
  const initialCount = messages.length;
  const started = Date.now(),
    results = new Map(),
    replays = new Map(),
    recent = [];
  let batch = 0,
    blocked = null,
    executions = 0,
    cacheBytes = 0;
  const stable = (v) =>
    JSON.stringify(v, (_, x) =>
      x && typeof x === "object" && !Array.isArray(x)
        ? Object.fromEntries(
            Object.keys(x)
              .sort()
              .map((k) => [k, x[k]]),
          )
        : x,
    );
  const guarded = {
    ...options,
    tools: Object.fromEntries(
      Object.entries(options.tools || {}).map(([name, tool]) => [
        name,
        {
          ...tool,
          execute:
            tool.execute &&
            (async (args, ctx) => {
              if (options.signal?.aborted) throw Error("任务已取消");
              if (blocked) throw Error(blocked);
              if (
                ++executions > 2048 ||
                Date.now() - started > 2 * 60 * 60 * 1000
              ) {
                blocked = "任务达到运行预算，已保留完成记录；请检查剩余工作。";
                throw Error(blocked);
              }
              const key = stable([name, args]);
              // Revision-scoped writes can be replayed safely using their original result.
              // Reads remain live; a newly requested revision is a distinct operation.
              const revision = args?.revision ?? args?.options?.revision;
              if (revision && results.has(key)) {
                const count = (replays.get(key) || 0) + 1;
                replays.set(key, count);
                if (count >= 3) {
                  blocked =
                    "检测到已完成修改被反复请求，已停止以避免重复操作。";
                  throw Error(blocked);
                }
                return results.get(key);
              }
              const pending = Promise.resolve().then(() =>
                tool.execute(args, ctx),
              );
              if (revision) results.set(key, pending);
              let result;
              try {
                result = await pending;
              } catch (error) {
                recent.push(stable([name, args, String(error)]));
                if (recent.length > 12) recent.shift();
                if (recent.filter((x) => x === recent.at(-1)).length >= 3)
                  blocked = "相同工具连续失败，已停止自动续跑并保留完成记录。";
                throw error;
              }
              const signature = stable([name, args, result]);
              recent.push(signature);
              if (recent.length > 12) recent.shift();
              if (recent.filter((x) => x === signature).length >= 3)
                blocked =
                  "检测到相同操作与结果反复出现，已停止自动续跑并保留完成记录。";
              if (revision) {
                cacheBytes += stable(result)?.length || 0;
                if (cacheBytes > 32 * 1024 * 1024)
                  blocked = "工具结果达到续跑缓存预算，已停止并保留完成记录。";
                results.set(key, result);
              }
              return result;
            }),
        },
      ]),
    ),
  };
  while (true) {
    if (options.signal?.aborted) return;
    let reason, finish;
    for await (const chunk of model.chatStream(messages, guarded)) {
      if (chunk.type === "finish") {
        reason = chunk.finishReason;
        finish = chunk;
      } else yield chunk;
      if (blocked) throw Error(blocked);
    }
    if (options.signal?.aborted) return;
    if (blocked) throw Error(blocked);
    if (reason !== "tool-calls") {
      if (finish) yield finish;
      return;
    }
    await checkpoint();
    if (++batch >= 64)
      throw Error("任务达到自动续跑预算，已保存完成记录和剩余上下文。");
    phase("已完成 " + batch + " 轮，正在核对记录并自动继续");
    const transcript = await history();
    if (!transcript.length)
      throw Error("无法恢复工具记录，已停止以避免重复操作。");
    messages = [
      ...messages.slice(0, initialCount),
      ...transcript,
      {
        role: "user",
        content:
          "自动续跑：以上工具结果为已完成记录。核对当前文档状态，仅处理原请求的剩余工作；不要重复已完成修改。完成后核验并汇报；遇到阻碍请说明并停止。",
      },
    ];
  }
};
