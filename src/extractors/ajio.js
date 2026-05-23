// Receipts — Ajio (ajio.com) extractor.
//
// Pulls order id, date, INR total, and line items from Ajio's
// account order pages:
//   https://www.ajio.com/my-account/orders
//   https://www.ajio.com/my-account/orders/<orderId>
//   https://www.ajio.com/my-account/orders/details?orderId=<id>
//
// Ajio uses Reliance's order codes (alphanumeric, 8–20 chars, often
// prefixed with "FN" or "BO") and rupee totals. We key off stable
// data-* attributes (when present) and visible label text
// ("Order ID", "Order Total", the rupee glyph). Selectors are tried
// in order; first parseable hit wins.
//
// Tests live in tests/extractors/ajio.test.mjs.

const MERCHANT_ID = "ajio";
const CURRENCY = "INR";

/** True iff this URL is an Ajio order page. */
export function matchesAjio(url) {
  if (!url || typeof url !== "string") return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.hostname !== "www.ajio.com" && u.hostname !== "ajio.com") return false;
  const p = u.pathname || "";
  return p.startsWith("/my-account/orders");
}

/** Read trimmed, whitespace-collapsed text from a node. */
function nodeText(el) {
  if (!el) return "";
  const t = el.textContent || "";
  return String(t).replace(/\s+/g, " ").trim();
}

/** Parse "₹1,234.50" / "Rs. 1,234" / "INR 99" into a Number. */
export function parseInr(str) {
  if (str == null) return null;
  const s = String(str)
    .replace(/[₹]/g, "")
    .replace(/\bINR\b/gi, "")
    .replace(/\bRs\.?/gi, "")
    .replace(/[,\s]/g, "");
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** Parse Ajio date strings: "Ordered on 23 May 2026", "23-05-2026", ISO. */
export function parseAjioDate(str) {
  if (!str) return null;
  const WEEKDAYS = /^(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,?\s*/i;
  const cleaned = String(str)
    .replace(/^.*?(?:delivered on|ordered on|order placed|placed on|on)\s*/i, "")
    .replace(WEEKDAYS, "")
    .replace(/(\d+)(st|nd|rd|th)/gi, "$1")
    .replace(/[,]/g, " ")
    .trim();

  // "23 May 2026" / "23 May '26"
  let m = cleaned.match(/(\d{1,2})\s+([A-Za-z]+)'?\s*(\d{2,4})/);
  if (m) {
    const [, dd, monStr, yRaw] = m;
    const yyyy = yRaw.length === 2 ? 2000 + Number(yRaw) : Number(yRaw);
    const mon = monthIndex(monStr);
    if (mon == null) return null;
    const d = new Date(Date.UTC(yyyy, mon, Number(dd)));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  // ISO "2026-05-23"
  m = cleaned.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  // "23-05-2026" / "23/05/2026"
  m = cleaned.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]) - 1;
    const yyyy = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const d = new Date(Date.UTC(yyyy, mm, dd));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

function monthIndex(monStr) {
  const MONTHS = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
  };
  return MONTHS[String(monStr).slice(0, 3).toLowerCase()] ?? null;
}

function firstMatch(doc, selectors) {
  for (const sel of selectors) {
    const el = doc.querySelector?.(sel);
    if (el) return el;
  }
  return null;
}

function firstText(doc, selectors) {
  return nodeText(firstMatch(doc, selectors));
}

/**
 * Extract Ajio's order id. Ajio exposes ids like "FN1234567890" or
 * "BO1234567890" via URL (orderId query, or /orders/<id>) and as
 * "Order ID: <id>" text. We accept 8–22 alphanumeric chars.
 */
export function extractOrderId(doc, url) {
  if (url && typeof url === "string") {
    try {
      const u = new URL(url);
      const fromQs =
        u.searchParams.get("orderId") ||
        u.searchParams.get("order_id") ||
        u.searchParams.get("orderID");
      if (fromQs) return fromQs.trim();
      const parts = (u.pathname || "").split("/").filter(Boolean);
      const idx = parts.indexOf("orders");
      if (idx >= 0 && parts.length > idx + 1) {
        let cand = parts[idx + 1];
        if (cand === "details" && parts.length > idx + 2) cand = parts[idx + 2];
        if (/^[A-Z0-9]{8,22}$/i.test(cand)) return cand;
      }
    } catch { /* ignore */ }
  }
  const txt = firstText(doc, [
    "[data-test-id='order-id']",
    "[data-testid='order-id']",
    ".order-id",
    ".OrderId",
    ".order-number",
  ]);
  let m = txt && txt.match(/[A-Z0-9]{8,22}/i);
  if (m) return m[0];
  const all = nodeText(doc.querySelector?.("body") || doc);
  m = all && all.match(/Order\s*(?:ID|No\.?|Number)[:\s]*([A-Z0-9]{8,22})/i);
  if (m) return m[1];
  return null;
}

/** Pull line items from Ajio order rows. */
export function extractItems(doc) {
  const rows = doc.querySelectorAll?.(
    [
      "[data-test-id='order-item']",
      "[data-testid='order-item']",
      ".order-item",
      ".OrderItem",
      ".item-row",
      ".order-product",
    ].join(", "),
  );
  if (!rows || rows.length === 0) return [];
  const items = [];
  for (const row of rows) {
    const nameEl =
      row.querySelector?.("[data-test-id='item-title']") ||
      row.querySelector?.("[data-testid='item-title']") ||
      row.querySelector?.(".item-title") ||
      row.querySelector?.(".ItemName") ||
      row.querySelector?.(".product-brand") ||
      row.querySelector?.(".product-name") ||
      row.querySelector?.("a");
    const priceEl =
      row.querySelector?.("[data-test-id='item-price']") ||
      row.querySelector?.("[data-testid='item-price']") ||
      row.querySelector?.(".item-price") ||
      row.querySelector?.(".ItemPrice") ||
      row.querySelector?.(".product-price");
    const qtyEl =
      row.querySelector?.("[data-test-id='item-qty']") ||
      row.querySelector?.("[data-testid='item-qty']") ||
      row.querySelector?.(".item-qty") ||
      row.querySelector?.(".item-quantity");

    const name = nodeText(nameEl);
    if (!name) continue;
    const lineTotal = parseInr(nodeText(priceEl));
    const qtyTxt = nodeText(qtyEl);
    const qtyMatch = qtyTxt && qtyTxt.match(/\d+/);
    const item = { name };
    if (qtyMatch) item.qty = Number(qtyMatch[0]);
    if (lineTotal != null) item.lineTotal = lineTotal;
    items.push(item);
  }
  return items;
}

/** Extract the grand total. */
export function extractTotal(doc) {
  const direct = firstText(doc, [
    "[data-test-id='order-total']",
    "[data-testid='order-total']",
    ".order-total",
    ".OrderTotal",
    ".grand-total",
    ".final-amount",
    ".total-amount",
  ]);
  const fromDirect = parseInr(direct);
  if (fromDirect != null) return fromDirect;

  // Fallback: summary rows labelled "Order Total" / "Total Amount" / "Grand Total".
  const rows = doc.querySelectorAll?.(
    "[data-test-id='summary-row'], [data-testid='summary-row'], .summary-row, .price-row, tr, li, div",
  );
  if (rows) {
    for (const row of rows) {
      const text = nodeText(row).toLowerCase();
      if (!text) continue;
      if (/grand total|total amount|order total|amount payable|total paid|net payable/.test(text)) {
        const n = parseInr(nodeText(row));
        if (n != null) return n;
      }
    }
  }
  return null;
}

/** Extract the order date. */
export function extractDate(doc) {
  const candidates = [
    "[data-test-id='order-date']",
    "[data-testid='order-date']",
    ".order-date",
    ".OrderDate",
    ".placed-on",
    ".delivered-on",
  ];
  for (const sel of candidates) {
    const iso = parseAjioDate(nodeText(doc.querySelector?.(sel)));
    if (iso) return iso;
  }
  return null;
}

/** Main extractor entry: returns a partial Receipt or null. */
export function extract(doc, ctx = {}) {
  if (!doc) return null;
  const url = ctx.url || (doc.location && doc.location.href) || "";
  const total = extractTotal(doc);
  if (total == null) return null;
  const partial = {
    merchantId: MERCHANT_ID,
    currency: CURRENCY,
    total,
    date: extractDate(doc),
    items: extractItems(doc),
    raw: { url, source: "ajio" },
  };
  const id = extractOrderId(doc, url);
  if (id) partial.id = `${MERCHANT_ID}:${id}`;
  return partial;
}

const ajioExtractor = {
  id: MERCHANT_ID,
  version: "0.1.0",
  matches: (url) => matchesAjio(url),
  extract,
};

export default ajioExtractor;
