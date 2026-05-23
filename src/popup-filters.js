// Pure helpers for the popup filter bar. Kept DOM-free so they're testable.
// Public API:
//   buildFilterOptions(receipts) → { merchants, countries, currencies }
//   buildStoreFilter(uiState)    → store.list() filter spec
//   normalizeDateInput(s, end)   → ISO string | null  (end=true → 23:59:59.999)

import { MERCHANTS_BY_ID } from "./merchants.js";

/**
 * Build select-option lists from the receipts currently in the store.
 * Only emits options for values that actually appear so the UI stays tight.
 * Returns sorted, de-duplicated lists.
 */
export function buildFilterOptions(receipts) {
  const merchantIds = new Set();
  const countries = new Set();
  const currencies = new Set();
  for (const r of receipts || []) {
    if (!r || typeof r !== "object") continue;
    if (typeof r.merchantId === "string" && r.merchantId) merchantIds.add(r.merchantId);
    if (typeof r.currency === "string" && r.currency) currencies.add(r.currency.toUpperCase());
    const m = MERCHANTS_BY_ID[r.merchantId];
    if (m?.country) countries.add(m.country.toUpperCase());
  }
  const merchants = [...merchantIds].map((id) => ({
    id,
    label: MERCHANTS_BY_ID[id]?.name || id,
  })).sort((a, b) => a.label.localeCompare(b.label));
  return {
    merchants,
    countries: [...countries].sort(),
    currencies: [...currencies].sort(),
  };
}

/** Parse `YYYY-MM-DD` into an ISO timestamp; `end=true` snaps to 23:59:59.999. */
export function normalizeDateInput(s, end = false) {
  if (typeof s !== "string") return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const iso = end
    ? `${y}-${mo}-${d}T23:59:59.999Z`
    : `${y}-${mo}-${d}T00:00:00.000Z`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? iso : null;
}

/**
 * Translate the popup's filter UI state into a `store.list()` filter spec.
 * Empty/blank values are dropped so they don't filter anything out.
 */
export function buildStoreFilter(ui = {}) {
  const out = {};
  const q = typeof ui.q === "string" ? ui.q.trim() : "";
  if (q) out.q = q;
  if (ui.merchantId && ui.merchantId !== "*") out.merchantId = ui.merchantId;
  if (ui.country && ui.country !== "*") out.country = ui.country;
  if (ui.currency && ui.currency !== "*") out.currency = ui.currency;
  const df = normalizeDateInput(ui.dateFrom, false);
  const dt = normalizeDateInput(ui.dateTo, true);
  if (df) out.dateFrom = df;
  if (dt) out.dateTo = dt;
  return out;
}

/** True iff a filter spec would constrain results. */
export function isFilterActive(filter) {
  if (!filter || typeof filter !== "object") return false;
  return Object.keys(filter).length > 0;
}
