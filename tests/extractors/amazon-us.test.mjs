// Tests for src/extractors/amazon-us.js
// Uses the same tiny DOM shim style as amazon-in.test.mjs.
import assert from "node:assert/strict";
import amazonUsExtractor, {
  matchesAmazonUs,
  parseUsd,
  parseAmazonUsDate,
  extractOrderId,
  extractItems,
  extractTotal,
  extractDate,
  extract,
} from "../../src/extractors/amazon-us.js";
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

// ── matchesAmazonUs ──────────────────────────────────────────────────────
assert.equal(matchesAmazonUs("https://www.amazon.com/gp/your-account/order-details?orderID=112-1234567-1234567"), true);
assert.equal(matchesAmazonUs("https://www.amazon.com/gp/css/summary"), true);
assert.equal(matchesAmazonUs("https://www.amazon.com/your-orders"), true);
assert.equal(matchesAmazonUs("https://www.amazon.in/gp/your-account/order-details?orderID=171"), false);
assert.equal(matchesAmazonUs("https://www.amazon.com/dp/B000"), false);
assert.equal(matchesAmazonUs(null), false);
assert.equal(matchesAmazonUs("not-a-url"), false);

// ── parseUsd ─────────────────────────────────────────────────────────────
assert.equal(parseUsd("$1,234.50"), 1234.5);
assert.equal(parseUsd("USD 99"), 99);
assert.equal(parseUsd("US$ 12.00"), 12);
assert.equal(parseUsd("Total: $0"), 0);
assert.equal(parseUsd(""), null);
assert.equal(parseUsd(null), null);
assert.equal(parseUsd("free"), null);

// ── parseAmazonUsDate ────────────────────────────────────────────────────
assert.ok(parseAmazonUsDate("May 23, 2026").startsWith("2026-05-23"));
assert.ok(parseAmazonUsDate("Ordered on May 23, 2026").startsWith("2026-05-23"));
assert.ok(parseAmazonUsDate("Order placed: January 1, 2026").startsWith("2026-01-01"));
assert.ok(parseAmazonUsDate("Sep 7, 2025").startsWith("2025-09-07"));
assert.ok(parseAmazonUsDate("23 May 2026").startsWith("2026-05-23")); // tolerant fallback
assert.equal(parseAmazonUsDate("not a date"), null);
assert.equal(parseAmazonUsDate(""), null);

// ── extractOrderId from URL ──────────────────────────────────────────────
assert.equal(
  extractOrderId({ querySelector: () => null }, "https://www.amazon.com/gp/your-account/order-details?orderID=112-1234567-1234567"),
  "112-1234567-1234567",
);
{
  const doc = {
    querySelector: (sel) => sel === "bdi" ? { textContent: "Order # 113-5555555-5555555" } : null,
  };
  assert.equal(extractOrderId(doc, "https://www.amazon.com/gp/your-account/order-details"), "113-5555555-5555555");
}

// ── full happy-path extract via the shim DOM ─────────────────────────────
{
  const root = el("div", { children: [
    el("span", { attrs: { "data-test-id": "order-date" }, text: "Ordered on May 23, 2026" }),
    el("div", { attrs: { "data-test-id": "order-total" }, text: "$249.99" }),
    el("div", { attrs: { class: "yohtmlc-item" }, children: [
      el("a", { attrs: { class: "a-link-normal" }, text: "Wireless Mouse" }),
      el("span", { attrs: { class: "a-color-price" }, text: "$19.99" }),
      el("span", { attrs: { "data-test-id": "item-qty" }, text: "Qty: 2" }),
    ]}),
    el("div", { attrs: { class: "yohtmlc-item" }, children: [
      el("a", { attrs: { class: "a-link-normal" }, text: "USB-C Cable" }),
      el("span", { attrs: { class: "a-color-price" }, text: "$8.50" }),
    ]}),
  ]});
  const partial = extract(root, { url: "https://www.amazon.com/gp/your-account/order-details?orderID=112-1234567-1234567" });
  assert.ok(partial, "partial returned");
  assert.equal(partial.merchantId, "amazon-us");
  assert.equal(partial.currency, "USD");
  assert.equal(partial.total, 249.99);
  assert.ok(partial.date.startsWith("2026-05-23"));
  assert.equal(partial.id, "amazon-us:112-1234567-1234567");
  assert.equal(partial.items.length, 2);
  assert.equal(partial.items[0].name, "Wireless Mouse");
  assert.equal(partial.items[0].qty, 2);
  assert.equal(partial.items[0].lineTotal, 19.99);
  assert.equal(partial.items[1].name, "USB-C Cable");
  assert.equal(partial.items[1].lineTotal, 8.5);

  const result = runExtractor(amazonUsExtractor, root, { url: "https://www.amazon.com/gp/your-account/order-details?orderID=112-1234567-1234567" });
  assert.equal(result.ok, true, result.error && result.error.message);
  assert.equal(result.receipt.merchantId, "amazon-us");
  assert.equal(result.receipt.total, 249.99);
  assert.equal(result.receipt.currency, "USD");
  assert.equal(result.receipt.items.length, 2);
  assert.equal(result.receipt.id, "amazon-us:112-1234567-1234567");
}

// ── no total → extractor returns null → runExtractor reports failure ─────
{
  const root = el("div", { children: [
    el("span", { attrs: { "data-test-id": "order-date" }, text: "May 23, 2026" }),
  ]});
  assert.equal(extract(root, { url: "https://www.amazon.com/gp/your-account/order-details" }), null);
  const result = runExtractor(amazonUsExtractor, root, { url: "https://www.amazon.com/gp/your-account/order-details" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "EMPTY_RESULT");
}

// ── matches() rejects non-amazon.com URLs through runExtractor ───────────
{
  const root = el("div");
  const result = runExtractor(amazonUsExtractor, root, { url: "https://www.amazon.in/gp/your-account/order-details" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "NO_MATCH");
}

// ── extractor object shape ───────────────────────────────────────────────
assert.equal(amazonUsExtractor.id, "amazon-us");
assert.equal(typeof amazonUsExtractor.version, "string");
assert.equal(typeof amazonUsExtractor.extract, "function");
assert.equal(typeof amazonUsExtractor.matches, "function");

console.log("\u2713 amazon-us extractor");
