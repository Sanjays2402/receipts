// Tests for src/store.js
import assert from "node:assert/strict";
import {
  createStore,
  createMemoryAdapter,
  applyFilter,
  applySort,
  isReceiptLike,
  receiptCountry,
} from "../src/store.js";

function r(over = {}) {
  return {
    id: over.id || `r-${Math.random().toString(36).slice(2, 8)}`,
    merchantId: over.merchantId || "amazon-us",
    date: over.date || "2026-05-01T12:00:00.000Z",
    total: over.total ?? 19.99,
    currency: over.currency || "USD",
    items: over.items || [{ name: "Widget" }],
    raw: over.raw || {},
  };
}

// ── pure helpers ────────────────────────────────────────────────────────────
assert.equal(isReceiptLike(null), false);
assert.equal(isReceiptLike({}), false);
assert.equal(isReceiptLike(r()), true);
assert.equal(isReceiptLike({ ...r(), total: -1 }), false);
assert.equal(receiptCountry(r({ merchantId: "amazon-us" })), "US");
assert.equal(receiptCountry(r({ merchantId: "flipkart" })), "IN");
assert.equal(receiptCountry({ merchantId: "nope" }), null);

// ── applyFilter ─────────────────────────────────────────────────────────────
const set = [
  r({ id: "a", merchantId: "amazon-us", currency: "USD", total: 10, date: "2026-01-01T00:00:00.000Z", items: [{ name: "Book" }] }),
  r({ id: "b", merchantId: "amazon-in", currency: "INR", total: 500, date: "2026-02-15T00:00:00.000Z", items: [{ name: "Pen" }] }),
  r({ id: "c", merchantId: "flipkart", currency: "INR", total: 1200, date: "2026-03-10T00:00:00.000Z", items: [{ name: "Phone Case" }] }),
  r({ id: "d", merchantId: "doordash", currency: "USD", total: 42.5, date: "2026-04-20T00:00:00.000Z", items: [{ name: "Pizza" }] }),
];

assert.equal(applyFilter(set, {}).length, 4);
assert.deepEqual(
  applyFilter(set, { merchantId: "amazon-us" }).map((x) => x.id),
  ["a"],
);
assert.deepEqual(
  applyFilter(set, { merchantId: ["amazon-us", "doordash"] }).map((x) => x.id).sort(),
  ["a", "d"],
);
assert.deepEqual(
  applyFilter(set, { country: "IN" }).map((x) => x.id).sort(),
  ["b", "c"],
);
assert.deepEqual(
  applyFilter(set, { currency: "USD" }).map((x) => x.id).sort(),
  ["a", "d"],
);
assert.deepEqual(
  applyFilter(set, { dateFrom: "2026-02-01", dateTo: "2026-03-31" }).map((x) => x.id).sort(),
  ["b", "c"],
);
assert.deepEqual(
  applyFilter(set, { minTotal: 100, maxTotal: 1000 }).map((x) => x.id),
  ["b"],
);
assert.deepEqual(
  applyFilter(set, { q: "pizza" }).map((x) => x.id),
  ["d"],
);
// Search hits merchant name too.
assert.ok(applyFilter(set, { q: "flipkart" }).some((x) => x.id === "c"));

// ── applySort ───────────────────────────────────────────────────────────────
assert.deepEqual(applySort(set, { field: "date", dir: "asc" }).map((x) => x.id), ["a","b","c","d"]);
assert.deepEqual(applySort(set, { field: "date", dir: "desc" }).map((x) => x.id), ["d","c","b","a"]);
assert.deepEqual(applySort(set, { field: "total", dir: "asc" }).map((x) => x.id), ["a","d","b","c"]);

// ── store façade with memory adapter ────────────────────────────────────────
const store = createStore({ adapter: createMemoryAdapter() });
await store.putMany(set);
assert.equal(await store.count(), 4);
assert.equal((await store.list()).length, 4);
assert.equal((await store.list({}, { limit: 2 })).length, 2);

const desc = await store.list({}, { sort: { field: "date", dir: "desc" } });
assert.deepEqual(desc.map((x) => x.id), ["d","c","b","a"]);

const inOnly = await store.list({ country: "IN" });
assert.deepEqual(inOnly.map((x) => x.id).sort(), ["b","c"]);

assert.equal(await store.count({ currency: "USD" }), 2);

const got = await store.get("a");
assert.equal(got.id, "a");
await store.delete("a");
assert.equal(await store.get("a"), null);
assert.equal(await store.count(), 3);

// Invalid receipt rejected.
await assert.rejects(() => store.put({ id: "x" }), TypeError);
// Unknown merchant rejected.
await assert.rejects(
  () => store.put(r({ merchantId: "not-a-merchant" })),
  TypeError,
);

await store.clear();
assert.equal(await store.count(), 0);

// ── createStore falls back to memory if IDB missing ─────────────────────────
const savedIdb = globalThis.indexedDB;
globalThis.indexedDB = undefined;
try {
  const fallback = createStore();
  assert.equal(fallback.adapter.kind, "memory");
  await fallback.put(r({ id: "z" }));
  assert.equal((await fallback.get("z")).id, "z");
} finally {
  globalThis.indexedDB = savedIdb;
}

// ── IDB adapter happy-path via fake factory ─────────────────────────────────
// Minimal stub of the IDB surface we touch. Just enough to verify wiring,
// not a real implementation.
function fakeIdbFactory() {
  const stores = new Map(); // store name → Map(id → value)
  function mkReq(resultFn) {
    const req = { onsuccess: null, onerror: null, result: undefined, error: null };
    queueMicrotask(() => {
      try { req.result = resultFn(); req.onsuccess && req.onsuccess(); }
      catch (e) { req.error = e; req.onerror && req.onerror(); }
    });
    return req;
  }
  return {
    open(name) {
      const db = {
        objectStoreNames: { contains: (n) => stores.has(n) },
        createObjectStore(n) {
          stores.set(n, new Map());
          return { indexNames: { contains: () => false }, createIndex() {} };
        },
        transaction(n) {
          const data = stores.get(n);
          let _oncomplete = null;
          let _completed = false;
          const tx = {
            get oncomplete() { return _oncomplete; },
            set oncomplete(fn) { _oncomplete = fn; if (_completed && fn) fn(); },
            onabort: null, onerror: null, error: null,
          };
          // Fire "complete" after a couple of microtask turns so handlers attach first.
          Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve()).then(() => {
            _completed = true;
            if (_oncomplete) _oncomplete();
          });
          tx.objectStore = function () {
            return {
              put: (v) => mkReq(() => { data.set(v.id, v); return v.id; }),
              get: (id) => mkReq(() => data.get(id)),
              delete: (id) => mkReq(() => { data.delete(id); }),
              clear: () => mkReq(() => { data.clear(); }),
              getAll: () => mkReq(() => [...data.values()]),
              count: () => mkReq(() => data.size),
              indexNames: { contains: () => true },
              createIndex() {},
            };
          };
          return tx;
        },
      };
      const req = { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, result: db, transaction: null };
      queueMicrotask(() => {
        // Simulate upgrade then open
        req.transaction = { objectStore: () => ({ indexNames: { contains: () => false }, createIndex() {} }) };
        req.onupgradeneeded && req.onupgradeneeded();
        req.onsuccess && req.onsuccess();
      });
      return req;
    },
  };
}

const { createIdbAdapter } = await import("../src/store.js");
const idbStore = createStore({ adapter: createIdbAdapter({ factory: fakeIdbFactory() }) });
await idbStore.put(r({ id: "k1", total: 5 }));
await idbStore.put(r({ id: "k2", total: 6 }));
assert.equal(await idbStore.count(), 2);
const all = await idbStore.list({}, { sort: { field: "total", dir: "asc" } });
assert.deepEqual(all.map((x) => x.id), ["k1", "k2"]);
await idbStore.delete("k1");
assert.equal(await idbStore.count(), 1);

console.log("\u2713 store.test.mjs ok");
