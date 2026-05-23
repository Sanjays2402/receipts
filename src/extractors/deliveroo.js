// Receipts — Deliveroo (UK) extractor.
//
// Targets the canonical order-details / receipt pages:
//   https://deliveroo.co.uk/orders/<orderId>
//   https://deliveroo.co.uk/orders/<orderId>/receipt
//   https://deliveroo.co.uk/order-status/<orderId>
//
// Selector-tolerant: tries a small ranked list of candidate selectors per
// field and stops at the first that yields a parseable value. Mirrors the
// ubereats-us extractor so behaviour stays consistent across food merchants.

const MERCHANT_ID = "deliveroo";
const CURRENCY = "GBP";

/** True iff this URL is a Deliveroo UK orders/receipt page. */
export function matchesDeliveroo(url) {
  if (!url || typeof url !== "string") return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.hostname !== "deliveroo.co.uk" && u.hostname !== "www.deliveroo.co.uk") return false;
  const p = u.pathname || "";
  return p.startsWith("/orders")
    || p.startsWith("/order/")
    || p.startsWith("/order-status/")
    || p.startsWith("/receipt");
}

function nodeText(el) {
  if (!el) return "";
  const t = el.textContent || "";
  return String(t).replace(/\s+/g, " ").trim();
}

/** Parse "£1,234.50" / "GBP 99" / "£ 12.00" into a Number. */
export function parseGbp(str) {
  if (str == null) return null;
  const s = String(str)
    .replace(/£/g, "")
    .replace(/\bGBP\b/gi, "")
    .replace(/[,\s]/g, "");
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** Parse Deliveroo date strings like "23 May 2026", "Ordered 23 May 2026 at 7:12 PM", or "May 23, 2026". */
export function parseDeliverooDate(str) {
  if (!str) return null;
  const cleaned = String(str)
    .replace(/^.*?(?:placed on|placed|ordered on|ordered|order placed|order date:?|delivered on|delivery date:?|completed on|completed)\s*/i, "")
    .trim();
  // UK style: "23 May 2026"
  let m = cleaned.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (m) {
    const [, dd, monStr, yyyy] = m;
    return monthDayYearToIso(monStr, dd, yyyy);
  }
  // US style fallback: "May 23, 2026"
  m = cleaned.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const [, monStr, dd, yyyy] = m;
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

/** Extract the order id. Deliveroo uses alphanumeric ids in the path. */
export function extractOrderId(doc, url) {
  if (url && typeof url === "string") {
    try {
      const u = new URL(url);
      const m = u.pathname.match(/\/(?:orders?|order-status)\/([A-Z0-9-]{4,})/i);
      if (m) return m[1];
    } catch { /* ignore */ }
  }
  const txt = firstText(doc, [
    "[data-test='order-number']",
    "[data-testid='order-number']",
    "[data-anchor-id='OrderNumber']",
    ".order-number",
    ".order-id",
  ]);
  const m = txt && txt.match(/[A-Z0-9-]{6,}/i);
  return m ? m[0] : null;
}

/** Pull line items from common order-details containers. */
export function extractItems(doc) {
  const rows = doc.querySelectorAll?.(
    [
      "[data-test='order-item']",
      "[data-testid='order-item']",
      "[data-anchor-id='OrderItem']",
      ".order-item",
      "li.order-cart-item",
      ".receipt-line-item",
    ].join(", "),
  );
  if (!rows || rows.length === 0) return [];
  const items = [];
  for (const row of rows) {
    const nameEl =
      row.querySelector?.("[data-test='product-title']") ||
      row.querySelector?.("[data-testid='product-title']") ||
      row.querySelector?.("[data-anchor-id='OrderItemName']") ||
      row.querySelector?.(".product-title") ||
      row.querySelector?.(".item-name") ||
      row.querySelector?.("a.product-name");
    const priceEl =
      row.querySelector?.("[data-test='line-price']") ||
      row.querySelector?.("[data-testid='line-price']") ||
      row.querySelector?.("[data-anchor-id='OrderItemPrice']") ||
      row.querySelector?.(".line-price") ||
      row.querySelector?.(".item-price") ||
      row.querySelector?.(".product-price");
    const qtyEl =
      row.querySelector?.("[data-test='item-qty']") ||
      row.querySelector?.("[data-testid='item-qty']") ||
      row.querySelector?.("[data-anchor-id='OrderItemQty']") ||
      row.querySelector?.(".item-qty") ||
      row.querySelector?.(".quantity");

    const name = nodeText(nameEl);
    if (!name) continue;
    const lineTotal = parseGbp(nodeText(priceEl));
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
    ".order-total",
    ".grand-total",
    ".receipt-total",
  ]);
  const fromDirect = parseGbp(direct);
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
        const n = parseGbp(nodeText(row));
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
    ".order-date",
    "time",
  ];
  for (const sel of candidates) {
    const iso = parseDeliverooDate(nodeText(doc.querySelector?.(sel)));
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
    raw: { url, source: "deliveroo" },
  };
  const id = extractOrderId(doc, url);
  if (id) partial.id = `${MERCHANT_ID}:${id}`;
  return partial;
}

const deliverooExtractor = {
  id: MERCHANT_ID,
  version: "0.1.0",
  matches: (url) => matchesDeliveroo(url),
  extract,
};

export default deliverooExtractor;
