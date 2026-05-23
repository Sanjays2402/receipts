// Receipts — DoorDash extractor scaffold.
(() => {
  const r = window.__receipts;
  if (!r) return;
  r.log("doordash extractor armed");
  window.__receipts.doordash = { ready: true };
})();
