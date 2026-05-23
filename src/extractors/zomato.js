// Receipts — Zomato (zomato.com) extractor.
//
// Pulls order id, date, INR total, and line items off Zomato order pages:
//   https://www.zomato.com/users/<username>/orders
//   https://www.zomato.com/users/<username>/orders/<orderId>
//   https://www.zomato.com/orders/<orderId>
//   https://www.zomato.com/order/<orderId>
//
// Selector-tolerant: Zomato ships obfuscated CSS class names, so we
// prefer stable data-* / data-testid hooks and fall back to visible-text
// heuristics for totals and dates.

const MERCHANT_ID = "zomato";
const CURRENCY = "INR";

/** True iff this URL is a Zomato orders page. */
export function matchesZomato(url) {
  if (!url || typeof url !== "string") return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.hostname !== "www.zomato.com" && u.hostname !== "zomato.com") return false;
  const p = u.pathname || "";
  return (
    /^\/users\/[^/]+\/orders/.test(p) ||
    p.startsWith("/orders") ||
    p.startsWith("/order/")
  );
}

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

/** Parse Zomato date strings like "Order placed on 23 May 2026" / "May 23, 2026". */
export function parseZomatoDate(str) {
  if (!str) return null;
  const cleaned = String(str)
    .replace(/^.*?(?:order placed on|placed on|placed|ordered on|ordered|order date:?|delivered on|delivery date:?|date:?)\s*/i, "")
    .trim();
  let m = cleaned.match(/(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})/);
  if (m) {
    const [, dd, monStr, yyyy] = m;
    return monthDayYearToIso(monStr, dd, yyyy);
  }
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

/**
 * Extract the order id. Zomato ids show up either in the URL path
 * (/orders/<id>, /order/<id>, /users/<u>/orders/<id>) or as visible
 * "Order #<id>" text on the page.
 */
export function extractOrderId(doc, url) {
  if (url && typeof url === "string") {
    try {
      const u = new URL(url);
      const m = u.pathname.match(/\/users\/[^/]+\/orders\/([A-Z0-9-]{6,})/i)
        || u.pathname.match(/\/orders\/([A-Z0-9-]{6,})/i)
        || u.pathname.match(/\/order\/([A-Z0-9-]{6,})/i);
      if (m) return m[1];
    } catch { /* ignore */ }
  }
  const txt = firstText(doc, [
    "[data-test='order-number']",
    "[data-testid='order-number']",
    "[data-cy='order-number']",
    "[data-qa='order-number']",
    ".order-number",
    ".order-id",
  ]);
  let m = txt && txt.match(/(?:order\s*(?:#|id:?)\s*)([A-Z0-9-]{6,})/i);
  if (m) return m[1];
  m = txt && txt.match(/[A-Z0-9-]{8,}/i);
  return m ? m[0] : null;
}

/** Pull line items from common order-details containers. */
export function extractItems(doc) {
  const rows = doc.querySelectorAll?.(
    [
      "[data-test='order-item']",
      "[data-testid='order-item']",
      "[data-cy='order-item']",
      "[data-qa='order-item']",
      ".order-item",
      "li.order-cart-item",
      ".item-row",
    ].join(", "),
  );
  if (!rows || rows.length === 0) return [];
  const items = [];
  for (const row of rows) {
    const nameEl =
      row.querySelector?.("[data-test='product-title']") ||
      row.querySelector?.("[data-testid='product-title']") ||
      row.querySelector?.("[data-cy='item-name']") ||
      row.querySelector?.("[data-qa='item-name']") ||
      row.querySelector?.(".item-name") ||
      row.querySelector?.(".product-title") ||
      row.querySelector?.(".dish-name");
    const priceEl =
      row.querySelector?.("[data-test='line-price']") ||
      row.querySelector?.("[data-testid='line-price']") ||
      row.querySelector?.("[data-cy='item-price']") ||
      row.querySelector?.("[data-qa='item-price']") ||
      row.querySelector?.(".item-price") ||
      row.querySelector?.(".line-price") ||
      row.querySelector?.(".dish-price");
    const qtyEl =
      row.querySelector?.("[data-test='item-qty']") ||
      row.querySelector?.("[data-testid='item-qty']") ||
      row.querySelector?.("[data-cy='item-qty']") ||
      row.querySelector?.("[data-qa='item-qty']") ||
      row.querySelector?.(".item-qty") ||
      row.querySelector?.(".quantity");

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
    "[data-test='order-total']",
    "[data-testid='order-total']",
    "[data-cy='order-total']",
    "[data-qa='order-total']",
    "[data-test='grand-total']",
    "[data-testid='grand-total']",
    ".order-total",
    ".grand-total",
    ".bill-total",
  ]);
  const fromDirect = parseInr(direct);
  if (fromDirect != null) return fromDirect;

  const rows = doc.querySelectorAll?.(
    "[data-test='order-summary'] div, [data-testid='order-summary'] div, [data-cy='bill-summary'] div, .bill-summary div, .order-summary div, tr",
  );
  if (rows) {
    for (const row of rows) {
      const text = nodeText(row).toLowerCase();
      if (!text) continue;
      if (/total[^a-z]|order total|grand total|bill total|total paid|amount paid/.test(text) &&
          !/subtotal|item total|items? total|delivery/.test(text)) {
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
    "[data-test='order-date']",
    "[data-testid='order-date']",
    "[data-cy='order-date']",
    "[data-qa='order-date']",
    ".order-date",
    ".order-placed-on",
    "time",
  ];
  for (const sel of candidates) {
    const iso = parseZomatoDate(nodeText(doc.querySelector?.(sel)));
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
    raw: { url, source: "zomato" },
  };
  const id = extractOrderId(doc, url);
  if (id) partial.id = `${MERCHANT_ID}:${id}`;
  return partial;
}

const zomatoExtractor = {
  id: MERCHANT_ID,
  version: "0.1.0",
  matches: (url) => matchesZomato(url),
  extract,
};

export default zomatoExtractor;
