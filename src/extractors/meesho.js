// Receipts — Meesho (meesho.com) extractor.
//
// Pulls order id, date, INR total, and line items from Meesho's account
// order pages:
//   https://www.meesho.com/orders
//   https://www.meesho.com/orders/<orderId>
//   https://www.meesho.com/orders/details/<orderId>
//
// Meesho's DOM uses hashed class names, so we key off stable data-*
// attributes (when present) and visible text patterns ("Order ID",
// the rupee glyph, "Total" / "Order Total" / "Final Amount"). Selectors
// are tried in order; first parseable hit wins.
//
// Tests live in tests/extractors/meesho.test.mjs.

const MERCHANT_ID = "meesho";
const CURRENCY = "INR";

/** True iff this URL is a Meesho order page. */
export function matchesMeesho(url) {
  if (!url || typeof url !== "string") return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.hostname !== "www.meesho.com" && u.hostname !== "meesho.com") return false;
  const p = u.pathname || "";
  return p.startsWith("/orders") || p.startsWith("/myorders");
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

/** Parse Meesho date strings: "Delivered on 23 May 2026", "23 May'26", ISO. */
export function parseMeeshoDate(str) {
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
 * Extract Meesho's order id. Meesho exposes ids like "1234567890_1" in
 * URLs (/orders/<id>) and as "Order ID: <id>" or "Sub Order No: <id>"
 * in the DOM.
 */
export function extractOrderId(doc, url) {
  if (url && typeof url === "string") {
    try {
      const u = new URL(url);
      const fromQs =
        u.searchParams.get("order_id") ||
        u.searchParams.get("orderId") ||
        u.searchParams.get("sub_order_id");
      if (fromQs) return fromQs.trim();
      const parts = (u.pathname || "").split("/").filter(Boolean);
      const idx = parts.findIndex((p) => p === "orders" || p === "myorders");
      if (idx >= 0 && parts.length > idx + 1) {
        let cand = parts[idx + 1];
        if (cand === "details" && parts.length > idx + 2) cand = parts[idx + 2];
        if (/^[\w-]{6,}$/.test(cand)) return cand;
      }
    } catch { /* ignore */ }
  }
  const txt = firstText(doc, [
    "[data-test-id='order-id']",
    "[data-testid='order-id']",
    "[data-test-id='sub-order-id']",
    "[data-testid='sub-order-id']",
    ".order-id",
    ".OrderId",
    ".sub-order-id",
  ]);
  // Meesho ids: alphanumeric with optional _suffix.
  let m = txt && txt.match(/[A-Za-z0-9]{6,}(?:_\d{1,8})?/);
  if (m) return m[0];
  const all = nodeText(doc.querySelector?.("body") || doc);
  m = all && all.match(/(?:Sub\s*Order\s*No|Order\s*ID)[:\s]*([A-Za-z0-9]{6,}(?:_\d{1,8})?)/i);
  if (m) return m[1];
  return null;
}

/** Pull line items from Meesho order rows. */
export function extractItems(doc) {
  const rows = doc.querySelectorAll?.(
    [
      "[data-test-id='order-item']",
      "[data-testid='order-item']",
      ".order-item",
      ".OrderItem",
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
      row.querySelector?.("a");
    const priceEl =
      row.querySelector?.("[data-test-id='item-price']") ||
      row.querySelector?.("[data-testid='item-price']") ||
      row.querySelector?.(".item-price") ||
      row.querySelector?.(".ItemPrice");
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
      if (/grand total|total amount|order total|amount payable|total paid|final amount/.test(text)) {
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
    const iso = parseMeeshoDate(nodeText(doc.querySelector?.(sel)));
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
    raw: { url, source: "meesho" },
  };
  const id = extractOrderId(doc, url);
  if (id) partial.id = `${MERCHANT_ID}:${id}`;
  return partial;
}

const meeshoExtractor = {
  id: MERCHANT_ID,
  version: "0.1.0",
  matches: (url) => matchesMeesho(url),
  extract,
};

export default meeshoExtractor;
