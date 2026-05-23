// Tests for src/extractors/amazon-ca.js
// Uses the same tiny DOM shim style as amazon-uk.test.mjs.
import assert from "node:assert/strict";
import amazonCaExtractor, {
  matchesAmazonCa,
  parseCad,
  parseAmazonCaDate,
  extractOrderId,
  extractItems,
  extractTotal,
  extractDate,
  extract,
} from "../../src/extractors/amazon-ca.js";
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

// ── matchesAmazonCa ──────────────────────────────────────────────────────
assert.equal(matchesAmazonCa("https://www.amazon.ca/gp/your-account/order-details?orderID=702-1234567-1234567"), true);
assert.equal(matchesAmazonCa("https://www.amazon.ca/gp/css/summary"), true);
assert.equal(matchesAmazonCa("https://www.amazon.ca/your-orders"), true);
assert.equal(matchesAmazonCa("https://www.amazon.com/gp/your-account/order-details?orderID=171"), false);
assert.equal(matchesAmazonCa("https://www.amazon.co.uk/gp/your-account/order-details?orderID=171"), false);
assert.equal(matchesAmazonCa("https://www.amazon.ca/dp/B000"), false);
assert.equal(matchesAmazonCa(null), false);
assert.equal(matchesAmazonCa("not-a-url"), false);

// ── parseCad ─────────────────────────────────────────────────────────────
assert.equal(parseCad("CDN$1,234.50"), 1234.5);
assert.equal(parseCad("$99.00"), 99);
assert.equal(parseCad("CA$12.00"), 12);
assert.equal(parseCad("Total: $0"), 0);
assert.equal(parseCad("1,500.25 CAD"), 1500.25);
assert.equal(parseCad(""), null);
assert.equal(parseCad(null), null);
assert.equal(parseCad("free"), null);

// ── parseAmazonCaDate ────────────────────────────────────────────────────
assert.ok(parseAmazonCaDate("May 23, 2026").startsWith("2026-05-23"));
assert.ok(parseAmazonCaDate("Ordered on May 23, 2026").startsWith("2026-05-23"));
assert.ok(parseAmazonCaDate("Order placed: January 1, 2026").startsWith("2026-01-01"));
assert.ok(parseAmazonCaDate("23 May 2026").startsWith("2026-05-23")); // fallback
assert.ok(parseAmazonCaDate("Sep 7, 2025").startsWith("2025-09-07"));
assert.equal(parseAmazonCaDate("not a date"), null);
assert.equal(parseAmazonCaDate(""), null);

// ── extractOrderId from URL ──────────────────────────────────────────────
assert.equal(
  extractOrderId({ querySelector: () => null }, "https://www.amazon.ca/gp/your-account/order-details?orderID=702-1234567-1234567"),
  "702-1234567-1234567",
);
{
  const doc = {
    querySelector: (sel) => sel === "bdi" ? { textContent: "Order # 703-5555555-5555555" } : null,
  };
  assert.equal(extractOrderId(doc, "https://www.amazon.ca/gp/your-account/order-details"), "703-5555555-5555555");
}

// ── full happy-path extract via the shim DOM ─────────────────────────────
{
  const root = el("div", { children: [
    el("span", { attrs: { "data-test-id": "order-date" }, text: "Ordered on May 23, 2026" }),
    el("div", { attrs: { "data-test-id": "order-total" }, text: "CDN$149.99" }),
    el("div", { attrs: { class: "yohtmlc-item" }, children: [
      el("a", { attrs: { class: "a-link-normal" }, text: "Maple Syrup" }),
      el("span", { attrs: { class: "a-color-price" }, text: "CDN$29.99" }),
      el("span", { attrs: { "data-test-id": "item-qty" }, text: "Qty: 2" }),
    ]}),
    el("div", { attrs: { class: "yohtmlc-item" }, children: [
      el("a", { attrs: { class: "a-link-normal" }, text: "Toque" }),
      el("span", { attrs: { class: "a-color-price" }, text: "$12.50" }),
    ]}),
  ]});
  const partial = extract(root, { url: "https://www.amazon.ca/gp/your-account/order-details?orderID=702-1234567-1234567" });
  assert.ok(partial, "partial returned");
  assert.equal(partial.merchantId, "amazon-ca");
  assert.equal(partial.currency, "CAD");
  assert.equal(partial.total, 149.99);
  assert.ok(partial.date.startsWith("2026-05-23"));
  assert.equal(partial.id, "amazon-ca:702-1234567-1234567");
  assert.equal(partial.items.length, 2);
  assert.equal(partial.items[0].name, "Maple Syrup");
  assert.equal(partial.items[0].qty, 2);
  assert.equal(partial.items[0].lineTotal, 29.99);
  assert.equal(partial.items[1].name, "Toque");
  assert.equal(partial.items[1].lineTotal, 12.5);

  const result = runExtractor(amazonCaExtractor, root, { url: "https://www.amazon.ca/gp/your-account/order-details?orderID=702-1234567-1234567" });
  assert.equal(result.ok, true, result.error && result.error.message);
  assert.equal(result.receipt.merchantId, "amazon-ca");
  assert.equal(result.receipt.total, 149.99);
  assert.equal(result.receipt.currency, "CAD");
  assert.equal(result.receipt.items.length, 2);
  assert.equal(result.receipt.id, "amazon-ca:702-1234567-1234567");
}

// ── no total → extractor returns null → runExtractor reports failure ─────
{
  const root = el("div", { children: [
    el("span", { attrs: { "data-test-id": "order-date" }, text: "May 23, 2026" }),
  ]});
  assert.equal(extract(root, { url: "https://www.amazon.ca/gp/your-account/order-details" }), null);
  const result = runExtractor(amazonCaExtractor, root, { url: "https://www.amazon.ca/gp/your-account/order-details" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "EMPTY_RESULT");
}

// ── matches() rejects non-amazon.ca URLs through runExtractor ────────────
{
  const root = el("div");
  const result = runExtractor(amazonCaExtractor, root, { url: "https://www.amazon.com/gp/your-account/order-details" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "NO_MATCH");
}

// ── extractor object shape ───────────────────────────────────────────────
assert.equal(amazonCaExtractor.id, "amazon-ca");
assert.equal(typeof amazonCaExtractor.version, "string");
assert.equal(typeof amazonCaExtractor.extract, "function");
assert.equal(typeof amazonCaExtractor.matches, "function");

console.log("\u2713 amazon-ca extractor");
