// Tests for src/extractors/zepto.js
import assert from "node:assert/strict";
import zeptoExtractor, {
  matchesZepto,
  parseInr,
  parseZeptoDate,
  extractOrderId,
  extractItems,
  extractTotal,
  extractDate,
  extract,
} from "../../src/extractors/zepto.js";
import { runExtractor } from "../../src/extractor.js";

// ── tiny DOM shim (mirrors blinkit test) ─────────────────────────────────
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

// ── matchesZepto ─────────────────────────────────────────────────────────
assert.equal(matchesZepto("https://www.zeptonow.com/profile/orders"), true);
assert.equal(matchesZepto("https://www.zeptonow.com/profile/orders/ZP12345678"), true);
assert.equal(matchesZepto("https://www.zeptonow.com/order/ZP12345678"), true);
assert.equal(matchesZepto("https://zeptonow.com/profile/orders"), true);
assert.equal(matchesZepto("https://www.zeptonow.com/pn/some-product"), false);
assert.equal(matchesZepto("https://blinkit.com/account/orders"), false);
assert.equal(matchesZepto(null), false);
assert.equal(matchesZepto("not-a-url"), false);

// ── parseInr ─────────────────────────────────────────────────────────────
assert.equal(parseInr("₹1,234.50"), 1234.5);
assert.equal(parseInr("Rs. 99"), 99);
assert.equal(parseInr("INR 2,000"), 2000);
assert.equal(parseInr("Total: ₹0"), 0);
assert.equal(parseInr(""), null);
assert.equal(parseInr(null), null);
assert.equal(parseInr("free"), null);

// ── parseZeptoDate ───────────────────────────────────────────────────────
assert.ok(parseZeptoDate("23 May 2026").startsWith("2026-05-23"));
assert.ok(parseZeptoDate("Placed on 1 January 2026").startsWith("2026-01-01"));
assert.ok(parseZeptoDate("Delivered on 23rd May 2026").startsWith("2026-05-23"));
assert.ok(parseZeptoDate("23-May-2026").startsWith("2026-05-23"));
assert.ok(parseZeptoDate("2026-05-23").startsWith("2026-05-23"));
assert.ok(parseZeptoDate("23/05/2026").startsWith("2026-05-23"));
assert.equal(parseZeptoDate("not a date"), null);
assert.equal(parseZeptoDate(""), null);

// ── extractOrderId from URL path ─────────────────────────────────────────
assert.equal(
  extractOrderId({ querySelector: () => null }, "https://www.zeptonow.com/profile/orders/ZP12345678"),
  "ZP12345678",
);
assert.equal(
  extractOrderId({ querySelector: () => null }, "https://www.zeptonow.com/order/ZP98765432"),
  "ZP98765432",
);
// from DOM text when missing from URL
{
  const doc = {
    querySelector: (sel) => sel === "body"
      ? { textContent: "Order ID: ZP202605239876 delivered today" }
      : null,
  };
  assert.equal(extractOrderId(doc, "https://www.zeptonow.com/profile/orders"), "ZP202605239876");
}

// ── full happy-path extract via the shim DOM ─────────────────────────────
{
  const root = el("div", { children: [
    el("span", { attrs: { "data-test-id": "order-date" }, text: "Delivered on 23rd May 2026" }),
    el("div", { attrs: { "data-test-id": "order-total" }, text: "₹325.00" }),
    el("div", { attrs: { "data-test-id": "order-item" }, children: [
      el("a", { attrs: { "data-test-id": "item-title" }, text: "Amul Gold Milk 1L" }),
      el("span", { attrs: { "data-test-id": "item-price" }, text: "₹70.00" }),
      el("span", { attrs: { "data-test-id": "item-qty" }, text: "Qty: 3" }),
    ]}),
    el("div", { attrs: { "data-test-id": "order-item" }, children: [
      el("a", { attrs: { "data-test-id": "item-title" }, text: "Maggi Noodles 70g" }),
      el("span", { attrs: { "data-test-id": "item-price" }, text: "₹14.00" }),
      el("span", { attrs: { "data-test-id": "item-qty" }, text: "Qty: 5" }),
    ]}),
  ]});
  const url = "https://www.zeptonow.com/profile/orders/ZP12345678";
  const partial = extract(root, { url });
  assert.ok(partial, "partial returned");
  assert.equal(partial.merchantId, "zepto");
  assert.equal(partial.currency, "INR");
  assert.equal(partial.total, 325);
  assert.ok(partial.date.startsWith("2026-05-23"));
  assert.equal(partial.id, "zepto:ZP12345678");
  assert.equal(partial.items.length, 2);
  assert.equal(partial.items[0].name, "Amul Gold Milk 1L");
  assert.equal(partial.items[0].qty, 3);
  assert.equal(partial.items[0].lineTotal, 70);
  assert.equal(partial.items[1].name, "Maggi Noodles 70g");
  assert.equal(partial.items[1].qty, 5);
  assert.equal(partial.items[1].lineTotal, 14);

  const result = runExtractor(zeptoExtractor, root, { url });
  assert.equal(result.ok, true, result.error && result.error.message);
  assert.equal(result.receipt.merchantId, "zepto");
  assert.equal(result.receipt.total, 325);
  assert.equal(result.receipt.currency, "INR");
  assert.equal(result.receipt.items.length, 2);
  assert.equal(result.receipt.id, "zepto:ZP12345678");
}

// ── grand-total fallback via summary rows ────────────────────────────────
{
  const root = el("div", { children: [
    el("li", { attrs: { class: "summary-row" }, text: "Subtotal ₹300.00" }),
    el("li", { attrs: { class: "summary-row" }, text: "You Paid ₹325.00" }),
  ]});
  assert.equal(extractTotal(root), 325);
}

// ── no total → extractor returns null → runExtractor reports failure ─────
{
  const root = el("div", { children: [
    el("span", { attrs: { "data-test-id": "order-date" }, text: "23 May 2026" }),
  ]});
  assert.equal(extract(root, { url: "https://www.zeptonow.com/profile/orders" }), null);
  const result = runExtractor(zeptoExtractor, root, { url: "https://www.zeptonow.com/profile/orders" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "EMPTY_RESULT");
}

// ── matches() rejects non-zepto URLs through runExtractor ────────────────
{
  const root = el("div");
  const result = runExtractor(zeptoExtractor, root, { url: "https://blinkit.com/account/orders" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "NO_MATCH");
}

// ── extractor object shape ───────────────────────────────────────────────
assert.equal(zeptoExtractor.id, "zepto");
assert.equal(typeof zeptoExtractor.version, "string");
assert.equal(typeof zeptoExtractor.extract, "function");
assert.equal(typeof zeptoExtractor.matches, "function");

console.log("\u2713 zepto extractor");
