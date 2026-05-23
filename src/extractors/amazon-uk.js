// Receipts — Amazon UK (amazon.co.uk) extractor.
//
// Pulls order id, date, GBP total, and line items off the canonical
// order-details page:
//   https://www.amazon.co.uk/gp/your-account/order-details?orderID=...
//
// Selector-tolerant in the same spirit as amazon-us/amazon-in: tries a
// small list of candidate selectors and stops at the first that parses.
// The DOM shape on amazon.co.uk is broadly identical to amazon.com but
// with GBP pricing (£-prefixed strings) and UK-style "23 May 2026"
// dates.
//
// Surface:
//   import amazonUkExtractor from "./extractors/amazon-uk.js";
//   runExtractor(amazonUkExtractor, document, { url })
//
// Tests live in tests/extractors/amazon-uk.test.mjs.

const MERCHANT_ID = "amazon-uk";
const CURRENCY = "GBP";

/** True iff this URL is an Amazon.co.uk order-details / orders page. */
export function matchesAmazonUk(url) {
  if (!url || typeof url !== "string") return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.hostname !== "www.amazon.co.uk" && u.hostname !== "amazon.co.uk") return false;
  const p = u.pathname || "";
  return (
    p.includes("/gp/your-account/order-details") ||
    p.includes("/gp/css/summary") ||
    p.includes("/gp/your-account/order-history") ||
    p.includes("/your-orders")
  );
}

/** Read trimmed, whitespace-collapsed text from a node. */
function nodeText(el) {
  if (!el) return "";
  const t = el.textContent || "";
  return String(t).replace(/\s+/g, " ").trim();
}

/** Parse "£1,234.50" / "GBP 99" / "1,234.50 GBP" into a Number. */
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

/** Parse Amazon.co.uk date strings like "23 May 2026" or "Ordered on 23 May 2026". */
export function parseAmazonUkDate(str) {
  if (!str) return null;
  const cleaned = String(str)
    .replace(/^.*?(?:ordered on|order placed|placed on|order date:?)\s*/i, "")
    .trim();
  // Preferred UK format: "23 May 2026"
  let m = cleaned.match(/(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})/);
  if (m) {
    const [, dd, monStr, yyyy] = m;
    return monthDayYearToIso(monStr, dd, yyyy);
  }
  // Fallback US-style: "May 23, 2026"
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

/** Pick the first element matching any selector in the list. */
function firstMatch(doc, selectors) {
  for (const sel of selectors) {
    const el = doc.querySelector?.(sel);
    if (el) return el;
  }
  return null;
}

/** Pull text from the first matching selector. */
function firstText(doc, selectors) {
  return nodeText(firstMatch(doc, selectors));
}

/** Extract the order id from the URL or from page metadata. */
export function extractOrderId(doc, url) {
  if (url && typeof url === "string") {
    try {
      const u = new URL(url);
      const fromQs = u.searchParams.get("orderID") || u.searchParams.get("orderId");
      if (fromQs) return fromQs.trim();
    } catch { /* ignore */ }
  }
  const txt = firstText(doc, [
    "[data-test-id='order-id']",
    ".order-id",
    "bdi",
    "#orderDetails .order-info span.value",
  ]);
  const m = txt && txt.match(/\d{3}-\d{7}-\d{7}/);
  return m ? m[0] : null;
}

/** Pull line items from common order-details containers. */
export function extractItems(doc) {
  const rows = doc.querySelectorAll?.(
    [
      ".yohtmlc-item",
      ".a-fixed-left-grid-inner",
      "[data-test-id='order-item']",
    ].join(", "),
  );
  if (!rows || rows.length === 0) return [];
  const items = [];
  for (const row of rows) {
    const nameEl =
      row.querySelector?.(".a-link-normal") ||
      row.querySelector?.("[data-test-id='item-title']") ||
      row.querySelector?.(".item-title");
    const priceEl =
      row.querySelector?.(".a-color-price") ||
      row.querySelector?.("[data-test-id='item-price']") ||
      row.querySelector?.(".item-price");
    const qtyEl =
      row.querySelector?.(".item-view-qty") ||
      row.querySelector?.("[data-test-id='item-qty']");

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
    "[data-test-id='order-total']",
    ".grand-total-price",
    ".a-color-price.grand-total",
    "#od-subtotals .a-text-bold",
  ]);
  const fromDirect = parseGbp(direct);
  if (fromDirect != null) return fromDirect;

  // Fallback: scan subtotal rows for one whose label looks like a grand total.
  const rows = doc.querySelectorAll?.("#od-subtotals .a-row, .od-subtotals-row, tr");
  if (rows) {
    for (const row of rows) {
      const label = nodeText(row.querySelector?.(".a-text-right, .a-column.a-text-right, td"));
      const value = nodeText(row);
      if (!label && !value) continue;
      const text = `${label} ${value}`.toLowerCase();
      if (/grand total|order total|total for this order/.test(text)) {
        const n = parseGbp(value);
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
    ".order-date-invoice-item",
    ".order-info .a-color-secondary",
    ".order-date",
  ];
  for (const sel of candidates) {
    const iso = parseAmazonUkDate(nodeText(doc.querySelector?.(sel)));
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
    raw: { url, source: "amazon-uk" },
  };
  const id = extractOrderId(doc, url);
  if (id) partial.id = `${MERCHANT_ID}:${id}`;
  return partial;
}

const amazonUkExtractor = {
  id: MERCHANT_ID,
  version: "0.1.0",
  matches: (url) => matchesAmazonUk(url),
  extract,
};

export default amazonUkExtractor;
