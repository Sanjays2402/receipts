// Tests for src/popup-filters.js
import assert from "node:assert/strict";
import {
  buildFilterOptions,
  buildStoreFilter,
  normalizeDateInput,
  isFilterActive,
} from "../src/popup-filters.js";

const sample = [
  { id: "a", merchantId: "amazon-us", currency: "usd", date: "2026-01-01T00:00:00.000Z", total: 10 },
  { id: "b", merchantId: "amazon-in", currency: "INR", date: "2026-02-01T00:00:00.000Z", total: 500 },
  { id: "c", merchantId: "flipkart",  currency: "INR", date: "2026-03-01T00:00:00.000Z", total: 1200 },
  { id: "d", merchantId: "doordash",  currency: "USD", date: "2026-04-01T00:00:00.000Z", total: 42 },
  { id: "e", merchantId: "nope-unknown", currency: "USD", date: "2026-05-01T00:00:00.000Z", total: 1 },
];

// buildFilterOptions —————————————————————————————————————————————————————
const opts = buildFilterOptions(sample);
assert.ok(opts.merchants.length >= 4, "merchant list");
const merchantIds = opts.merchants.map((m) => m.id);
assert.ok(merchantIds.includes("amazon-us"));
assert.ok(merchantIds.includes("nope-unknown"), "unknown merchant id still listed");
const amazonUs = opts.merchants.find((m) => m.id === "amazon-us");
assert.equal(typeof amazonUs.label, "string");
assert.ok(amazonUs.label.length > 0);
assert.deepEqual(opts.countries.sort(), ["IN", "US"]);
assert.deepEqual(opts.currencies, ["INR", "USD"]);
// Labels are alpha-sorted.
const labels = opts.merchants.map((m) => m.label);
assert.deepEqual(labels.slice().sort((a, b) => a.localeCompare(b)), labels);

// Empty / bad inputs
assert.deepEqual(buildFilterOptions([]), { merchants: [], countries: [], currencies: [] });
assert.deepEqual(buildFilterOptions(null).merchants, []);
assert.deepEqual(buildFilterOptions([null, undefined, "junk", {}]).merchants, []);

// normalizeDateInput ——————————————————————————————————————————————————————
assert.equal(normalizeDateInput("2026-05-23"),       "2026-05-23T00:00:00.000Z");
assert.equal(normalizeDateInput("2026-05-23", true), "2026-05-23T23:59:59.999Z");
assert.equal(normalizeDateInput(""), null);
assert.equal(normalizeDateInput("not a date"), null);
assert.equal(normalizeDateInput("2026/05/23"), null);
assert.equal(normalizeDateInput(null), null);

// buildStoreFilter ————————————————————————————————————————————————————————
assert.deepEqual(buildStoreFilter({}), {});
assert.deepEqual(buildStoreFilter({ q: "  " }), {});
assert.deepEqual(buildStoreFilter({ merchantId: "*", country: "*", currency: "*" }), {});
assert.deepEqual(buildStoreFilter({
  q: "  pizza  ",
  merchantId: "doordash",
  country: "US",
  currency: "USD",
  dateFrom: "2026-01-01",
  dateTo: "2026-06-30",
}), {
  q: "pizza",
  merchantId: "doordash",
  country: "US",
  currency: "USD",
  dateFrom: "2026-01-01T00:00:00.000Z",
  dateTo: "2026-06-30T23:59:59.999Z",
});
// Bad dates dropped.
assert.deepEqual(buildStoreFilter({ dateFrom: "garbage", dateTo: "" }), {});

// isFilterActive ——————————————————————————————————————————————————————————
assert.equal(isFilterActive(null), false);
assert.equal(isFilterActive({}), false);
assert.equal(isFilterActive({ q: "x" }), true);

console.log("\u2713 popup-filters tests pass");
