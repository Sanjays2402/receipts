// Receipts — Instacart (instacart.com) extractor.
//
// Pulls order id, date, USD total, and line items off canonical
// order-receipt pages:
//   https://www.instacart.com/store/orders/<orderId>
//   https://www.instacart.com/store/orders/<orderId>/receipt
//   https://www.instacart.com/orders/<orderId>
//   https://www.instacart.com/receipt/<orderId>
//
// Selector-tolerant: tries a small list of candidate selectors for each
// field and stops at the first that returns a parseable value.

const MERCHANT_ID = "instacart";
const CURRENCY = "USD";

/** True iff this URL is an Instacart orders/receipt page. */
export function matchesInstacart(url) {
  if (!url || typeof url !== "string") return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.hostname !== "www.instacart.com" && u.hostname !== "instacart.com") return false;
  const p = u.pathname || "";
  return p.startsWith("/store/orders")
    || p.startsWith("/orders")
    || p.startsWith("/receipt")
    || p.startsWith("/store/receipt");
}

function nodeText(el) {
  if (!el) return "";
  const t = el.textContent || "";
  return String(t).replace(/\s+/g, " ").trim();
}

/** Parse "$1,234.50" / "USD 99" / "US$ 12.00" into a Number. */
export function parseUsd(str) {
  if (str == null) return null;
  const s = String(str)
    .replace(/US\$/gi, "")
    .replace(/\$/g, "")
    .replace(/\bUSD\b/gi, "")
    .replace(/[,\s]/g, "");
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** Parse Instacart date strings like "May 23, 2026" or "Delivered May 23, 2026". */
export function parseInstacartDate(str) {
  if (!str) return null;
  const cleaned = String(str)
    .replace(/^.*?(?:placed on|placed|ordered on|ordered|order placed|order date:?|delivered on|delivered|delivery date:?)\s*/i, "")
    .trim();
  let m = cleaned.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const [, monStr, dd, yyyy] = m;
    return monthDayYearToIso(monStr, dd, yyyy);
  }
  m = cleaned.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (m) {
    const [, dd, monStr, yyyy] = m;
    return monthDayYearToIso(monStr, dd, yyyy);
  }
  return null;
}

function monthDayYearToIso(monStr, dd, yyyy) {
  const MONTHS = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
  };
  const mon = MONTHS[String(monStr).slice(0, 3).toLowerCase()];
  if (mon == null) return null;
  const d = new Date(Date.UTC(Number(yyyy), mon, Number(dd)));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
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
 * Extract the order id. Instacart uses long alphanumeric ids in the path,
 * typically after /orders/ or /store/orders/.
 */
export function extractOrderId(doc, url) {
  if (url && typeof url === "string") {
    try {
      const u = new URL(url);
      const m = u.pathname.match(/\/store\/orders\/([A-Z0-9-]{4,})/i)
        || u.pathname.match(/\/orders?\/([A-Z0-9-]{4,})/i)
        || u.pathname.match(/\/receipt\/([A-Z0-9-]{4,})/i);
      if (m) return m[1];
    } catch { /* ignore */ }
  }
  const txt = firstText(doc, [
    "[data-test='order-number']",
    "[data-testid='order-number']",
    "[data-radium-id='OrderNumber']",
    "[data-automation-id='order-number']",
    ".order-number",
  ]);
  const m = txt && txt.match(/[A-Z0-9-]{6,}/i);
  return m ? m[0] : null;
}

/** Pull line items from common order-receipt containers. */
export function extractItems(doc) {
  const rows = doc.querySelectorAll?.(
    [
      "[data-test='order-item']",
      "[data-testid='order-item']",
      "[data-radium-id='OrderItem']",
      "[data-automation-id='order-item']",
      ".order-item",
      "li.receipt-item",
      "li.order-line-item",
    ].join(", "),
  );
  if (!rows || rows.length === 0) return [];
  const items = [];
  for (const row of rows) {
    const nameEl =
      row.querySelector?.("[data-test='item-name']") ||
      row.querySelector?.("[data-testid='item-name']") ||
      row.querySelector?.("[data-radium-id='OrderItemName']") ||
      row.querySelector?.("[data-automation-id='item-name']") ||
      row.querySelector?.(".item-name") ||
      row.querySelector?.(".product-name") ||
      row.querySelector?.("a.product-title");
    const priceEl =
      row.querySelector?.("[data-test='line-price']") ||
      row.querySelector?.("[data-testid='line-price']") ||
      row.querySelector?.("[data-radium-id='OrderItemPrice']") ||
      row.querySelector?.("[data-automation-id='line-price']") ||
      row.querySelector?.(".line-price") ||
      row.querySelector?.(".item-price") ||
      row.querySelector?.(".product-price");
    const qtyEl =
      row.querySelector?.("[data-test='item-qty']") ||
      row.querySelector?.("[data-testid='item-qty']") ||
      row.querySelector?.("[data-radium-id='OrderItemQty']") ||
      row.querySelector?.("[data-automation-id='item-qty']") ||
      row.querySelector?.(".item-qty") ||
      row.querySelector?.(".quantity");

    const name = nodeText(nameEl);
    if (!name) continue;
    const lineTotal = parseUsd(nodeText(priceEl));
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
    "[data-test='order-total']",
    "[data-testid='order-total']",
    "[data-radium-id='OrderTotal']",
    "[data-automation-id='order-total']",
    ".order-total",
    ".grand-total",
    ".receipt-total",
  ]);
  const fromDirect = parseUsd(direct);
  if (fromDirect != null) return fromDirect;

  // Fallback: scan summary rows for one whose label looks like a grand total.
  const rows = doc.querySelectorAll?.(
    "[data-test='order-summary'] div, [data-testid='order-summary'] div, [data-radium-id='OrderSummary'] div, .order-summary div, .order-summary tr, .receipt-summary div, tr",
  );
  if (rows) {
    for (const row of rows) {
      const text = nodeText(row).toLowerCase();
      if (!text) continue;
      if (/total[^a-z]|order total|grand total/.test(text) &&
          !/subtotal|item total|items? total/.test(text)) {
        const n = parseUsd(nodeText(row));
        if (n != null) return n;
      }
    }
  }
  return null;
}

/** Extract the order date. */
export function extractDate(doc) {
  const candidates = [
    "[data-test='order-date']",
    "[data-testid='order-date']",
    "[data-radium-id='OrderDate']",
    "[data-automation-id='order-date']",
    "[data-test='delivery-date']",
    "[data-testid='delivery-date']",
    ".order-date",
    ".delivery-date",
    "time",
  ];
  for (const sel of candidates) {
    const iso = parseInstacartDate(nodeText(doc.querySelector?.(sel)));
    if (iso) return iso;
  }
  return null;
}

/** Main extractor entry. */
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
    raw: { url, source: "instacart" },
  };
  const id = extractOrderId(doc, url);
  if (id) partial.id = `${MERCHANT_ID}:${id}`;
  return partial;
}

const instacartExtractor = {
  id: MERCHANT_ID,
  version: "0.1.0",
  matches: (url) => matchesInstacart(url),
  extract,
};

export default instacartExtractor;
