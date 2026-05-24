// Receipts — Best Buy Canada (bestbuy.ca) extractor.
//
// Pulls order id, date, CAD total, and line items off the canonical
// order-details page:
//   https://www.bestbuy.ca/profile/orderhistory/<orderId>
//   https://www.bestbuy.ca/en-ca/account/orderhistory/<orderId>
//
// Selector-tolerant: tries a small list of candidate selectors for each
// field and stops at the first that returns a parseable value.

const MERCHANT_ID = "best-buy-ca";
const CURRENCY = "CAD";

/** True iff this URL is a Best Buy Canada orders page. */
export function matchesBestBuyCa(url) {
  if (!url || typeof url !== "string") return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.hostname !== "www.bestbuy.ca" && u.hostname !== "bestbuy.ca") return false;
  const p = u.pathname || "";
  return /\/(?:[a-z-]+\/)?(?:profile|account)\/order/i.test(p);
}

function nodeText(el) {
  if (!el) return "";
  const t = el.textContent || "";
  return String(t).replace(/\s+/g, " ").trim();
}

/** Parse "$1,234.50 CAD" / "CAD 99" / "C$ 12.00" into a Number. */
export function parseCad(str) {
  if (str == null) return null;
  const s = String(str)
    .replace(/C\$/gi, "")
    .replace(/CA\$/gi, "")
    .replace(/\$/g, "")
    .replace(/\bCAD\b/gi, "")
    .replace(/[,\s]/g, "");
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** Parse Best Buy CA date strings like "May 23, 2026" or "23 May 2026". */
export function parseBestBuyCaDate(str) {
  if (!str) return null;
  const cleaned = String(str)
    .replace(/^.*?(?:ordered on|ordered|order placed|placed on|order date:?|delivered on|delivery date:?|date placed:?)\s*/i, "")
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

/** Extract the order id. Best Buy CA uses long alphanumeric ids in the path. */
export function extractOrderId(doc, url) {
  if (url && typeof url === "string") {
    try {
      const u = new URL(url);
      const m = u.pathname.match(/\/(?:orderhistory|orders|order)\/([A-Z0-9-]+)/i);
      if (m) return m[1];
    } catch { /* ignore */ }
  }
  const txt = firstText(doc, [
    "[data-testid='order-number']",
    "[data-automation-id='order-number']",
    "[data-test='order-number']",
    ".order-number",
  ]);
  const m = txt && txt.match(/[A-Z0-9]{6,}/i);
  return m ? m[0] : null;
}

/** Pull line items from common order-details containers. */
export function extractItems(doc) {
  const rows = doc.querySelectorAll?.(
    [
      "[data-testid='order-item']",
      "[data-automation-id='order-item']",
      "[data-test='order-item']",
      ".order-item",
      "li.product-row",
    ].join(", "),
  );
  if (!rows || rows.length === 0) return [];
  const items = [];
  for (const row of rows) {
    const nameEl =
      row.querySelector?.("[data-testid='product-title']") ||
      row.querySelector?.("[data-automation-id='product-title']") ||
      row.querySelector?.("[data-test='product-title']") ||
      row.querySelector?.(".product-title") ||
      row.querySelector?.("a.product-name");
    const priceEl =
      row.querySelector?.("[data-testid='line-price']") ||
      row.querySelector?.("[data-automation-id='line-price']") ||
      row.querySelector?.("[data-test='line-price']") ||
      row.querySelector?.(".line-price") ||
      row.querySelector?.(".product-price");
    const qtyEl =
      row.querySelector?.("[data-testid='item-qty']") ||
      row.querySelector?.("[data-automation-id='item-qty']") ||
      row.querySelector?.("[data-test='item-qty']") ||
      row.querySelector?.(".item-qty");

    const name = nodeText(nameEl);
    if (!name) continue;
    const lineTotal = parseCad(nodeText(priceEl));
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
    "[data-testid='order-total']",
    "[data-automation-id='order-total']",
    "[data-test='order-total']",
    ".order-total",
    ".grand-total",
  ]);
  const fromDirect = parseCad(direct);
  if (fromDirect != null) return fromDirect;

  const rows = doc.querySelectorAll?.(
    "[data-testid='order-summary'] div, [data-test='order-summary'] div, .order-summary div, .order-summary tr, tr",
  );
  if (rows) {
    for (const row of rows) {
      const text = nodeText(row).toLowerCase();
      if (!text) continue;
      if (/total[^a-z]|order total|grand total/.test(text) &&
          !/subtotal|item total|items? total/.test(text)) {
        const n = parseCad(nodeText(row));
        if (n != null) return n;
      }
    }
  }
  return null;
}

/** Extract the order date. */
export function extractDate(doc) {
  const candidates = [
    "[data-testid='order-date']",
    "[data-automation-id='order-date']",
    "[data-test='order-date']",
    ".order-date",
    "time",
  ];
  for (const sel of candidates) {
    const iso = parseBestBuyCaDate(nodeText(doc.querySelector?.(sel)));
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
    raw: { url, source: "best-buy-ca" },
  };
  const id = extractOrderId(doc, url);
  if (id) partial.id = `${MERCHANT_ID}:${id}`;
  return partial;
}

const bestBuyCaExtractor = {
  id: MERCHANT_ID,
  version: "0.1.0",
  matches: (url) => matchesBestBuyCa(url),
  extract,
};

export default bestBuyCaExtractor;
