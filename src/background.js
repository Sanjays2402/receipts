// Receipts — service worker
import { chromeStorageAdapter, maybeRefreshRates, getRates } from "./fx-cache.js";

console.log("[receipts] service worker booted");

const fxStorage = (typeof chrome !== "undefined" && chrome?.storage?.local)
  ? chromeStorageAdapter(chrome.storage.local)
  : null;

async function refreshFxQuietly(force = false) {
  try {
    const r = await maybeRefreshRates({ storage: fxStorage, fetcher: fetch, force });
    console.debug("[receipts] fx refresh:", r.reason, "asOf:", r.payload?.asOf);
    return r;
  } catch (e) {
    console.warn("[receipts] fx refresh error:", e?.message || e);
    return { refreshed: false, reason: "error" };
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("[receipts] installed");
  refreshFxQuietly(true);
});

chrome.runtime.onStartup?.addListener(() => {
  refreshFxQuietly(false);
});

// Best-effort refresh on every service-worker wakeup. maybeRefreshRates() short-circuits
// when the 24h cache is still fresh, so this stays cheap.
refreshFxQuietly(false);

// Content scripts post captured receipts here. Storage lands in a later roadmap item.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "receipts/capture") {
    console.debug("[receipts] capture from", sender?.tab?.url, msg.receipt);
    sendResponse?.({ ok: true });
    return;
  }
  if (msg.type === "receipts/ping") {
    sendResponse?.({ ok: true, ts: Date.now() });
    return;
  }
  if (msg.type === "receipts/fx-get") {
    getRates({ storage: fxStorage }).then((r) => sendResponse?.({ ok: true, ...r }));
    return true; // async response
  }
  if (msg.type === "receipts/fx-refresh") {
    refreshFxQuietly(!!msg.force).then((r) => sendResponse?.({ ok: true, ...r }));
    return true; // async response
  }
});
