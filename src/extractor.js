// Generic extractor interface.
//
// A receipt extractor is a small object describing how to recognize and
// pull order data out of a merchant's DOM. The interface is intentionally
// minimal so per-merchant adapters stay tiny and testable:
//
//   {
//     id:        string,   // merchant id (must match merchants.js)
//     version:   string,   // semver-ish, bumped when extraction changes shape
//     matches:   (url, doc) => boolean,   // optional, defaults to host match via merchants.js
//     extract:   (doc, ctx) => PartialReceipt | null,
//   }
//
// The host (background or content script) calls `runExtractor(extractor, doc, ctx)`
// which normalizes, validates, and stamps the result into a canonical Receipt.
//
// Receipt shape (canonical):
//   {
//     id:          string,        // stable per-merchant order id (or synthesized)
//     merchantId:  string,        // from registry
//     date:        string,        // ISO 8601 (e.g. 2026-05-23T10:12:00.000Z)
//     total:       number,        // numeric major units
//     currency:    string,        // ISO 4217 (e.g. "USD")
//     items:       Array<Item>,   // line items, may be empty
//     raw:         object,        // captured source snapshot
//   }
//
// Item shape:
//   { name: string, qty?: number, unitPrice?: number, lineTotal?: number, sku?: string }
//
// Errors thrown by an extractor are caught and surfaced as a failed result
// rather than crashing the host. Validation is strict-but-friendly: missing
// optional fields are filled in with safe defaults, but a missing total or
// currency is a hard failure.

import { MERCHANTS_BY_ID } from "./merchants.js";
import { isSupportedCurrency } from "./currency.js";

/**
 * Sentinel exposed for instanceof checks in tests / hosts.
 */
export class ExtractorError extends Error {
  constructor(message, { code = "EXTRACT_FAIL", cause } = {}) {
    super(message);
    this.name = "ExtractorError";
    this.code = code;
    if (cause) this.cause = cause;
  }
}

/** True iff `v` is a finite, non-negative number. */
function isMoney(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

/** Coerce assorted date inputs into an ISO 8601 string, or null. */
export function toIsoDate(input) {
  if (input == null || input === "") return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input.toISOString();
  }
  if (typeof input === "number") {
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof input === "string") {
    const d = new Date(input);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
    // Try DD/MM/YYYY and DD-MM-YYYY (common in IN/UK receipts).
    const m = input.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (m) {
      const [, dd, mm, yy] = m;
      const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
      const d2 = new Date(Date.UTC(year, Number(mm) - 1, Number(dd)));
      if (!Number.isNaN(d2.getTime())) return d2.toISOString();
    }
    return null;
  }
  return null;
}

/** Normalize a single line item, dropping clearly-bogus entries. */
function normalizeItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return null;
  const out = { name };
  if (raw.qty != null && Number.isFinite(Number(raw.qty))) {
    out.qty = Number(raw.qty);
  }
  if (raw.unitPrice != null && isMoney(Number(raw.unitPrice))) {
    out.unitPrice = Number(raw.unitPrice);
  }
  if (raw.lineTotal != null && isMoney(Number(raw.lineTotal))) {
    out.lineTotal = Number(raw.lineTotal);
  }
  if (typeof raw.sku === "string" && raw.sku.trim()) {
    out.sku = raw.sku.trim();
  }
  return out;
}

/** Synthesize a stable id when the extractor cannot produce one. */
function synthesizeId(merchantId, date, total) {
  const t = typeof total === "number" ? total.toFixed(2) : "x";
  const d = date ? date.slice(0, 10) : "no-date";
  return `${merchantId}:${d}:${t}:${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Validate the shape of an extractor object. Throws `ExtractorError` if
 * something is structurally wrong.
 */
export function validateExtractor(ex) {
  if (!ex || typeof ex !== "object") {
    throw new ExtractorError("extractor must be an object", { code: "BAD_EXTRACTOR" });
  }
  if (typeof ex.id !== "string" || !ex.id) {
    throw new ExtractorError("extractor.id required", { code: "BAD_EXTRACTOR" });
  }
  if (!MERCHANTS_BY_ID[ex.id]) {
    throw new ExtractorError(`extractor.id "${ex.id}" not in merchants registry`, { code: "UNKNOWN_MERCHANT" });
  }
  if (typeof ex.extract !== "function") {
    throw new ExtractorError("extractor.extract(doc, ctx) required", { code: "BAD_EXTRACTOR" });
  }
  if (ex.matches != null && typeof ex.matches !== "function") {
    throw new ExtractorError("extractor.matches must be a function if provided", { code: "BAD_EXTRACTOR" });
  }
  if (ex.version != null && typeof ex.version !== "string") {
    throw new ExtractorError("extractor.version must be a string", { code: "BAD_EXTRACTOR" });
  }
  return true;
}

/**
 * Normalize a partial result returned by an extractor into a canonical
 * Receipt. Throws `ExtractorError` on hard validation failures.
 */
export function normalizeReceipt(partial, { merchantId, url } = {}) {
  if (!partial || typeof partial !== "object") {
    throw new ExtractorError("extractor returned no receipt", { code: "EMPTY_RESULT" });
  }
  const mid = partial.merchantId || merchantId;
  if (!mid || !MERCHANTS_BY_ID[mid]) {
    throw new ExtractorError(`unknown merchantId: ${mid}`, { code: "UNKNOWN_MERCHANT" });
  }
  const total = Number(partial.total);
  if (!isMoney(total)) {
    throw new ExtractorError("receipt.total must be a non-negative number", { code: "BAD_TOTAL" });
  }
  const currency = String(partial.currency || "").toUpperCase();
  if (!isSupportedCurrency(currency)) {
    throw new ExtractorError(`unsupported currency: ${partial.currency}`, { code: "BAD_CURRENCY" });
  }
  const date = toIsoDate(partial.date) || new Date().toISOString();
  const items = Array.isArray(partial.items)
    ? partial.items.map(normalizeItem).filter(Boolean)
    : [];
  const id = (typeof partial.id === "string" && partial.id.trim())
    ? partial.id.trim()
    : synthesizeId(mid, date, total);
  const raw = (partial.raw && typeof partial.raw === "object") ? partial.raw : {};
  if (url && !raw.url) raw.url = url;
  return { id, merchantId: mid, date, total, currency, items, raw };
}

/**
 * Run an extractor against a document. Returns
 *   { ok: true,  receipt }
 * or
 *   { ok: false, error: ExtractorError }
 *
 * Never throws: hosts can fan out across extractors safely.
 */
export function runExtractor(extractor, doc, ctx = {}) {
  try {
    validateExtractor(extractor);
  } catch (e) {
    return { ok: false, error: e instanceof ExtractorError ? e : new ExtractorError(String(e)) };
  }
  const url = ctx.url || (doc && doc.location && doc.location.href) || "";
  if (typeof extractor.matches === "function") {
    try {
      if (!extractor.matches(url, doc)) {
        return { ok: false, error: new ExtractorError("url did not match extractor", { code: "NO_MATCH" }) };
      }
    } catch (e) {
      return { ok: false, error: new ExtractorError("matches() threw", { code: "MATCH_THREW", cause: e }) };
    }
  }
  let raw;
  try {
    raw = extractor.extract(doc, { ...ctx, url });
  } catch (e) {
    return { ok: false, error: new ExtractorError("extract() threw", { code: "EXTRACT_THREW", cause: e }) };
  }
  if (raw == null) {
    return { ok: false, error: new ExtractorError("extractor returned null", { code: "EMPTY_RESULT" }) };
  }
  try {
    const receipt = normalizeReceipt(raw, { merchantId: extractor.id, url });
    return { ok: true, receipt };
  } catch (e) {
    return { ok: false, error: e instanceof ExtractorError ? e : new ExtractorError(String(e)) };
  }
}

/**
 * Tiny in-memory registry. Useful in tests and in the background script
 * which collects extractors from per-merchant modules.
 */
export function createExtractorRegistry() {
  const map = new Map();
  return {
    register(ex) {
      validateExtractor(ex);
      map.set(ex.id, ex);
      return ex;
    },
    unregister(id) { return map.delete(id); },
    get(id) { return map.get(id) || null; },
    all() { return [...map.values()]; },
    size() { return map.size; },
  };
}

/**
 * Build a no-op extractor scaffold for a merchant id. Used by tests and
 * as a starter for new per-merchant adapters.
 */
export function makeStubExtractor(merchantId, override = {}) {
  return {
    id: merchantId,
    version: "0.0.0",
    extract: () => null,
    ...override,
  };
}
