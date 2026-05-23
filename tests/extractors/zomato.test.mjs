// Tests for src/extractors/zomato.js
import assert from "node:assert/strict";
import zomatoExtractor, {
  matchesZomato,
  parseInr,
  parseZomatoDate,
  extractOrderId,
  extract,
} from "../../src/extractors/zomato.js";
import { runExtractor } from "../../src/extractor.js";

// ── tiny DOM shim (same as swiggy.test) ──────────────────────────────────
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

// ── matchesZomato ────────────────────────────────────────────────────────
assert.equal(matchesZomato("https://www.zomato.com/users/sanjay/orders"), true);
assert.equal(matchesZomato("https://www.zomato.com/users/sanjay/orders/ABC123456"), true);
assert.equal(matchesZomato("https://www.zomato.com/orders/ABC123456"), true);
assert.equal(matchesZomato("https://www.zomato.com/order/XYZ12345"), true);
assert.equal(matchesZomato("https://zomato.com/orders"), true);
assert.equal(matchesZomato("https://www.zomato.com/bangalore/restaurants"), false);
assert.equal(matchesZomato("https://www.swiggy.com/order/123"), false);
assert.equal(matchesZomato(null), false);
assert.equal(matchesZomato("not-a-url"), false);

// ── parseInr ─────────────────────────────────────────────────────────────
assert.equal(parseInr("₹1,234.50"), 1234.5);
assert.equal(parseInr("Rs. 1,234"), 1234);
assert.equal(parseInr("INR 99"), 99);
assert.equal(parseInr("Total: ₹0"), 0);
assert.equal(parseInr(""), null);
assert.equal(parseInr(null), null);
assert.equal(parseInr("free"), null);

// ── parseZomatoDate ──────────────────────────────────────────────────────
assert.ok(parseZomatoDate("23 May, 2026").startsWith("2026-05-23"));
assert.ok(parseZomatoDate("Order placed on 23 May 2026").startsWith("2026-05-23"));
assert.ok(parseZomatoDate("Placed on 1 January, 2026").startsWith("2026-01-01"));
assert.ok(parseZomatoDate("May 23, 2026").startsWith("2026-05-23"));
assert.ok(parseZomatoDate("Sep 7, 2025").startsWith("2025-09-07"));
assert.equal(parseZomatoDate("not a date"), null);
assert.equal(parseZomatoDate(""), null);

// ── extractOrderId from URL ──────────────────────────────────────────────
assert.equal(
  extractOrderId({ querySelector: () => null }, "https://www.zomato.com/users/sanjay/orders/ABC123456"),
  "ABC123456",
);
assert.equal(
  extractOrderId({ querySelector: () => null }, "https://www.zomato.com/orders/XYZ12345"),
  "XYZ12345",
);
assert.equal(
  extractOrderId({ querySelector: () => null }, "https://www.zomato.com/order/QRS98765"),
  "QRS98765",
);
{
  const doc = {
    querySelector: (sel) =>
      sel === "[data-test='order-number']"
        ? { textContent: "Order #ZO-A1B2C3D4" }
        : null,
  };
  assert.equal(extractOrderId(doc, "https://www.zomato.com/users/sanjay/orders"), "ZO-A1B2C3D4");
}

// ── full happy-path extract ──────────────────────────────────────────────
{
  const root = el("div", { children: [
    el("span", { attrs: { "data-test": "order-date" }, text: "Order placed on 23 May 2026" }),
    el("div", { attrs: { "data-test": "order-total" }, text: "₹612.00" }),
    el("div", { attrs: { "data-test": "order-item" }, children: [
      el("a", { attrs: { "data-test": "product-title" }, text: "Chicken Biryani" }),
      el("span", { attrs: { "data-test": "line-price" }, text: "₹349.00" }),
      el("span", { attrs: { "data-test": "item-qty" }, text: "Qty 1" }),
    ]}),
    el("div", { attrs: { "data-test": "order-item" }, children: [
      el("a", { attrs: { "data-test": "product-title" }, text: "Tandoori Roti" }),
      el("span", { attrs: { "data-test": "line-price" }, text: "₹40.00" }),
      el("span", { attrs: { "data-test": "item-qty" }, text: "Qty 3" }),
    ]}),
  ]});
  const partial = extract(root, { url: "https://www.zomato.com/users/sanjay/orders/ABC123456" });
  assert.ok(partial, "partial returned");
  assert.equal(partial.merchantId, "zomato");
  assert.equal(partial.currency, "INR");
  assert.equal(partial.total, 612);
  assert.ok(partial.date.startsWith("2026-05-23"));
  assert.equal(partial.id, "zomato:ABC123456");
  assert.equal(partial.items.length, 2);
  assert.equal(partial.items[0].name, "Chicken Biryani");
  assert.equal(partial.items[0].qty, 1);
  assert.equal(partial.items[0].lineTotal, 349);
  assert.equal(partial.items[1].name, "Tandoori Roti");
  assert.equal(partial.items[1].qty, 3);
  assert.equal(partial.items[1].lineTotal, 40);

  const result = runExtractor(zomatoExtractor, root, { url: "https://www.zomato.com/users/sanjay/orders/ABC123456" });
  assert.equal(result.ok, true, result.error && result.error.message);
  assert.equal(result.receipt.merchantId, "zomato");
  assert.equal(result.receipt.total, 612);
  assert.equal(result.receipt.currency, "INR");
  assert.equal(result.receipt.items.length, 2);
  assert.equal(result.receipt.id, "zomato:ABC123456");
}

// ── no total → null + EMPTY_RESULT ───────────────────────────────────────
{
  const root = el("div", { children: [
    el("span", { attrs: { "data-test": "order-date" }, text: "23 May 2026" }),
  ]});
  assert.equal(extract(root, { url: "https://www.zomato.com/orders/1" }), null);
  const result = runExtractor(zomatoExtractor, root, { url: "https://www.zomato.com/orders/1" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "EMPTY_RESULT");
}

// ── matches() rejects non-zomato URLs through runExtractor ───────────────
{
  const root = el("div");
  const r1 = runExtractor(zomatoExtractor, root, { url: "https://www.swiggy.com/order/123" });
  assert.equal(r1.ok, false);
  assert.equal(r1.error.code, "NO_MATCH");
  const r2 = runExtractor(zomatoExtractor, root, { url: "https://www.zomato.com/bangalore/restaurants" });
  assert.equal(r2.ok, false);
  assert.equal(r2.error.code, "NO_MATCH");
}

// ── extractor object shape ───────────────────────────────────────────────
assert.equal(zomatoExtractor.id, "zomato");
assert.equal(typeof zomatoExtractor.version, "string");
assert.equal(typeof zomatoExtractor.extract, "function");
assert.equal(typeof zomatoExtractor.matches, "function");

console.log("\u2713 zomato extractor");
