// Tests for src/site-detect.js
import assert from "node:assert/strict";
import {
  patternToRegex,
  matchesMerchant,
  isOrderUrl,
  detectMerchant,
  buildIndex,
  detectMerchantIndexed
} from "../src/site-detect.js";
import { MERCHANTS, MERCHANTS_BY_ID } from "../src/merchants.js";

// patternToRegex basics
assert.ok(patternToRegex("https://www.amazon.in/*").test("https://www.amazon.in/anything"));
assert.ok(!patternToRegex("https://www.amazon.in/*").test("https://www.amazon.com/x"));
assert.ok(patternToRegex("https://www.nike.com/in/*").test("https://www.nike.com/in/orders"));
assert.ok(!patternToRegex("https://www.nike.com/in/*").test("https://www.nike.com/orders"));

// matchesMerchant
const amazonIn = MERCHANTS_BY_ID["amazon-in"];
assert.ok(matchesMerchant("https://www.amazon.in/gp/your-account/order-details?orderID=123", amazonIn));
assert.ok(!matchesMerchant("https://www.amazon.com/", amazonIn));

// isOrderUrl
assert.ok(isOrderUrl("https://www.amazon.in/gp/your-account/order-details?orderID=123", amazonIn));
assert.ok(!isOrderUrl("https://www.amazon.in/", amazonIn));

// detectMerchant — direct host
const r1 = detectMerchant("https://www.flipkart.com/account/orders", MERCHANTS);
assert.equal(r1.merchant?.id, "flipkart");
assert.equal(r1.isOrderUrl, true);

// detectMerchant — no match
const r2 = detectMerchant("https://example.org/", MERCHANTS);
assert.equal(r2.merchant, null);
assert.equal(r2.isOrderUrl, false);

// detectMerchant — bad URL
const r3 = detectMerchant("not a url", MERCHANTS);
assert.equal(r3.merchant, null);

// detectMerchant — longest path prefix wins (Nike India scoped to /in/)
const r4 = detectMerchant("https://www.nike.com/in/something", MERCHANTS);
assert.equal(r4.merchant?.id, "nike-in");

// detectMerchant — host match but not order page
const r5 = detectMerchant("https://www.amazon.in/dp/B00ABCDEFG", MERCHANTS);
assert.equal(r5.merchant?.id, "amazon-in");
assert.equal(r5.isOrderUrl, false);

// indexed variant matches the same as the slow one
const idx = buildIndex(MERCHANTS);
const urls = [
  "https://www.amazon.in/gp/your-account/order-details?orderID=1",
  "https://www.amazon.com/gp/your-account/order-details?orderID=1",
  "https://www.flipkart.com/account/orders",
  "https://www.nike.com/in/orders",
  "https://www.doordash.com/orders",
  "https://www.swiggy.com/my-account/orders",
  "https://example.org/"
];
for (const u of urls) {
  const a = detectMerchant(u, MERCHANTS);
  const b = detectMerchantIndexed(u, idx);
  assert.equal(b.merchant?.id ?? null, a.merchant?.id ?? null, `indexed mismatch for ${u}`);
  assert.equal(b.isOrderUrl, a.isOrderUrl, `isOrderUrl mismatch for ${u}`);
}

// Every merchant in the registry must be detectable from a sample URL
// built off its own hostPattern.
let detectFails = 0;
for (const m of MERCHANTS) {
  const sample = m.hostPattern.replace(/\*$/, "test");
  const d = detectMerchantIndexed(sample, idx);
  if (!d.merchant) {
    detectFails++;
    if (detectFails <= 3) console.error("undetected merchant:", m.id, sample);
  }
}
assert.equal(detectFails, 0, `${detectFails} merchants failed self-detection`);

console.log("\u2713 site-detect tests ok");
