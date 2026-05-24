// Tests for src/extractors/costco.js
import assert from "node:assert/strict";
import costcoExtractor, {
  matchesCostco,
  parseUsd,
  parseCostcoDate,
  extractOrderId,
  extract,
} from "../../src/extractors/costco.js";
import { runExtractor } from "../../src/extractor.js";

// ── tiny DOM shim (same style as best-buy-ca.test.mjs) ────────────────────
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

// ── matchesCostco ────────────────────────────────────────────────────────
assert.equal(matchesCostco("https://www.costco.com/OrderStatusCmd"), true);
assert.equal(matchesCostco("https://www.costco.com/OrderStatusDetailsView?orderNumber=12345"), true);
assert.equal(matchesCostco("https://www.costco.com/my-account/orders/12345"), true);
assert.equal(matchesCostco("https://costco.com/OrderStatusCmd"), true);
assert.equal(matchesCostco("https://www.costco.ca/OrderStatusCmd"), false);
assert.equal(matchesCostco("https://www.costco.com/p/cool-thing"), false);
assert.equal(matchesCostco(null), false);
assert.equal(matchesCostco("not-a-url"), false);

// ── parseUsd ─────────────────────────────────────────────────────────────
assert.equal(parseUsd("$1,234.50"), 1234.5);
assert.equal(parseUsd("USD 99"), 99);
assert.equal(parseUsd("US$ 12.00"), 12);
assert.equal(parseUsd("Total: $0"), 0);
assert.equal(parseUsd(""), null);
assert.equal(parseUsd(null), null);
assert.equal(parseUsd("free"), null);

// ── parseCostcoDate ──────────────────────────────────────────────────────
assert.ok(parseCostcoDate("May 23, 2026").startsWith("2026-05-23"));
assert.ok(parseCostcoDate("Ordered May 23, 2026").startsWith("2026-05-23"));
assert.ok(parseCostcoDate("05/23/2026").startsWith("2026-05-23"));
assert.ok(parseCostcoDate("Sep 7, 2025").startsWith("2025-09-07"));
assert.equal(parseCostcoDate("not a date"), null);
assert.equal(parseCostcoDate(""), null);

// ── extractOrderId from URL ──────────────────────────────────────────────
assert.equal(
  extractOrderId({ querySelector: () => null }, "https://www.costco.com/my-account/orders/CW00099887766"),
  "CW00099887766",
);
assert.equal(
  extractOrderId({ querySelector: () => null }, "https://www.costco.com/OrderStatusDetailsView?orderNumber=CW123456789"),
  "CW123456789",
);
{
  const doc = {
    querySelector: (sel) =>
      sel === "[data-testid='order-number']"
        ? { textContent: "Order # CW1234567890" }
        : null,
  };
  assert.equal(extractOrderId(doc, "https://www.costco.com/OrderStatusCmd"), "CW1234567890");
}

// ── full happy-path extract via the shim DOM ─────────────────────────────
{
  const root = el("div", { children: [
    el("span", { attrs: { "data-testid": "order-date" }, text: "Ordered May 23, 2026" }),
    el("div", { attrs: { "data-testid": "order-total" }, text: "$987.65" }),
    el("div", { attrs: { "data-testid": "order-item" }, children: [
      el("a", { attrs: { "data-testid": "product-title" }, text: "Kirkland Signature Coffee 3-pack" }),
      el("span", { attrs: { "data-testid": "line-price" }, text: "$39.99" }),
      el("span", { attrs: { "data-testid": "item-qty" }, text: "Qty 2" }),
    ]}),
    el("div", { attrs: { "data-testid": "order-item" }, children: [
      el("a", { attrs: { "data-testid": "product-title" }, text: "LG 65\" OLED TV" }),
      el("span", { attrs: { "data-testid": "line-price" }, text: "$1,299.99" }),
      el("span", { attrs: { "data-testid": "item-qty" }, text: "Qty 1" }),
    ]}),
  ]});
  const url = "https://www.costco.com/my-account/orders/CW0099887766";
  const partial = extract(root, { url });
  assert.ok(partial, "partial returned");
  assert.equal(partial.merchantId, "costco");
  assert.equal(partial.currency, "USD");
  assert.equal(partial.total, 987.65);
  assert.ok(partial.date.startsWith("2026-05-23"));
  assert.equal(partial.id, "costco:CW0099887766");
  assert.equal(partial.items.length, 2);
  assert.equal(partial.items[0].name, "Kirkland Signature Coffee 3-pack");
  assert.equal(partial.items[0].qty, 2);
  assert.equal(partial.items[0].lineTotal, 39.99);
  assert.equal(partial.items[1].name, "LG 65\" OLED TV");
  assert.equal(partial.items[1].qty, 1);
  assert.equal(partial.items[1].lineTotal, 1299.99);

  const result = runExtractor(costcoExtractor, root, { url });
  assert.equal(result.ok, true, result.error && result.error.message);
  assert.equal(result.receipt.merchantId, "costco");
  assert.equal(result.receipt.total, 987.65);
  assert.equal(result.receipt.currency, "USD");
  assert.equal(result.receipt.items.length, 2);
  assert.equal(result.receipt.id, "costco:CW0099887766");
}

// ── no total → extractor returns null → runExtractor reports failure ─────
{
  const root = el("div", { children: [
    el("span", { attrs: { "data-testid": "order-date" }, text: "May 23, 2026" }),
  ]});
  assert.equal(extract(root, { url: "https://www.costco.com/OrderStatusCmd" }), null);
  const result = runExtractor(costcoExtractor, root, { url: "https://www.costco.com/OrderStatusCmd" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "EMPTY_RESULT");
}

// ── matches() rejects non-costco.com URLs through runExtractor ───────────
{
  const root = el("div");
  const result = runExtractor(costcoExtractor, root, { url: "https://www.costco.ca/OrderStatusCmd" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "NO_MATCH");
}

// ── extractor object shape ───────────────────────────────────────────────
assert.equal(costcoExtractor.id, "costco");
assert.equal(typeof costcoExtractor.version, "string");
assert.equal(typeof costcoExtractor.extract, "function");
assert.equal(typeof costcoExtractor.matches, "function");

console.log("\u2713 costco extractor");
