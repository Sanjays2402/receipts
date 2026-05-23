// Receipts — service worker
console.log("[receipts] service worker booted");

chrome.runtime.onInstalled.addListener(() => {
  console.log("[receipts] installed");
});

// Content scripts post captured receipts here. Storage lands in a later roadmap item.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "receipts/capture") {
    console.debug("[receipts] capture from", sender?.tab?.url, msg.receipt);
    sendResponse?.({ ok: true });
  }
  if (msg.type === "receipts/ping") {
    sendResponse?.({ ok: true, ts: Date.now() });
  }
});
