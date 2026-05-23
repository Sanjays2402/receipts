// Receipts — DoorDash (doordash.com) extractor.
//
// Pulls order id, date, USD total, and line items off the canonical
// order-details page:
//   https://www.doordash.com/orders/<orderId>
//   https://www.doordash.com/orders/<orderId>/receipt
//   https://www.doordash.com/consumer/orders/<orderId>
//
// Selector-tolerant: tries a small list of candidate selectors for each
// field and stops at the first that returns a parseable value.

const MERCHANT_ID = "doordash";
const CURRENCY = "USD";

/** True iff this URL is a DoorDash orders/receipt page. */
export function matchesDoordash(url) {
  if (!url || typeof url !== "string") return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.hostname !== "www.doordash.com" && u.hostname !== "doordash.com") return false;
  const p = u.pathname || "";
  return p.startsWith("/orders")
    || p.startsWith("/consumer/orders")
    || p.startsWith("/order/")
    || p.startsWith("/receipt");
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

/** Parse DoorDash date strings like "May 23, 2026" or "Ordered May 23, 2026 at 7:12 PM". */
export function parseDoordashDate(str) {
  if (!str) return null;
  const cleaned = String(str)
    .replace(/^.*?(?:placed on|placed|ordered on|ordered|order placed|order date:?|delivered on|delivery date:?)\s*/i, "")
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
 * Extract the order id. DoorDash uses UUID-ish ids in the path, often after
 * /orders/ or /consumer/orders/.
 */
export function extractOrderId(doc, url) {
  if (url && typeof url === "string") {
    try {
      const u = new URL(url);
      const m = u.pathname.match(/\/orders?\/([A-Z0-9-]{6,})/i)
        || u.pathname.match(/\/consumer\/orders\/([A-Z0-9-]{6,})/i);
      if (m) return m[1];
    } catch { /* ignore */ }
  }
  const txt = firstText(doc, [
    "[data-test='order-number']",
    "[data-testid='order-number']",
    "[data-anchor-id='OrderNumber']",
    "[data-automation-id='order-number']",
    ".order-number",
  ]);
  const m = txt && txt.match(/[A-Z0-9-]{8,}/i);
  return m ? m[0] : null;
}

/** Pull line items from common order-details containers. */
export function extractItems(doc) {
  const rows = doc.querySelectorAll?.(
    [
      "[data-test='order-item']",
      "[data-testid='order-item']",
      "[data-anchor-id='OrderItem']",
      "[data-automation-id='order-item']",
      ".order-item",
      "li.order-cart-item",
    ].join(", "),
  );
  if (!rows || rows.length === 0) return [];
  const items = [];
  for (const row of rows) {
    const nameEl =
      row.querySelector?.("[data-test='product-title']") ||
      row.querySelector?.("[data-testid='product-title']") ||
      row.querySelector?.("[data-anchor-id='OrderItemName']") ||
      row.querySelector?.("[data-automation-id='product-title']") ||
      row.querySelector?.(".product-title") ||
      row.querySelector?.(".item-name") ||
      row.querySelector?.("a.product-name");
    const priceEl =
      row.querySelector?.("[data-test='line-price']") ||
      row.querySelector?.("[data-testid='line-price']") ||
      row.querySelector?.("[data-anchor-id='OrderItemPrice']") ||
      row.querySelector?.("[data-automation-id='line-price']") ||
      row.querySelector?.(".line-price") ||
      row.querySelector?.(".item-price") ||
      row.querySelector?.(".product-price");
    const qtyEl =
      row.querySelector?.("[data-test='item-qty']") ||
      row.querySelector?.("[data-testid='item-qty']") ||
      row.querySelector?.("[data-anchor-id='OrderItemQty']") ||
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
    "[data-anchor-id='OrderTotal']",
    "[data-automation-id='order-total']",
    ".order-total",
    ".grand-total",
  ]);
  const fromDirect = parseUsd(direct);
  if (fromDirect != null) return fromDirect;

  // Fallback: scan summary rows for one whose label looks like a grand total.
  const rows = doc.querySelectorAll?.(
    "[data-test='order-summary'] div, [data-testid='order-summary'] div, [data-anchor-id='OrderSummary'] div, .order-summary div, .order-summary tr, tr",
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
    "[data-anchor-id='OrderDate']",
    "[data-automation-id='order-date']",
    ".order-date",
    "time",
  ];
  for (const sel of candidates) {
    const iso = parseDoordashDate(nodeText(doc.querySelector?.(sel)));
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
    raw: { url, source: "doordash" },
  };
  const id = extractOrderId(doc, url);
  if (id) partial.id = `${MERCHANT_ID}:${id}`;
  return partial;
}

const doordashExtractor = {
  id: MERCHANT_ID,
  version: "0.1.0",
  matches: (url) => matchesDoordash(url),
  extract,
};

export default doordashExtractor;
