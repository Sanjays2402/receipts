// Tests for src/extractors/best-buy-ca.js
// Uses the same tiny DOM shim style as walmart.test.mjs.
import assert from "node:assert/strict";
import bestBuyCaExtractor, {
  matchesBestBuyCa,
  parseCad,
  parseBestBuyCaDate,
  extractOrderId,
  extractItems,
  extractTotal,
  extractDate,
  extract,
} from "../../src/extractors/best-buy-ca.js";
import { runExtractor } from "../../src/extractor.js";

// ── tiny DOM shim ────────────────────────────────────────────────────────
function el(tag, { text = "", attrs = {}, children = [] } = {}) {
  const node = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attrs: { ...attrs },
    _text: text,
    appendChild(c) { this.children.push(c); return c; },
    get textContent() {
      if (this._text) return this._text;
      return this.children.map((c) => c.textContent || "").join(" ");
    },
    set textContent(v) { this._text = String(v); this.children = []; },
    matches(sel) { return matchesSelector(this, sel); },
    querySelector(sel) { return find(this, sel, true); },
    querySelectorAll(sel) { return find(this, sel, false); },
  };
  for (const c of children) node.appendChild(c);
  return node;
}
function parseSimple(sel) {
  const parts = sel.trim().split(/\s+/);
  return parts.map((p) => {
    const out = { tag: null, classes: [], id: null, attrs: [] };
    let rest = p;
    const attrRe = /\[([a-zA-Z0-9_-]+)(?:=['"]?([^'"\]]+)['"]?)?\]/g;
    let m;
    while ((m = attrRe.exec(rest))) {
      out.attrs.push({ name: m[1], value: m[2] || null });
    }
    rest = rest.replace(attrRe, "");
    const idM = rest.match(/#([a-zA-Z0-9_-]+)/);
    if (idM) out.id = idM[1];
    rest = rest.replace(/#[a-zA-Z0-9_-]+/, "");
    const classMs = rest.match(/\.[a-zA-Z0-9_-]+/g) || [];
    out.classes = classMs.map((c) => c.slice(1));
    rest = rest.replace(/\.[a-zA-Z0-9_-]+/g, "");
    if (rest && /^[a-zA-Z][a-zA-Z0-9-]*$/.test(rest)) out.tag = rest.toLowerCase();
    return out;
  });
}
function nodeMatchesSegment(node, seg) {
  if (seg.tag && node.tagName?.toLowerCase() !== seg.tag) return false;
  if (seg.id && node.attrs?.id !== seg.id) return false;
  if (seg.classes.length) {
    const classes = (node.attrs?.class || "").split(/\s+/);
    for (const c of seg.classes) if (!classes.includes(c)) return false;
  }
  for (const a of seg.attrs) {
    const v = node.attrs ? node.attrs[a.name] : undefined;
    if (v === undefined) return false;
    if (a.value && v !== a.value) return false;
  }
  return true;
}
function matchesSelector(node, sel) {
  for (const one of sel.split(",")) {
    const segs = parseSimple(one);
    if (segs.length === 1 && nodeMatchesSegment(node, segs[0])) return true;
  }
  return false;
}
function findRec(root, segs, idx, into, justOne) {
  for (const c of root.children || []) {
    if (nodeMatchesSegment(c, segs[idx])) {
      if (idx === segs.length - 1) {
        into.push(c);
        if (justOne) return true;
      } else {
        if (findRec(c, segs, idx + 1, into, justOne) && justOne) return true;
      }
    }
    if (findRec(c, segs, idx, into, justOne) && justOne) return true;
  }
  return false;
}
function find(root, sel, justOne) {
  const into = [];
  for (const one of sel.split(",")) {
    const segs = parseSimple(one.trim());
    findRec(root, segs, 0, into, justOne);
    if (justOne && into.length) return into[0];
  }
  return justOne ? null : into;
}

// ── matchesBestBuyCa ─────────────────────────────────────────────────────
assert.equal(matchesBestBuyCa("https://www.bestbuy.ca/profile/orderhistory/12345"), true);
assert.equal(matchesBestBuyCa("https://www.bestbuy.ca/en-ca/account/orderhistory/12345"), true);
assert.equal(matchesBestBuyCa("https://bestbuy.ca/profile/orderhistory"), true);
assert.equal(matchesBestBuyCa("https://www.bestbuy.com/profile/c/orders/12345"), false);
assert.equal(matchesBestBuyCa("https://www.bestbuy.ca/en-ca/product/something"), false);
assert.equal(matchesBestBuyCa(null), false);
assert.equal(matchesBestBuyCa("not-a-url"), false);

// ── parseCad ─────────────────────────────────────────────────────────────
assert.equal(parseCad("$1,234.50 CAD"), 1234.5);
assert.equal(parseCad("CAD 99"), 99);
assert.equal(parseCad("C$ 12.00"), 12);
assert.equal(parseCad("CA$45.99"), 45.99);
assert.equal(parseCad("Total: $0"), 0);
assert.equal(parseCad(""), null);
assert.equal(parseCad(null), null);
assert.equal(parseCad("free"), null);

// ── parseBestBuyCaDate ───────────────────────────────────────────────────
assert.ok(parseBestBuyCaDate("May 23, 2026").startsWith("2026-05-23"));
assert.ok(parseBestBuyCaDate("Ordered May 23, 2026").startsWith("2026-05-23"));
assert.ok(parseBestBuyCaDate("Date placed: January 1, 2026").startsWith("2026-01-01"));
assert.ok(parseBestBuyCaDate("Sep 7, 2025").startsWith("2025-09-07"));
assert.ok(parseBestBuyCaDate("23 May 2026").startsWith("2026-05-23"));
assert.equal(parseBestBuyCaDate("not a date"), null);
assert.equal(parseBestBuyCaDate(""), null);

// ── extractOrderId from URL ──────────────────────────────────────────────
assert.equal(
  extractOrderId({ querySelector: () => null }, "https://www.bestbuy.ca/profile/orderhistory/BBY01-200012345"),
  "BBY01-200012345",
);
{
  const doc = {
    querySelector: (sel) =>
      sel === "[data-testid='order-number']"
        ? { textContent: "Order # BBY99887766" }
        : null,
  };
  assert.equal(extractOrderId(doc, "https://www.bestbuy.ca/profile/orderhistory"), "BBY99887766");
}

// ── full happy-path extract via the shim DOM ─────────────────────────────
{
  const root = el("div", { children: [
    el("span", { attrs: { "data-testid": "order-date" }, text: "Ordered May 23, 2026" }),
    el("div", { attrs: { "data-testid": "order-total" }, text: "$1,287.45 CAD" }),
    el("div", { attrs: { "data-testid": "order-item" }, children: [
      el("a", { attrs: { "data-testid": "product-title" }, text: "Sony WH-1000XM5 Headphones" }),
      el("span", { attrs: { "data-testid": "line-price" }, text: "C$ 449.99" }),
      el("span", { attrs: { "data-testid": "item-qty" }, text: "Qty 1" }),
    ]}),
    el("div", { attrs: { "data-testid": "order-item" }, children: [
      el("a", { attrs: { "data-testid": "product-title" }, text: "Apple TV 4K" }),
      el("span", { attrs: { "data-testid": "line-price" }, text: "$199.99" }),
      el("span", { attrs: { "data-testid": "item-qty" }, text: "Qty 2" }),
    ]}),
  ]});
  const url = "https://www.bestbuy.ca/profile/orderhistory/BBY01-200012345";
  const partial = extract(root, { url });
  assert.ok(partial, "partial returned");
  assert.equal(partial.merchantId, "best-buy-ca");
  assert.equal(partial.currency, "CAD");
  assert.equal(partial.total, 1287.45);
  assert.ok(partial.date.startsWith("2026-05-23"));
  assert.equal(partial.id, "best-buy-ca:BBY01-200012345");
  assert.equal(partial.items.length, 2);
  assert.equal(partial.items[0].name, "Sony WH-1000XM5 Headphones");
  assert.equal(partial.items[0].qty, 1);
  assert.equal(partial.items[0].lineTotal, 449.99);
  assert.equal(partial.items[1].name, "Apple TV 4K");
  assert.equal(partial.items[1].qty, 2);
  assert.equal(partial.items[1].lineTotal, 199.99);

  const result = runExtractor(bestBuyCaExtractor, root, { url });
  assert.equal(result.ok, true, result.error && result.error.message);
  assert.equal(result.receipt.merchantId, "best-buy-ca");
  assert.equal(result.receipt.total, 1287.45);
  assert.equal(result.receipt.currency, "CAD");
  assert.equal(result.receipt.items.length, 2);
  assert.equal(result.receipt.id, "best-buy-ca:BBY01-200012345");
}

// ── no total → extractor returns null → runExtractor reports failure ─────
{
  const root = el("div", { children: [
    el("span", { attrs: { "data-testid": "order-date" }, text: "May 23, 2026" }),
  ]});
  assert.equal(extract(root, { url: "https://www.bestbuy.ca/profile/orderhistory/1" }), null);
  const result = runExtractor(bestBuyCaExtractor, root, { url: "https://www.bestbuy.ca/profile/orderhistory/1" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "EMPTY_RESULT");
}

// ── matches() rejects non-bestbuy.ca URLs through runExtractor ──────────
{
  const root = el("div");
  const result = runExtractor(bestBuyCaExtractor, root, { url: "https://www.bestbuy.com/profile/c/orders/123" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "NO_MATCH");
}

// ── extractor object shape ───────────────────────────────────────────────
assert.equal(bestBuyCaExtractor.id, "best-buy-ca");
assert.equal(typeof bestBuyCaExtractor.version, "string");
assert.equal(typeof bestBuyCaExtractor.extract, "function");
assert.equal(typeof bestBuyCaExtractor.matches, "function");

console.log("\u2713 best-buy-ca extractor");
