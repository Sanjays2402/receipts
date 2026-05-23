// IndexedDB-backed store for captured receipts.
//
// Public API:
//   const store = createStore();                       // uses globalThis.indexedDB
//   const store = createStore({ adapter });            // inject for tests / SSR
//   await store.put(receipt);                          // upsert (id is the primary key)
//   await store.get(id);
//   await store.delete(id);
//   await store.clear();
//   await store.list(filter, { sort, limit, offset });
//   await store.count(filter);
//
// Filter shape (all fields optional, AND-combined):
//   {
//     q:         string,            // case-insensitive substring across merchant + item names
//     merchantId:string|string[],
//     country:   string|string[],   // ISO-3166 alpha-2, resolved via merchants registry
//     currency:  string|string[],   // ISO-4217
//     dateFrom:  string|Date|number,
//     dateTo:    string|Date|number,
//     minTotal:  number,
//     maxTotal:  number,
//   }
//
// Sort: { field: "date"|"total"|"merchantId", dir: "asc"|"desc" }, default { field:"date", dir:"desc" }.
//
// The IDB layer keeps things to a single object store with secondary indexes
// on `merchantId`, `currency`, and `date` so most filters can hit an index.
// The `list()` implementation does the final composite filtering in JS — there
// are at most a few thousand receipts per user in practice.

import { MERCHANTS_BY_ID } from "./merchants.js";

export const DB_NAME = "receipts";
export const DB_VERSION = 1;
export const STORE_NAME = "receipts";
export const INDEXES = ["merchantId", "currency", "date"];

// ── pure helpers (exported for tests) ───────────────────────────────────────

function toMs(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function asArray(v) {
  if (v == null) return null;
  return Array.isArray(v) ? v.filter((x) => x != null && x !== "") : [v];
}

/** True iff `r` is a structurally-plausible receipt for storage. */
export function isReceiptLike(r) {
  return !!(
    r &&
    typeof r === "object" &&
    typeof r.id === "string" && r.id &&
    typeof r.merchantId === "string" && r.merchantId &&
    typeof r.date === "string" && r.date &&
    typeof r.currency === "string" && r.currency &&
    typeof r.total === "number" && Number.isFinite(r.total) && r.total >= 0
  );
}

/** Resolve the country for a receipt via the merchants registry, or null. */
export function receiptCountry(r) {
  const m = MERCHANTS_BY_ID[r?.merchantId];
  return m?.country || null;
}

/** Apply a filter spec to a list of receipts in-memory. */
export function applyFilter(receipts, filter = {}) {
  if (!filter || typeof filter !== "object") return receipts.slice();
  const merchantIds = asArray(filter.merchantId);
  const countries = asArray(filter.country)?.map((c) => String(c).toUpperCase());
  const currencies = asArray(filter.currency)?.map((c) => String(c).toUpperCase());
  const from = toMs(filter.dateFrom);
  const to = toMs(filter.dateTo);
  const minTotal = typeof filter.minTotal === "number" ? filter.minTotal : null;
  const maxTotal = typeof filter.maxTotal === "number" ? filter.maxTotal : null;
  const q = typeof filter.q === "string" && filter.q.trim()
    ? filter.q.trim().toLowerCase()
    : null;

  return receipts.filter((r) => {
    if (!isReceiptLike(r)) return false;
    if (merchantIds && !merchantIds.includes(r.merchantId)) return false;
    if (currencies && !currencies.includes(String(r.currency).toUpperCase())) return false;
    if (countries) {
      const c = receiptCountry(r);
      if (!c || !countries.includes(c.toUpperCase())) return false;
    }
    if (from != null || to != null) {
      const t = toMs(r.date);
      if (t == null) return false;
      if (from != null && t < from) return false;
      if (to != null && t > to) return false;
    }
    if (minTotal != null && r.total < minTotal) return false;
    if (maxTotal != null && r.total > maxTotal) return false;
    if (q) {
      const merchantName = MERCHANTS_BY_ID[r.merchantId]?.name || "";
      const haystack = [
        r.merchantId,
        merchantName,
        ...(Array.isArray(r.items) ? r.items.map((it) => it?.name || "") : []),
      ].join(" \u0001 ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

/** Sort receipts according to a spec. Stable on ties via id. */
export function applySort(receipts, sort) {
  const field = (sort && sort.field) || "date";
  const dir = (sort && sort.dir) === "asc" ? 1 : -1;
  const out = receipts.slice();
  out.sort((a, b) => {
    let av, bv;
    if (field === "total") { av = a.total; bv = b.total; }
    else if (field === "merchantId") { av = a.merchantId; bv = b.merchantId; }
    else { av = toMs(a.date) ?? 0; bv = toMs(b.date) ?? 0; }
    if (av < bv) return -1 * dir;
    if (av > bv) return  1 * dir;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return  1;
    return 0;
  });
  return out;
}

// ── adapters ───────────────────────────────────────────────────────────────

/** In-memory adapter, mostly for tests and the popup's "no IDB" fallback. */
export function createMemoryAdapter(seed) {
  const map = new Map();
  if (seed && Symbol.iterator in Object(seed)) {
    for (const r of seed) if (isReceiptLike(r)) map.set(r.id, r);
  }
  return {
    kind: "memory",
    async put(r) { map.set(r.id, r); return r; },
    async get(id) { return map.get(id) || null; },
    async delete(id) { return map.delete(id); },
    async clear() { map.clear(); },
    async getAll() { return [...map.values()]; },
    async count() { return map.size; },
  };
}

/** Wrap an IDBRequest as a Promise. */
function reqPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error("transaction aborted"));
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * IndexedDB adapter. Opens lazily and caches the handle. Pass a custom
 * factory to support tests via `fake-indexeddb` or Workers.
 */
export function createIdbAdapter({
  factory,
  dbName = DB_NAME,
  dbVersion = DB_VERSION,
} = {}) {
  const idb = factory || (typeof globalThis !== "undefined" ? globalThis.indexedDB : null);
  if (!idb) {
    throw new Error("createIdbAdapter: no indexedDB available; pass { factory }");
  }
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = idb.open(dbName, dbVersion);
      req.onupgradeneeded = () => {
        const db = req.result;
        let store;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        } else {
          store = req.transaction.objectStore(STORE_NAME);
        }
        for (const idx of INDEXES) {
          if (!store.indexNames.contains(idx)) {
            store.createIndex(idx, idx, { unique: false });
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("indexedDB open blocked"));
    });
    return dbPromise;
  }

  async function withStore(mode, fn) {
    const db = await open();
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const result = await fn(store);
    await txDone(tx);
    return result;
  }

  return {
    kind: "indexeddb",
    async put(r) { return withStore("readwrite", (s) => reqPromise(s.put(r))).then(() => r); },
    async get(id) { return withStore("readonly", (s) => reqPromise(s.get(id))).then((v) => v || null); },
    async delete(id) { return withStore("readwrite", (s) => reqPromise(s.delete(id))).then(() => true); },
    async clear() { return withStore("readwrite", (s) => reqPromise(s.clear())).then(() => undefined); },
    async getAll() { return withStore("readonly", (s) => reqPromise(s.getAll())); },
    async count() { return withStore("readonly", (s) => reqPromise(s.count())); },
  };
}

// ── store façade ────────────────────────────────────────────────────────────

/**
 * Build a Store. Falls back to an in-memory adapter if no IDB is available
 * (so tests and SSR/popups in private modes don't crash).
 */
export function createStore({ adapter } = {}) {
  let a = adapter;
  if (!a) {
    try {
      a = createIdbAdapter();
    } catch {
      a = createMemoryAdapter();
    }
  }

  function validate(r) {
    if (!isReceiptLike(r)) {
      throw new TypeError("store.put: invalid receipt shape");
    }
    if (!MERCHANTS_BY_ID[r.merchantId]) {
      throw new TypeError(`store.put: unknown merchantId "${r.merchantId}"`);
    }
  }

  return {
    adapter: a,
    async put(receipt) { validate(receipt); return a.put(receipt); },
    async putMany(receipts) {
      if (!Array.isArray(receipts)) throw new TypeError("putMany expects an array");
      for (const r of receipts) validate(r);
      // Best-effort sequential; adapters keep their own atomicity guarantees.
      for (const r of receipts) await a.put(r);
      return receipts.length;
    },
    async get(id) {
      if (typeof id !== "string" || !id) throw new TypeError("get: id required");
      return a.get(id);
    },
    async delete(id) {
      if (typeof id !== "string" || !id) throw new TypeError("delete: id required");
      return a.delete(id);
    },
    async clear() { return a.clear(); },
    async list(filter = {}, { sort, limit, offset } = {}) {
      const all = await a.getAll();
      const filtered = applyFilter(all, filter);
      const sorted = applySort(filtered, sort);
      const o = Number.isInteger(offset) && offset > 0 ? offset : 0;
      const l = Number.isInteger(limit) && limit > 0 ? limit : sorted.length;
      return sorted.slice(o, o + l);
    },
    async count(filter) {
      if (!filter || (typeof filter === "object" && Object.keys(filter).length === 0)) {
        return a.count();
      }
      const all = await a.getAll();
      return applyFilter(all, filter).length;
    },
  };
}
