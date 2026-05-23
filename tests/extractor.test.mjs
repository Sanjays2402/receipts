// Tests for src/extractor.js
import assert from "node:assert/strict";
import {
  ExtractorError,
  validateExtractor,
  normalizeReceipt,
  runExtractor,
  toIsoDate,
  createExtractorRegistry,
  makeStubExtractor,
} from "../src/extractor.js";

// ── validateExtractor ───────────────────────────────────────────────────────
assert.throws(() => validateExtractor(null), ExtractorError);
assert.throws(() => validateExtractor({}), ExtractorError);
assert.throws(() => validateExtractor({ id: "amazon-us" }), ExtractorError);
assert.throws(
  () => validateExtractor({ id: "not-a-merchant", extract: () => null }),
  /not in merchants registry/,
);
assert.equal(
  validateExtractor({ id: "amazon-us", extract: () => null }),
  true,
);

// ── toIsoDate ──────────────────────────────────────────────────────────────
assert.equal(toIsoDate(null), null);
assert.equal(toIsoDate(""), null);
assert.equal(toIsoDate("not a date"), null);
assert.ok(toIsoDate("2026-05-23").startsWith("2026-05-23"));
assert.ok(toIsoDate("23/05/2026").startsWith("2026-05-23"));
assert.ok(toIsoDate("23-05-26").startsWith("2026-05-23"));
assert.ok(toIsoDate(new Date("2026-01-01")).startsWith("2026-01-01"));

// ── normalizeReceipt: rejects bad input ─────────────────────────────────────
assert.throws(() => normalizeReceipt(null), ExtractorError);
assert.throws(
  () => normalizeReceipt({ merchantId: "amazon-us", total: -1, currency: "USD" }),
  /total/,
);
assert.throws(
  () => normalizeReceipt({ merchantId: "amazon-us", total: 10, currency: "XXX" }),
  /currency/,
);
assert.throws(
  () => normalizeReceipt({ merchantId: "fake-merchant", total: 10, currency: "USD" }),
  /merchantId/,
);

// ── normalizeReceipt: happy path ────────────────────────────────────────────
const r = normalizeReceipt({
  id: "ABC-123",
  merchantId: "amazon-us",
  date: "2026-05-23",
  total: 42.5,
  currency: "usd",
  items: [
    { name: "Widget", qty: 2, unitPrice: 10.0, lineTotal: 20.0 },
    { name: "  ", qty: 1 }, // dropped — blank name
    { name: "Gadget", lineTotal: 22.5, sku: "SKU-9" },
    null, // dropped
  ],
  raw: { html: "<x>" },
});
assert.equal(r.id, "ABC-123");
assert.equal(r.merchantId, "amazon-us");
assert.equal(r.currency, "USD");
assert.equal(r.total, 42.5);
assert.ok(r.date.startsWith("2026-05-23"));
assert.equal(r.items.length, 2);
assert.equal(r.items[0].name, "Widget");
assert.equal(r.items[1].sku, "SKU-9");
assert.equal(r.raw.html, "<x>");

// id synthesized when missing
const r2 = normalizeReceipt({
  merchantId: "doordash",
  total: 0,
  currency: "USD",
});
assert.ok(r2.id.startsWith("doordash:"));
assert.equal(r2.items.length, 0);
assert.ok(r2.date); // filled with now

// ── runExtractor ───────────────────────────────────────────────────────────
const stubDoc = {};
const goodExtractor = {
  id: "doordash",
  version: "1.0.0",
  matches: (url) => url.includes("/orders/"),
  extract: () => ({
    id: "order-7",
    date: "2026-05-22T18:00:00Z",
    total: 23.45,
    currency: "USD",
    items: [{ name: "Burrito", qty: 1, lineTotal: 23.45 }],
    raw: { source: "test" },
  }),
};

const okResult = runExtractor(goodExtractor, stubDoc, { url: "https://www.doordash.com/orders/7" });
assert.equal(okResult.ok, true);
assert.equal(okResult.receipt.merchantId, "doordash");
assert.equal(okResult.receipt.total, 23.45);
assert.equal(okResult.receipt.raw.url, "https://www.doordash.com/orders/7");

const noMatch = runExtractor(goodExtractor, stubDoc, { url: "https://www.doordash.com/" });
assert.equal(noMatch.ok, false);
assert.equal(noMatch.error.code, "NO_MATCH");

// Throwing extract should be caught
const throwy = {
  id: "amazon-us",
  extract: () => { throw new Error("kaboom"); },
};
const threw = runExtractor(throwy, stubDoc, { url: "https://www.amazon.com/" });
assert.equal(threw.ok, false);
assert.equal(threw.error.code, "EXTRACT_THREW");

// Null result is failure
const nully = { id: "amazon-us", extract: () => null };
const nullRes = runExtractor(nully, stubDoc, { url: "https://www.amazon.com/" });
assert.equal(nullRes.ok, false);
assert.equal(nullRes.error.code, "EMPTY_RESULT");

// Bad currency from extractor → failure (not crash)
const badCur = {
  id: "flipkart",
  extract: () => ({ total: 100, currency: "XXX" }),
};
const badCurRes = runExtractor(badCur, stubDoc, {});
assert.equal(badCurRes.ok, false);
assert.equal(badCurRes.error.code, "BAD_CURRENCY");

// ── registry ───────────────────────────────────────────────────────────────
const reg = createExtractorRegistry();
reg.register(makeStubExtractor("amazon-us"));
reg.register(makeStubExtractor("doordash"));
assert.equal(reg.size(), 2);
assert.equal(reg.get("amazon-us").id, "amazon-us");
assert.equal(reg.get("nope"), null);
assert.throws(() => reg.register({ id: "nope", extract: () => null }), ExtractorError);
assert.equal(reg.unregister("amazon-us"), true);
assert.equal(reg.size(), 1);

console.log("\u2713 extractor tests ok");
