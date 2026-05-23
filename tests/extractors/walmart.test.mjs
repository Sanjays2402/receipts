// Tests for src/extractors/walmart.js
// Uses the same tiny DOM shim style as amazon-us.test.mjs.
import assert from "node:assert/strict";
import walmartExtractor, {
  matchesWalmart,
  parseUsd,
  parseWalmartDate,
  extractOrderId,
  extractItems,
  extractTotal,
  extractDate,
  extract,
} from "../../src/extractors/walmart.js";
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

// ── matchesWalmart ───────────────────────────────────────────────────────
assert.equal(matchesWalmart("https://www.walmart.com/orders/200012345678901"), true);
assert.equal(matchesWalmart("https://www.walmart.com/orders"), true);
assert.equal(matchesWalmart("https://walmart.com/orders/abc"), true);
assert.equal(matchesWalmart("https://www.walmart.ca/orders/123"), false);
assert.equal(matchesWalmart("https://www.walmart.com/ip/some-item"), false);
assert.equal(matchesWalmart(null), false);
assert.equal(matchesWalmart("not-a-url"), false);

// ── parseUsd ─────────────────────────────────────────────────────────────
assert.equal(parseUsd("$1,234.50"), 1234.5);
assert.equal(parseUsd("USD 99"), 99);
assert.equal(parseUsd("US$ 12.00"), 12);
assert.equal(parseUsd("Total: $0"), 0);
assert.equal(parseUsd(""), null);
assert.equal(parseUsd(null), null);
assert.equal(parseUsd("free"), null);

// ── parseWalmartDate ─────────────────────────────────────────────────────
assert.ok(parseWalmartDate("May 23, 2026").startsWith("2026-05-23"));
assert.ok(parseWalmartDate("Ordered May 23, 2026").startsWith("2026-05-23"));
assert.ok(parseWalmartDate("Ordered on January 1, 2026").startsWith("2026-01-01"));
assert.ok(parseWalmartDate("Sep 7, 2025").startsWith("2025-09-07"));
assert.ok(parseWalmartDate("23 May 2026").startsWith("2026-05-23"));
assert.equal(parseWalmartDate("not a date"), null);
assert.equal(parseWalmartDate(""), null);

// ── extractOrderId from URL ──────────────────────────────────────────────
assert.equal(
  extractOrderId({ querySelector: () => null }, "https://www.walmart.com/orders/200012345678901"),
  "200012345678901",
);
{
  const doc = {
    querySelector: (sel) =>
      sel === "[data-testid='order-number']"
        ? { textContent: "Order # 200099887766554" }
        : null,
  };
  assert.equal(extractOrderId(doc, "https://www.walmart.com/orders"), "200099887766554");
}

// ── full happy-path extract via the shim DOM ─────────────────────────────
{
  const root = el("div", { children: [
    el("span", { attrs: { "data-testid": "order-date" }, text: "Ordered May 23, 2026" }),
    el("div", { attrs: { "data-testid": "order-total" }, text: "$87.45" }),
    el("div", { attrs: { "data-testid": "order-item" }, children: [
      el("a", { attrs: { "data-testid": "product-title" }, text: "Great Value 2% Milk" }),
      el("span", { attrs: { "data-testid": "line-price" }, text: "$3.98" }),
      el("span", { attrs: { "data-testid": "item-qty" }, text: "Qty 2" }),
    ]}),
    el("div", { attrs: { "data-testid": "order-item" }, children: [
      el("a", { attrs: { "data-testid": "product-title" }, text: "Bananas, 3 lb" }),
      el("span", { attrs: { "data-testid": "line-price" }, text: "$1.74" }),
    ]}),
  ]});
  const partial = extract(root, { url: "https://www.walmart.com/orders/200012345678901" });
  assert.ok(partial, "partial returned");
  assert.equal(partial.merchantId, "walmart");
  assert.equal(partial.currency, "USD");
  assert.equal(partial.total, 87.45);
  assert.ok(partial.date.startsWith("2026-05-23"));
  assert.equal(partial.id, "walmart:200012345678901");
  assert.equal(partial.items.length, 2);
  assert.equal(partial.items[0].name, "Great Value 2% Milk");
  assert.equal(partial.items[0].qty, 2);
  assert.equal(partial.items[0].lineTotal, 3.98);
  assert.equal(partial.items[1].name, "Bananas, 3 lb");
  assert.equal(partial.items[1].lineTotal, 1.74);

  const result = runExtractor(walmartExtractor, root, { url: "https://www.walmart.com/orders/200012345678901" });
  assert.equal(result.ok, true, result.error && result.error.message);
  assert.equal(result.receipt.merchantId, "walmart");
  assert.equal(result.receipt.total, 87.45);
  assert.equal(result.receipt.currency, "USD");
  assert.equal(result.receipt.items.length, 2);
  assert.equal(result.receipt.id, "walmart:200012345678901");
}

// ── no total → extractor returns null → runExtractor reports failure ─────
{
  const root = el("div", { children: [
    el("span", { attrs: { "data-testid": "order-date" }, text: "May 23, 2026" }),
  ]});
  assert.equal(extract(root, { url: "https://www.walmart.com/orders/1" }), null);
  const result = runExtractor(walmartExtractor, root, { url: "https://www.walmart.com/orders/1" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "EMPTY_RESULT");
}

// ── matches() rejects non-walmart URLs through runExtractor ──────────────
{
  const root = el("div");
  const result = runExtractor(walmartExtractor, root, { url: "https://www.walmart.ca/orders/123" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "NO_MATCH");
}

// ── extractor object shape ───────────────────────────────────────────────
assert.equal(walmartExtractor.id, "walmart");
assert.equal(typeof walmartExtractor.version, "string");
assert.equal(typeof walmartExtractor.extract, "function");
assert.equal(typeof walmartExtractor.matches, "function");

console.log("\u2713 walmart extractor");
