// Receipts — Flipkart extractor scaffold.
(() => {
  const r = window.__receipts;
  if (!r) return;
  r.log("flipkart extractor armed");
  window.__receipts.flipkart = { ready: true };
})();
