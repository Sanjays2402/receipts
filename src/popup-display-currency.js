// Preferred-display-currency preference + conversion helpers for the popup.
//
// The user can pin a single "display in …" currency in the popup filter bar.
// When set, every receipt total is shown alongside its native amount converted
// into that currency, using `convert()` from `currency.js` (pinned FX rates
// today; background refresh later).
//
// Public, DOM-free API (so it can be unit-tested without a popup):
//   readPref(storage?)                       → "AUTO" | "USD" | "EUR" | …
//   writePref(value, storage?)               → void   (AUTO clears the key)
//   convertedView(amount, from, target?, rates?)
//                                            → { amount, currency } | null
//   formatConverted(amount, from, target?, fmt?, rates?)
//                                            → "≈ €11.40" | ""
//
// All functions degrade gracefully when storage is unavailable, the currency
// pair is unknown, or `target === from` / `target === AUTO`.

import { convert, formatMoney, isSupportedCurrency, FX_PINNED } from "./currency.js";

export const STORAGE_KEY = "receipts:displayCurrency";
export const AUTO = "AUTO";

function getStorage(s) {
  if (s) return s;
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {}
  return null;
}

/** Read the user's preferred display currency. Returns "AUTO" when not set or invalid. */
export function readPref(storage) {
  const s = getStorage(storage);
  if (!s) return AUTO;
  try {
    const v = s.getItem(STORAGE_KEY);
    if (!v || v === AUTO) return AUTO;
    const up = String(v).toUpperCase();
    return isSupportedCurrency(up) ? up : AUTO;
  } catch {
    return AUTO;
  }
}

/** Write the preferred display currency. AUTO (or empty) clears the key. */
export function writePref(value, storage) {
  const s = getStorage(storage);
  if (!s) return;
  try {
    if (!value || value === AUTO) {
      s.removeItem(STORAGE_KEY);
      return;
    }
    const up = String(value).toUpperCase();
    if (isSupportedCurrency(up)) s.setItem(STORAGE_KEY, up);
  } catch {
    /* ignore */
  }
}

/**
 * Build the converted view for a given native amount.
 * Returns null when no conversion should be shown (AUTO, same currency, unknown pair).
 */
export function convertedView(amount, fromCurrency, target, rates = FX_PINNED.rates) {
  if (!Number.isFinite(Number(amount))) return null;
  if (!target || target === AUTO) return null;
  if (!fromCurrency) return null;
  const t = String(target).toUpperCase();
  const f = String(fromCurrency).toUpperCase();
  if (!isSupportedCurrency(t)) return null;
  if (t === f) return null;
  const out = convert(Number(amount), f, t, rates);
  if (!Number.isFinite(out)) return null;
  return { amount: out, currency: t };
}

/** Render a "≈ €11.40"-style converted-amount string. Empty string when no conversion. */
export function formatConverted(
  amount,
  fromCurrency,
  target,
  fmt = formatMoney,
  rates = FX_PINNED.rates,
) {
  const v = convertedView(amount, fromCurrency, target, rates);
  if (!v) return "";
  return `\u2248 ${fmt(v.amount, v.currency)}`;
}
