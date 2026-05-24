// Receipts — Zepto (zeptonow.com) extractor.
//
// Pulls order id, date, INR total, and line items from Zepto's
// account/order pages:
//   https://www.zeptonow.com/profile/orders
//   https://www.zeptonow.com/profile/orders/<orderId>
//   https://www.zeptonow.com/order/<orderId>
//   https://www.zeptonow.com/orders/<orderId>
//
// Zepto ships hashed CSS-module class names and a Next.js shell, so we
// prefer stable data-* attributes when present and fall back to
// visible-text patterns ("Order ID", "Bill Total", "Grand Total",
// "You Paid", the rupee glyph).
//
// Tests live in tests/extractors/zepto.test.mjs.

const MERCHANT_ID = "zepto";
const CURRENCY = "INR";

/** True iff this URL is a Zepto order page. */
export function matchesZepto(url) {
  if (!url || typeof url !== "string") return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  const host = u.hostname;
  if (host !== "zeptonow.com" && host !== "www.zeptonow.com") return false;
  const p = u.pathname || "";
  return (
    p.startsWith("/profile/orders") ||
    p.startsWith("/profile/order") ||
    p.startsWith("/order/") ||
    p.startsWith("/orders/")
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

/** Parse Zepto date strings: "23 May 2026, 04:12 PM", "23-May-2026", ISO. */
export function parseZeptoDate(str) {
  if (!str) return null;
  const WEEKDAYS = /^(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,?\s*/i;
  const cleaned = String(str)
    .replace(/^.*?(?:delivered on|delivered at|ordered on|order placed|placed on|on)\s*/i, "")
    .replace(WEEKDAYS, "")
    .replace(/(\d+)(st|nd|rd|th)/gi, "$1")
    .replace(/[,]/g, " ")
    .trim();

  // "23 May 2026" / "23 May '26" / "23-May-2026"
  let m = cleaned.match(/(\d{1,2})[\s\-]+([A-Za-z]+)'?[\s\-]*(\d{2,4})/);
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
  // "23/05/2026" or "23-05-2026"
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
 * Extract Zepto's order id. Zepto exposes ids like
 * "ZP-12345678", UUIDs, or 10–24 char alphanumerics, via URL
 * (/profile/orders/<id>, /order/<id>) and as "Order ID: <id>" in DOM.
 */
export function extractOrderId(doc, url) {
  if (url && typeof url === "string") {
    try {
      const u = new URL(url);
      const fromQs =
        u.searchParams.get("order_id") ||
        u.searchParams.get("orderId") ||
        u.searchParams.get("orderID");
      if (fromQs) return fromQs.trim();
      const parts = (u.pathname || "").split("/").filter(Boolean);
      let idx = parts.indexOf("orders");
      if (idx < 0) idx = parts.indexOf("order");
      if (idx >= 0 && parts.length > idx + 1) {
        const cand = parts[idx + 1];
        if (/^[A-Z0-9\-]{6,36}$/i.test(cand)) return cand;
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
  let m = txt && txt.match(/[A-Z0-9\-]{6,36}/i);
  if (m) return m[0];
  const all = nodeText(doc.querySelector?.("body") || doc);
  m = all && all.match(/Order\s*(?:ID|No\.?|Number)[:\s]*([A-Z0-9\-]{6,36})/i);
  if (m) return m[1];
  return null;
}

/** Pull line items from Zepto order rows. */
export function extractItems(doc) {
  const rows = doc.querySelectorAll?.(
    [
      "[data-test-id='order-item']",
      "[data-testid='order-item']",
      ".order-item",
      ".OrderItem",
      ".item-row",
      ".product-row",
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
      row.querySelector?.(".product-name") ||
      row.querySelector?.(".product-brand") ||
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
    ".bill-total",
    ".final-amount",
    ".total-amount",
    ".amount-paid",
  ]);
  const fromDirect = parseInr(direct);
  if (fromDirect != null) return fromDirect;

  // Fallback: summary rows labelled "Bill Total" / "Grand Total" / "You Paid".
  const rows = doc.querySelectorAll?.(
    "[data-test-id='summary-row'], [data-testid='summary-row'], .summary-row, .price-row, .bill-row, tr, li, div",
  );
  if (rows) {
    for (const row of rows) {
      const text = nodeText(row).toLowerCase();
      if (!text) continue;
      if (/grand total|order total|bill total|amount paid|amount payable|total payable|net payable|you paid|total amount/.test(text)) {
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
    const iso = parseZeptoDate(nodeText(doc.querySelector?.(sel)));
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
    raw: { url, source: "zepto" },
  };
  const id = extractOrderId(doc, url);
  if (id) partial.id = `${MERCHANT_ID}:${id}`;
  return partial;
}

const zeptoExtractor = {
  id: MERCHANT_ID,
  version: "0.1.0",
  matches: (url) => matchesZepto(url),
  extract,
};

export default zeptoExtractor;
