// Receipts — Flipkart (flipkart.com) extractor.
//
// Pulls order id, date, INR total, and line items off the canonical
// account order pages:
//   https://www.flipkart.com/account/orders
//   https://www.flipkart.com/account/order-details?order_id=...
//
// Flipkart's DOM uses opaque hashed class names, so we mostly key off
// stable data-* attributes and visible text patterns (Order ID #..., the
// rupee glyph, etc). Selectors are tried in order; the first parseable
// hit wins.
//
// Surface:
//   import flipkartExtractor from "./extractors/flipkart.js";
//   runExtractor(flipkartExtractor, document, { url })
//
// Tests live in tests/extractors/flipkart.test.mjs.

const MERCHANT_ID = "flipkart";
const CURRENCY = "INR";

/** True iff this URL is a Flipkart order page. */
export function matchesFlipkart(url) {
  if (!url || typeof url !== "string") return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.hostname !== "www.flipkart.com" && u.hostname !== "flipkart.com") return false;
  const p = u.pathname || "";
  return (
    p.startsWith("/account/order-details") ||
    p.startsWith("/account/orders")
  );
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

/** Parse Flipkart's date strings like "On Sat, 23rd May'26" or "23 May 2026". */
export function parseFlipkartDate(str) {
  if (!str) return null;
  const WEEKDAYS = /^(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,?\s*/i;
  const cleaned = String(str)
    .replace(/^.*?(?:ordered on|order placed|placed on|on)\s*/i, "")
    .replace(WEEKDAYS, "")
    .replace(/(\d+)(st|nd|rd|th)/gi, "$1")
    .replace(/[,]/g, " ")
    .trim();

  // Try "23 May 2026" or "23 May '26".
  let m = cleaned.match(/(\d{1,2})\s+([A-Za-z]+)'?\s*(\d{2,4})/);
  if (m) {
    const [, dd, monStr, yRaw] = m;
    const yyyy = yRaw.length === 2 ? 2000 + Number(yRaw) : Number(yRaw);
    const mon = monthIndex(monStr);
    if (mon == null) return null;
    const d = new Date(Date.UTC(yyyy, mon, Number(dd)));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  // Try ISO "2026-05-23".
  m = cleaned.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
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

/** Extract Flipkart's order id (e.g. OD123456789012345678). */
export function extractOrderId(doc, url) {
  if (url && typeof url === "string") {
    try {
      const u = new URL(url);
      const fromQs =
        u.searchParams.get("order_id") ||
        u.searchParams.get("orderId") ||
        u.searchParams.get("orderID");
      if (fromQs) return fromQs.trim();
    } catch { /* ignore */ }
  }
  const txt = firstText(doc, [
    "[data-test-id='order-id']",
    ".order-id",
    ".OrderId",
  ]);
  let m = txt && txt.match(/OD\d{15,22}/);
  if (m) return m[0];
  // Fallback: scan whole document text for the OD pattern.
  const all = nodeText(doc.querySelector?.("body") || doc);
  m = all && all.match(/OD\d{15,22}/);
  return m ? m[0] : null;
}

/** Pull line items from Flipkart order rows. */
export function extractItems(doc) {
  const rows = doc.querySelectorAll?.(
    [
      "[data-test-id='order-item']",
      ".order-item",
      ".OrderItem",
    ].join(", "),
  );
  if (!rows || rows.length === 0) return [];
  const items = [];
  for (const row of rows) {
    const nameEl =
      row.querySelector?.("[data-test-id='item-title']") ||
      row.querySelector?.(".item-title") ||
      row.querySelector?.(".ItemName") ||
      row.querySelector?.("a");
    const priceEl =
      row.querySelector?.("[data-test-id='item-price']") ||
      row.querySelector?.(".item-price") ||
      row.querySelector?.(".ItemPrice");
    const qtyEl =
      row.querySelector?.("[data-test-id='item-qty']") ||
      row.querySelector?.(".item-qty");

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
    ".order-total",
    ".OrderTotal",
    ".grand-total",
  ]);
  const fromDirect = parseInr(direct);
  if (fromDirect != null) return fromDirect;

  // Fallback: scan rows for labels like "Total Amount" / "Grand Total".
  const rows = doc.querySelectorAll?.(
    "[data-test-id='summary-row'], .summary-row, .price-row, tr, li",
  );
  if (rows) {
    for (const row of rows) {
      const text = nodeText(row).toLowerCase();
      if (!text) continue;
      if (/grand total|total amount|order total|amount payable/.test(text)) {
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
    ".order-date",
    ".OrderDate",
  ];
  for (const sel of candidates) {
    const iso = parseFlipkartDate(nodeText(doc.querySelector?.(sel)));
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
    raw: { url, source: "flipkart" },
  };
  const id = extractOrderId(doc, url);
  if (id) partial.id = `${MERCHANT_ID}:${id}`;
  return partial;
}

const flipkartExtractor = {
  id: MERCHANT_ID,
  version: "0.1.0",
  matches: (url) => matchesFlipkart(url),
  extract,
};

export default flipkartExtractor;
