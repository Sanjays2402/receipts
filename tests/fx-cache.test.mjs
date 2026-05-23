// Tests for fx-cache background refresh module.
import {
  STORAGE_KEY,
  STALE_MS,
  readCache,
  isStale,
  getRates,
  maybeRefreshRates,
} from "../src/fx-cache.js";
import { FX_PINNED } from "../src/currency.js";

let pass = 0, fail = 0;
function eq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log("\u2713", name); }
  else { fail++; console.error("\u2717", name, "\n   expected:", expected, "\n   actual:  ", actual); }
}

function memStorage(initial = {}) {
  const store = { ...initial };
  return {
    store,
    async get(key) { return key in store ? store[key] : null; },
    async set(key, value) { store[key] = value; return true; },
  };
}

function okFetcher(rates) {
  return async () => ({ ok: true, status: 200, async json() { return { rates }; } });
}
function failFetcher() {
  return async () => ({ ok: false, status: 503, async json() { return {}; } });
}

// isStale boundaries
eq("isStale null cache → true", isStale(null), true);
eq("isStale fresh cache → false", isStale({ fetchedAt: 1000 }, 1000 + STALE_MS - 1), false);
eq("isStale exactly stale → true", isStale({ fetchedAt: 1000 }, 1000 + STALE_MS), true);

// readCache: empty storage
{
  const s = memStorage();
  const v = await readCache(s);
  eq("readCache empty → null", v, null);
}

// readCache: malformed entry rejected
{
  const s = memStorage({ [STORAGE_KEY]: { rates: "nope" } });
  eq("readCache malformed → null", await readCache(s), null);
}

// readCache: valid entry round-trips
{
  const entry = { asOf: "2026-05-23", base: "USD", rates: { USD: 1, INR: 84 }, fetchedAt: 999 };
  const s = memStorage({ [STORAGE_KEY]: entry });
  eq("readCache valid entry", await readCache(s), entry);
}

// getRates: pinned fallback
{
  const s = memStorage();
  const r = await getRates({ storage: s, now: 0 });
  eq("getRates pinned source", r.source, "pinned");
  eq("getRates pinned USD=1", r.rates.USD, 1);
  eq("getRates pinned asOf matches", r.asOf, FX_PINNED.asOf);
}

// getRates: fresh live cache wins
{
  const entry = { asOf: "2026-05-23", base: "USD", rates: { USD: 1, INR: 84.1 }, fetchedAt: 100 };
  const s = memStorage({ [STORAGE_KEY]: entry });
  const r = await getRates({ storage: s, now: 200 });
  eq("getRates live-fresh source", r.source, "live-fresh");
  eq("getRates live-fresh INR", r.rates.INR, 84.1);
}

// getRates: stale cache still returned but flagged
{
  const entry = { asOf: "2026-05-20", base: "USD", rates: { USD: 1, INR: 84.1 }, fetchedAt: 0 };
  const s = memStorage({ [STORAGE_KEY]: entry });
  const r = await getRates({ storage: s, now: STALE_MS + 1 });
  eq("getRates live-stale source", r.source, "live-stale");
}

// maybeRefreshRates: fresh → no network call
{
  const entry = { asOf: "2026-05-23", base: "USD", rates: { USD: 1, INR: 84.1 }, fetchedAt: 100 };
  const s = memStorage({ [STORAGE_KEY]: entry });
  let calls = 0;
  const fetcher = async () => { calls++; return { ok: true, async json() { return { rates: {} }; } }; };
  const r = await maybeRefreshRates({ storage: s, fetcher, now: 200 });
  eq("maybeRefresh fresh → not refreshed", r.refreshed, false);
  eq("maybeRefresh fresh reason", r.reason, "fresh");
  eq("maybeRefresh fresh → zero network calls", calls, 0);
}

// maybeRefreshRates: empty cache → fetches and writes
{
  const s = memStorage();
  const fetcher = okFetcher({ USD: 1, INR: 85.5, EUR: 0.92 });
  const r = await maybeRefreshRates({ storage: s, fetcher, now: 1234 });
  eq("maybeRefresh empty → refreshed", r.refreshed, true);
  eq("maybeRefresh empty reason ok", r.reason, "ok");
  eq("maybeRefresh empty stored INR", s.store[STORAGE_KEY].rates.INR, 85.5);
  eq("maybeRefresh empty stored fetchedAt", s.store[STORAGE_KEY].fetchedAt, 1234);
}

// maybeRefreshRates: stale → fetches
{
  const old = { asOf: "2026-05-20", base: "USD", rates: { USD: 1, INR: 84 }, fetchedAt: 0 };
  const s = memStorage({ [STORAGE_KEY]: old });
  const fetcher = okFetcher({ USD: 1, INR: 86 });
  const r = await maybeRefreshRates({ storage: s, fetcher, now: STALE_MS + 1 });
  eq("maybeRefresh stale → refreshed", r.refreshed, true);
  eq("maybeRefresh stale stored INR updated", s.store[STORAGE_KEY].rates.INR, 86);
}

// maybeRefreshRates: fetch failure keeps old cache
{
  const old = { asOf: "2026-05-20", base: "USD", rates: { USD: 1, INR: 84 }, fetchedAt: 0 };
  const s = memStorage({ [STORAGE_KEY]: old });
  const fetcher = failFetcher();
  const r = await maybeRefreshRates({ storage: s, fetcher, now: STALE_MS + 1 });
  eq("maybeRefresh fetch-fail not refreshed", r.refreshed, false);
  eq("maybeRefresh fetch-fail reason", r.reason, "fetch-failed");
  eq("maybeRefresh fetch-fail keeps old cache", s.store[STORAGE_KEY].rates.INR, 84);
}

// maybeRefreshRates: force ignores freshness
{
  const fresh = { asOf: "2026-05-23", base: "USD", rates: { USD: 1, INR: 84 }, fetchedAt: 100 };
  const s = memStorage({ [STORAGE_KEY]: fresh });
  let calls = 0;
  const fetcher = async () => { calls++; return { ok: true, async json() { return { rates: { USD: 1, INR: 90 } }; } }; };
  const r = await maybeRefreshRates({ storage: s, fetcher, now: 200, force: true });
  eq("maybeRefresh force → refreshed", r.refreshed, true);
  eq("maybeRefresh force → network called", calls, 1);
  eq("maybeRefresh force → INR updated", s.store[STORAGE_KEY].rates.INR, 90);
}

if (fail) { console.error(`fx-cache: ${fail} failed`); process.exit(1); }
console.log(`fx-cache: ${pass} ok`);
