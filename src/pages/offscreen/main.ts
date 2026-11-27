chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (msg?.target !== "offscreen") return false;
  if (msg.cmd === "createObjectUrl") {
    const blob = new Blob([String(msg.content || "")], { type: String(msg.mime || "application/json") });
    const url = URL.createObjectURL(blob);
    reply({ url });
    return false;
  }
  if (msg.cmd === "revokeObjectUrl" && typeof msg.url === "string") {
    URL.revokeObjectURL(msg.url);
    reply({ ok: true });
    return false;
  }
  return false;
});
