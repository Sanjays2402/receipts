// Tests for src/extractors/flipkart.js
import assert from "node:assert/strict";
import flipkartExtractor, {
  matchesFlipkart,
  parseInr,
  parseFlipkartDate,
  extractOrderId,
  extractItems,
  extractTotal,
  extractDate,
  extract,
} from "../../src/extractors/flipkart.js";
import { runExtractor } from "../../src/extractor.js";

// ── tiny DOM shim (mirrors amazon-in test) ───────────────────────────────
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

// ── matchesFlipkart ──────────────────────────────────────────────────────
assert.equal(matchesFlipkart("https://www.flipkart.com/account/order-details?order_id=OD123456789012345678"), true);
assert.equal(matchesFlipkart("https://www.flipkart.com/account/orders"), true);
assert.equal(matchesFlipkart("https://www.amazon.in/gp/your-account/order-details?orderID=171"), false);
assert.equal(matchesFlipkart("https://www.flipkart.com/mobiles"), false);
assert.equal(matchesFlipkart(null), false);
assert.equal(matchesFlipkart("not-a-url"), false);

// ── parseInr ─────────────────────────────────────────────────────────────
assert.equal(parseInr("₹1,234.50"), 1234.5);
assert.equal(parseInr("Rs. 99"), 99);
assert.equal(parseInr("INR 2,000"), 2000);
assert.equal(parseInr("Total: ₹0"), 0);
assert.equal(parseInr(""), null);
assert.equal(parseInr(null), null);
assert.equal(parseInr("free"), null);

// ── parseFlipkartDate ────────────────────────────────────────────────────
assert.ok(parseFlipkartDate("23 May 2026").startsWith("2026-05-23"));
assert.ok(parseFlipkartDate("Ordered on 1 January 2026").startsWith("2026-01-01"));
assert.ok(parseFlipkartDate("On Sat, 23rd May 2026").startsWith("2026-05-23"));
assert.ok(parseFlipkartDate("23rd May'26").startsWith("2026-05-23"));
assert.ok(parseFlipkartDate("2026-05-23").startsWith("2026-05-23"));
assert.equal(parseFlipkartDate("not a date"), null);
assert.equal(parseFlipkartDate(""), null);

// ── extractOrderId from URL ──────────────────────────────────────────────
assert.equal(
  extractOrderId({ querySelector: () => null }, "https://www.flipkart.com/account/order-details?order_id=OD123456789012345678"),
  "OD123456789012345678",
);
// from DOM text when missing from URL
{
  const doc = {
    querySelector: (sel) => sel === "body" ? { textContent: "Order ID OD987654321098765432 placed" } : null,
  };
  assert.equal(extractOrderId(doc, "https://www.flipkart.com/account/orders"), "OD987654321098765432");
}

// ── full happy-path extract via the shim DOM ─────────────────────────────
{
  const root = el("div", { children: [
    el("span", { attrs: { "data-test-id": "order-date" }, text: "On Sat, 23rd May'26" }),
    el("div", { attrs: { "data-test-id": "order-total" }, text: "₹2,499.00" }),
    el("div", { attrs: { "data-test-id": "order-item" }, children: [
      el("a", { attrs: { "data-test-id": "item-title" }, text: "Wireless Mouse" }),
      el("span", { attrs: { "data-test-id": "item-price" }, text: "₹999.00" }),
      el("span", { attrs: { "data-test-id": "item-qty" }, text: "Qty: 2" }),
    ]}),
    el("div", { attrs: { "data-test-id": "order-item" }, children: [
      el("a", { attrs: { "data-test-id": "item-title" }, text: "USB-C Cable" }),
      el("span", { attrs: { "data-test-id": "item-price" }, text: "₹501.00" }),
    ]}),
  ]});
  const partial = extract(root, { url: "https://www.flipkart.com/account/order-details?order_id=OD123456789012345678" });
  assert.ok(partial, "partial returned");
  assert.equal(partial.merchantId, "flipkart");
  assert.equal(partial.currency, "INR");
  assert.equal(partial.total, 2499);
  assert.ok(partial.date.startsWith("2026-05-23"));
  assert.equal(partial.id, "flipkart:OD123456789012345678");
  assert.equal(partial.items.length, 2);
  assert.equal(partial.items[0].name, "Wireless Mouse");
  assert.equal(partial.items[0].qty, 2);
  assert.equal(partial.items[0].lineTotal, 999);
  assert.equal(partial.items[1].name, "USB-C Cable");
  assert.equal(partial.items[1].lineTotal, 501);

  const result = runExtractor(flipkartExtractor, root, { url: "https://www.flipkart.com/account/order-details?order_id=OD123456789012345678" });
  assert.equal(result.ok, true, result.error && result.error.message);
  assert.equal(result.receipt.merchantId, "flipkart");
  assert.equal(result.receipt.total, 2499);
  assert.equal(result.receipt.currency, "INR");
  assert.equal(result.receipt.items.length, 2);
  assert.equal(result.receipt.id, "flipkart:OD123456789012345678");
}

// ── grand-total fallback via summary rows ────────────────────────────────
{
  const root = el("div", { children: [
    el("li", { attrs: { class: "summary-row" }, text: "Subtotal ₹1,000.00" }),
    el("li", { attrs: { class: "summary-row" }, text: "Total Amount ₹1,250.00" }),
  ]});
  assert.equal(extractTotal(root), 1250);
}

// ── no total → extractor returns null → runExtractor reports failure ─────
{
  const root = el("div", { children: [
    el("span", { attrs: { "data-test-id": "order-date" }, text: "23 May 2026" }),
  ]});
  assert.equal(extract(root, { url: "https://www.flipkart.com/account/order-details" }), null);
  const result = runExtractor(flipkartExtractor, root, { url: "https://www.flipkart.com/account/order-details" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "EMPTY_RESULT");
}

// ── matches() rejects non-flipkart URLs through runExtractor ─────────────
{
  const root = el("div");
  const result = runExtractor(flipkartExtractor, root, { url: "https://www.amazon.in/gp/your-account/order-details" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "NO_MATCH");
}

// ── extractor object shape ───────────────────────────────────────────────
assert.equal(flipkartExtractor.id, "flipkart");
assert.equal(typeof flipkartExtractor.version, "string");
assert.equal(typeof flipkartExtractor.extract, "function");
assert.equal(typeof flipkartExtractor.matches, "function");

console.log("\u2713 flipkart extractor");
