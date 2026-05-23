// Receipts — Uber Eats extractor scaffold.
(() => {
  const r = window.__receipts;
  if (!r) return;
  r.log("ubereats extractor armed");
  window.__receipts.ubereats = { ready: true };
})();
