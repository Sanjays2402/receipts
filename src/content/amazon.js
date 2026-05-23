// Receipts — Amazon (US + IN) extractor scaffold.
// Actual order-page detection + line-item extraction land in later roadmap items.
(() => {
  const r = window.__receipts;
  if (!r) return;
  r.log("amazon extractor armed", r.merchant);
  // Placeholder hook: real detection comes in the next roadmap step.
  window.__receipts.amazon = { ready: true };
})();
