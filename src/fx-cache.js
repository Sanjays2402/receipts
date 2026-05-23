// FX rate cache with 24h freshness window.
// Persists last-good live rates in chrome.storage.local under STORAGE_KEY.
// Falls back to pinned rates from currency.js when cache is empty or fetch fails.
// Pure functions: all I/O (storage + fetcher) is injected so this is unit-testable.

import { FX_PINNED, refreshRates } from "./currency.js";

export const STORAGE_KEY = "receipts/fx-cache";
export const STALE_MS = 24 * 60 * 60 * 1000; // 24h

/** Minimal in-process storage adapter wrapping chrome.storage.local. */
export function chromeStorageAdapter(area) {
  return {
    async get(key) {
      return new Promise((resolve) => {
        try {
          area.get([key], (res) => resolve(res?.[key] ?? null));
        } catch {
          resolve(null);
        }
      });
    },
    async set(key, value) {
      return new Promise((resolve) => {
        try {
          area.set({ [key]: value }, () => resolve(true));
        } catch {
          resolve(false);
        }
      });
    },
  };
}

/**
 * Returns the most recently cached rates payload, or null when none stored.
 * Shape: { asOf: "YYYY-MM-DD", base: "USD", rates: { CODE: number, ... }, fetchedAt: <ms> }
 */
export async function readCache(storage) {
  if (!storage) return null;
  const v = await storage.get(STORAGE_KEY);
  if (!v || typeof v !== "object") return null;
  if (!v.rates || typeof v.rates !== "object") return null;
  if (typeof v.fetchedAt !== "number") return null;
  return v;
}

/** Returns true when cache is missing or older than STALE_MS. */
export function isStale(cache, now = Date.now()) {
  if (!cache) return true;
  return now - cache.fetchedAt >= STALE_MS;
}

/**
 * Read-side helper: returns the best rate set available right now.
 * Order: fresh cache → stale cache → pinned fallback.
 * `meta.source` is one of "live-fresh" | "live-stale" | "pinned".
 */
export async function getRates({ storage, now = Date.now() } = {}) {
  const cache = await readCache(storage);
  if (cache && !isStale(cache, now)) {
    return { rates: cache.rates, asOf: cache.asOf, source: "live-fresh", fetchedAt: cache.fetchedAt };
  }
  if (cache) {
    return { rates: cache.rates, asOf: cache.asOf, source: "live-stale", fetchedAt: cache.fetchedAt };
  }
  return { rates: FX_PINNED.rates, asOf: FX_PINNED.asOf, source: "pinned", fetchedAt: 0 };
}

/**
 * Conditionally refresh rates: if cache is fresh, no network call.
 * Otherwise calls refreshRates() and writes the result.
 * Returns: { refreshed: bool, reason, payload }.
 */
export async function maybeRefreshRates({ storage, fetcher, now = Date.now(), force = false } = {}) {
  const cache = await readCache(storage);
  if (!force && cache && !isStale(cache, now)) {
    return { refreshed: false, reason: "fresh", payload: cache };
  }
  const fresh = await refreshRates({ fetcher });
  if (!fresh) {
    return { refreshed: false, reason: "fetch-failed", payload: cache };
  }
  const payload = { ...fresh, fetchedAt: now };
  if (storage) await storage.set(STORAGE_KEY, payload);
  return { refreshed: true, reason: "ok", payload };
}
