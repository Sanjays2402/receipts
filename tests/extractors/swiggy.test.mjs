// Tests for src/extractors/swiggy.js
import assert from "node:assert/strict";
import swiggyExtractor, {
  matchesSwiggy,
  parseInr,
  parseSwiggyDate,
  extractOrderId,
  extract,
} from "../../src/extractors/swiggy.js";
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

// ── matchesSwiggy ────────────────────────────────────────────────────────
assert.equal(matchesSwiggy("https://www.swiggy.com/my-account/orders"), true);
assert.equal(matchesSwiggy("https://www.swiggy.com/my-account/orders/123456"), true);
assert.equal(matchesSwiggy("https://www.swiggy.com/order/abc-123"), true);
assert.equal(matchesSwiggy("https://swiggy.com/my-account/orders"), true);
assert.equal(matchesSwiggy("https://www.swiggy.com/instamart/order/123"), false, "instamart excluded");
assert.equal(matchesSwiggy("https://www.swiggy.com/restaurants/foo"), false);
assert.equal(matchesSwiggy("https://www.zomato.com/orders/123"), false);
assert.equal(matchesSwiggy(null), false);
assert.equal(matchesSwiggy("not-a-url"), false);

// ── parseInr ─────────────────────────────────────────────────────────────
assert.equal(parseInr("₹1,234.50"), 1234.5);
assert.equal(parseInr("Rs. 1,234"), 1234);
assert.equal(parseInr("INR 99"), 99);
assert.equal(parseInr("Total: ₹0"), 0);
assert.equal(parseInr(""), null);
assert.equal(parseInr(null), null);
assert.equal(parseInr("free"), null);

// ── parseSwiggyDate ──────────────────────────────────────────────────────
assert.ok(parseSwiggyDate("23 May, 2026").startsWith("2026-05-23"));
assert.ok(parseSwiggyDate("Ordered on 23 May, 2026").startsWith("2026-05-23"));
assert.ok(parseSwiggyDate("Placed on 1 January, 2026").startsWith("2026-01-01"));
assert.ok(parseSwiggyDate("May 23, 2026").startsWith("2026-05-23"));
assert.ok(parseSwiggyDate("Sep 7, 2025").startsWith("2025-09-07"));
assert.equal(parseSwiggyDate("not a date"), null);
assert.equal(parseSwiggyDate(""), null);

// ── extractOrderId from URL ──────────────────────────────────────────────
assert.equal(
  extractOrderId({ querySelector: () => null }, "https://www.swiggy.com/my-account/orders/ABC123456"),
  "ABC123456",
);
assert.equal(
  extractOrderId({ querySelector: () => null }, "https://www.swiggy.com/order/XYZ12345"),
  "XYZ12345",
);
{
  const doc = {
    querySelector: (sel) =>
      sel === "[data-test='order-number']"
        ? { textContent: "Order #SW-A1B2C3D4" }
        : null,
  };
  assert.equal(extractOrderId(doc, "https://www.swiggy.com/my-account/orders"), "SW-A1B2C3D4");
}

// ── full happy-path extract via the shim DOM ─────────────────────────────
{
  const root = el("div", { children: [
    el("span", { attrs: { "data-test": "order-date" }, text: "Ordered on 23 May, 2026" }),
    el("div", { attrs: { "data-test": "order-total" }, text: "₹487.50" }),
    el("div", { attrs: { "data-test": "order-item" }, children: [
      el("a", { attrs: { "data-test": "product-title" }, text: "Paneer Butter Masala" }),
      el("span", { attrs: { "data-test": "line-price" }, text: "₹289.00" }),
      el("span", { attrs: { "data-test": "item-qty" }, text: "Qty 1" }),
    ]}),
    el("div", { attrs: { "data-test": "order-item" }, children: [
      el("a", { attrs: { "data-test": "product-title" }, text: "Garlic Naan" }),
      el("span", { attrs: { "data-test": "line-price" }, text: "₹99.00" }),
      el("span", { attrs: { "data-test": "item-qty" }, text: "Qty 2" }),
    ]}),
  ]});
  const partial = extract(root, { url: "https://www.swiggy.com/my-account/orders/ABC123456" });
  assert.ok(partial, "partial returned");
  assert.equal(partial.merchantId, "swiggy");
  assert.equal(partial.currency, "INR");
  assert.equal(partial.total, 487.5);
  assert.ok(partial.date.startsWith("2026-05-23"));
  assert.equal(partial.id, "swiggy:ABC123456");
  assert.equal(partial.items.length, 2);
  assert.equal(partial.items[0].name, "Paneer Butter Masala");
  assert.equal(partial.items[0].qty, 1);
  assert.equal(partial.items[0].lineTotal, 289);
  assert.equal(partial.items[1].name, "Garlic Naan");
  assert.equal(partial.items[1].qty, 2);
  assert.equal(partial.items[1].lineTotal, 99);

  const result = runExtractor(swiggyExtractor, root, { url: "https://www.swiggy.com/my-account/orders/ABC123456" });
  assert.equal(result.ok, true, result.error && result.error.message);
  assert.equal(result.receipt.merchantId, "swiggy");
  assert.equal(result.receipt.total, 487.5);
  assert.equal(result.receipt.currency, "INR");
  assert.equal(result.receipt.items.length, 2);
  assert.equal(result.receipt.id, "swiggy:ABC123456");
}

// ── no total → extractor returns null → runExtractor reports failure ─────
{
  const root = el("div", { children: [
    el("span", { attrs: { "data-test": "order-date" }, text: "23 May 2026" }),
  ]});
  assert.equal(extract(root, { url: "https://www.swiggy.com/my-account/orders/1" }), null);
  const result = runExtractor(swiggyExtractor, root, { url: "https://www.swiggy.com/my-account/orders/1" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "EMPTY_RESULT");
}

// ── matches() rejects non-swiggy + instamart URLs through runExtractor ───
{
  const root = el("div");
  const r1 = runExtractor(swiggyExtractor, root, { url: "https://www.zomato.com/orders/123" });
  assert.equal(r1.ok, false);
  assert.equal(r1.error.code, "NO_MATCH");
  const r2 = runExtractor(swiggyExtractor, root, { url: "https://www.swiggy.com/instamart/order/123" });
  assert.equal(r2.ok, false);
  assert.equal(r2.error.code, "NO_MATCH");
}

// ── extractor object shape ───────────────────────────────────────────────
assert.equal(swiggyExtractor.id, "swiggy");
assert.equal(typeof swiggyExtractor.version, "string");
assert.equal(typeof swiggyExtractor.extract, "function");
assert.equal(typeof swiggyExtractor.matches, "function");

console.log("\u2713 swiggy extractor");
