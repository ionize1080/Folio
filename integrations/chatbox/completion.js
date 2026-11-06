// A closed transport or a tool-step cap is not a completed user task.
window.folioCompletionIssue = (reason, aborted) => {
  if (aborted) return null;
  if (reason === 'tool-calls') return '本轮达到工具调用步数上限，任务可能尚未完成。已应用的修改保留；发送“继续”，将核对当前文档后接着处理。';
  if (reason === 'length') return '模型输出达到长度上限，回复或任务可能未完成。已应用的修改保留；发送“继续”接着处理。';
  if (!reason || reason === 'unknown' || reason === 'error') return '模型连接结束，但没有收到正常完成标记。任务可能未完成，已应用的修改保留；请发送“继续”，先核对当前文档再处理剩余工作。';
  return null;
};
