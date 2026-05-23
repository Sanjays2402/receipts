// Receipts — shared content-script utilities.
// Loaded before every merchant-specific extractor. Exposes a small,
// idempotent surface on window.__receipts so multiple injections don't collide.
(() => {
  if (window.__receipts) return;

  const MERCHANTS = {
    "www.amazon.com": "amazon-us",
    "www.amazon.in": "amazon-in",
    "www.doordash.com": "doordash",
    "www.ubereats.com": "ubereats",
    "www.flipkart.com": "flipkart"
  };

  const log = (...args) => console.debug("[receipts]", ...args);

  const merchant = MERCHANTS[location.hostname] || null;

  /** Wait for an element matching `selector`, up to `timeoutMs`. */
  function waitFor(selector, { timeoutMs = 8000, root = document } = {}) {
    return new Promise((resolve) => {
      const existing = root.querySelector(selector);
      if (existing) return resolve(existing);
      const obs = new MutationObserver(() => {
        const el = root.querySelector(selector);
        if (el) { obs.disconnect(); resolve(el); }
      });
      obs.observe(root, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); resolve(null); }, timeoutMs);
    });
  }

  /** Parse the first currency-looking number from a string. */
  function parseAmount(str) {
    if (!str) return null;
    const m = String(str).replace(/[,\s]/g, "").match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
  }

  function text(el) {
    return el ? (el.textContent || "").trim().replace(/\s+/g, " ") : "";
  }

  /** Send a captured receipt to the service worker. No-ops if runtime gone. */
  function sendReceipt(receipt) {
    try {
      chrome.runtime?.sendMessage?.({ type: "receipts/capture", receipt });
    } catch (e) {
      log("sendReceipt failed", e);
    }
  }

  window.__receipts = {
    merchant,
    log,
    waitFor,
    parseAmount,
    text,
    sendReceipt,
    version: "0.1.0"
  };

  log("common loaded for", merchant || location.hostname);
})();
