// Tests for src/extractors/ubereats-us.js
import assert from "node:assert/strict";
import ubereatsExtractor, {
  matchesUbereatsUs,
  parseUsd,
  parseUbereatsDate,
  extractOrderId,
  extract,
} from "../../src/extractors/ubereats-us.js";
import { runExtractor } from "../../src/extractor.js";

// ── tiny DOM shim (copied from doordash.test.mjs) ──────────────────────────
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

// ── matchesUbereatsUs ────────────────────────────────────────────────────
assert.equal(matchesUbereatsUs("https://www.ubereats.com/orders/abc-123-def"), true);
assert.equal(matchesUbereatsUs("https://www.ubereats.com/orders/abc/receipt"), true);
assert.equal(matchesUbereatsUs("https://www.ubereats.com/order/xyz789"), true);
assert.equal(matchesUbereatsUs("https://ubereats.com/orders"), true);
assert.equal(matchesUbereatsUs("https://www.ubereats.com/store/123"), false);
assert.equal(matchesUbereatsUs("https://www.ubereats.com/gb/orders/123"), false);
assert.equal(matchesUbereatsUs("https://www.ubereats.com/ca/orders/123"), false);
assert.equal(matchesUbereatsUs("https://www.doordash.com/orders/123"), false);
assert.equal(matchesUbereatsUs(null), false);
assert.equal(matchesUbereatsUs("not-a-url"), false);

// ── parseUsd ─────────────────────────────────────────────────────────────
assert.equal(parseUsd("$1,234.50"), 1234.5);
assert.equal(parseUsd("USD 99"), 99);
assert.equal(parseUsd("US$ 12.00"), 12);
assert.equal(parseUsd("Total: $0"), 0);
assert.equal(parseUsd(""), null);
assert.equal(parseUsd(null), null);
assert.equal(parseUsd("free"), null);

// ── parseUbereatsDate ────────────────────────────────────────────────────
assert.ok(parseUbereatsDate("May 23, 2026").startsWith("2026-05-23"));
assert.ok(parseUbereatsDate("Ordered May 23, 2026").startsWith("2026-05-23"));
assert.ok(parseUbereatsDate("Placed on January 1, 2026").startsWith("2026-01-01"));
assert.ok(parseUbereatsDate("Completed on Sep 7, 2025").startsWith("2025-09-07"));
assert.ok(parseUbereatsDate("23 May 2026").startsWith("2026-05-23"));
assert.equal(parseUbereatsDate("not a date"), null);
assert.equal(parseUbereatsDate(""), null);

// ── extractOrderId from URL ──────────────────────────────────────────────
assert.equal(
  extractOrderId({ querySelector: () => null }, "https://www.ubereats.com/orders/abc-123-def"),
  "abc-123-def",
);
assert.equal(
  extractOrderId({ querySelector: () => null }, "https://www.ubereats.com/order/XYZ12345"),
  "XYZ12345",
);
{
  const doc = {
    querySelector: (sel) =>
      sel === "[data-test='order-number']"
        ? { textContent: "Order # UE-A1B2C3D4" }
        : null,
  };
  assert.equal(extractOrderId(doc, "https://www.ubereats.com/orders"), "UE-A1B2C3D4");
}

// ── full happy-path extract via the shim DOM ─────────────────────────────
{
  const root = el("div", { children: [
    el("span", { attrs: { "data-test": "order-date" }, text: "Ordered May 23, 2026" }),
    el("div", { attrs: { "data-test": "order-total" }, text: "$31.20" }),
    el("div", { attrs: { "data-test": "order-item" }, children: [
      el("a", { attrs: { "data-test": "product-title" }, text: "Carnitas Burrito" }),
      el("span", { attrs: { "data-test": "line-price" }, text: "$14.25" }),
      el("span", { attrs: { "data-test": "item-qty" }, text: "Qty 1" }),
    ]}),
    el("div", { attrs: { "data-test": "order-item" }, children: [
      el("a", { attrs: { "data-test": "product-title" }, text: "Chips & Guac" }),
      el("span", { attrs: { "data-test": "line-price" }, text: "$5.49" }),
      el("span", { attrs: { "data-test": "item-qty" }, text: "Qty 2" }),
    ]}),
  ]});
  const partial = extract(root, { url: "https://www.ubereats.com/orders/abc-123-def" });
  assert.ok(partial, "partial returned");
  assert.equal(partial.merchantId, "ubereats-us");
  assert.equal(partial.currency, "USD");
  assert.equal(partial.total, 31.20);
  assert.ok(partial.date.startsWith("2026-05-23"));
  assert.equal(partial.id, "ubereats-us:abc-123-def");
  assert.equal(partial.items.length, 2);
  assert.equal(partial.items[0].name, "Carnitas Burrito");
  assert.equal(partial.items[0].qty, 1);
  assert.equal(partial.items[0].lineTotal, 14.25);
  assert.equal(partial.items[1].name, "Chips & Guac");
  assert.equal(partial.items[1].qty, 2);
  assert.equal(partial.items[1].lineTotal, 5.49);

  const result = runExtractor(ubereatsExtractor, root, { url: "https://www.ubereats.com/orders/abc-123-def" });
  assert.equal(result.ok, true, result.error && result.error.message);
  assert.equal(result.receipt.merchantId, "ubereats-us");
  assert.equal(result.receipt.total, 31.20);
  assert.equal(result.receipt.currency, "USD");
  assert.equal(result.receipt.items.length, 2);
  assert.equal(result.receipt.id, "ubereats-us:abc-123-def");
}

// ── no total → extractor returns null → runExtractor reports failure ─────
{
  const root = el("div", { children: [
    el("span", { attrs: { "data-test": "order-date" }, text: "May 23, 2026" }),
  ]});
  assert.equal(extract(root, { url: "https://www.ubereats.com/orders/1" }), null);
  const result = runExtractor(ubereatsExtractor, root, { url: "https://www.ubereats.com/orders/1" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "EMPTY_RESULT");
}

// ── matches() rejects non-ubereats / non-US URLs through runExtractor ────
{
  const root = el("div");
  const result = runExtractor(ubereatsExtractor, root, { url: "https://www.doordash.com/orders/123" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "NO_MATCH");
  const resultGb = runExtractor(ubereatsExtractor, root, { url: "https://www.ubereats.com/gb/orders/123" });
  assert.equal(resultGb.ok, false);
  assert.equal(resultGb.error.code, "NO_MATCH");
}

// ── extractor object shape ───────────────────────────────────────────────
assert.equal(ubereatsExtractor.id, "ubereats-us");
assert.equal(typeof ubereatsExtractor.version, "string");
assert.equal(typeof ubereatsExtractor.extract, "function");
assert.equal(typeof ubereatsExtractor.matches, "function");

console.log("\u2713 ubereats-us extractor");
