// Currency support for receipts: enum + formatters + parsers + conversion.
// All conversion uses pinned fallback rates; live rates can be refreshed via background fetch later.
// Goal: deterministic + offline-capable + locale-aware display.

export const CURRENCIES = {
  // ── Major ──
  USD: { code: "USD", symbol: "$", name: "US Dollar", decimals: 2, locale: "en-US" },
  EUR: { code: "EUR", symbol: "€", name: "Euro", decimals: 2, locale: "en-IE" },
  GBP: { code: "GBP", symbol: "£", name: "British Pound", decimals: 2, locale: "en-GB" },
  JPY: { code: "JPY", symbol: "¥", name: "Japanese Yen", decimals: 0, locale: "ja-JP" },
  CNY: { code: "CNY", symbol: "¥", name: "Chinese Yuan", decimals: 2, locale: "zh-CN" },
  // ── Asia ──
  INR: { code: "INR", symbol: "₹", name: "Indian Rupee", decimals: 2, locale: "en-IN" },
  SGD: { code: "SGD", symbol: "S$", name: "Singapore Dollar", decimals: 2, locale: "en-SG" },
  HKD: { code: "HKD", symbol: "HK$", name: "Hong Kong Dollar", decimals: 2, locale: "en-HK" },
  KRW: { code: "KRW", symbol: "₩", name: "South Korean Won", decimals: 0, locale: "ko-KR" },
  IDR: { code: "IDR", symbol: "Rp", name: "Indonesian Rupiah", decimals: 0, locale: "id-ID" },
  THB: { code: "THB", symbol: "฿", name: "Thai Baht", decimals: 2, locale: "th-TH" },
  PHP: { code: "PHP", symbol: "₱", name: "Philippine Peso", decimals: 2, locale: "en-PH" },
  MYR: { code: "MYR", symbol: "RM", name: "Malaysian Ringgit", decimals: 2, locale: "en-MY" },
  VND: { code: "VND", symbol: "₫", name: "Vietnamese Dong", decimals: 0, locale: "vi-VN" },
  AED: { code: "AED", symbol: "د.إ", name: "UAE Dirham", decimals: 2, locale: "en-AE" },
  SAR: { code: "SAR", symbol: "﷼", name: "Saudi Riyal", decimals: 2, locale: "en-SA" },
  ILS: { code: "ILS", symbol: "₪", name: "Israeli Shekel", decimals: 2, locale: "he-IL" },
  // ── Americas ──
  CAD: { code: "CAD", symbol: "C$", name: "Canadian Dollar", decimals: 2, locale: "en-CA" },
  MXN: { code: "MXN", symbol: "Mex$", name: "Mexican Peso", decimals: 2, locale: "es-MX" },
  BRL: { code: "BRL", symbol: "R$", name: "Brazilian Real", decimals: 2, locale: "pt-BR" },
  ARS: { code: "ARS", symbol: "AR$", name: "Argentine Peso", decimals: 2, locale: "es-AR" },
  CLP: { code: "CLP", symbol: "CLP$", name: "Chilean Peso", decimals: 0, locale: "es-CL" },
  // ── Oceania ──
  AUD: { code: "AUD", symbol: "A$", name: "Australian Dollar", decimals: 2, locale: "en-AU" },
  NZD: { code: "NZD", symbol: "NZ$", name: "New Zealand Dollar", decimals: 2, locale: "en-NZ" },
  // ── Europe non-EUR ──
  CHF: { code: "CHF", symbol: "Fr", name: "Swiss Franc", decimals: 2, locale: "de-CH" },
  SEK: { code: "SEK", symbol: "kr", name: "Swedish Krona", decimals: 2, locale: "sv-SE" },
  NOK: { code: "NOK", symbol: "kr", name: "Norwegian Krone", decimals: 2, locale: "nb-NO" },
  DKK: { code: "DKK", symbol: "kr", name: "Danish Krone", decimals: 2, locale: "da-DK" },
  PLN: { code: "PLN", symbol: "zł", name: "Polish Złoty", decimals: 2, locale: "pl-PL" },
  CZK: { code: "CZK", symbol: "Kč", name: "Czech Koruna", decimals: 2, locale: "cs-CZ" },
  HUF: { code: "HUF", symbol: "Ft", name: "Hungarian Forint", decimals: 0, locale: "hu-HU" },
  RON: { code: "RON", symbol: "lei", name: "Romanian Leu", decimals: 2, locale: "ro-RO" },
  TRY: { code: "TRY", symbol: "₺", name: "Turkish Lira", decimals: 2, locale: "tr-TR" },
  RUB: { code: "RUB", symbol: "₽", name: "Russian Ruble", decimals: 2, locale: "ru-RU" },
  UAH: { code: "UAH", symbol: "₴", name: "Ukrainian Hryvnia", decimals: 2, locale: "uk-UA" },
  // ── Africa ──
  ZAR: { code: "ZAR", symbol: "R", name: "South African Rand", decimals: 2, locale: "en-ZA" },
  EGP: { code: "EGP", symbol: "E£", name: "Egyptian Pound", decimals: 2, locale: "ar-EG" },
  NGN: { code: "NGN", symbol: "₦", name: "Nigerian Naira", decimals: 2, locale: "en-NG" },
};

/**
 * Pinned FX rates relative to USD (1 USD = X foreign).
 * Snapshot date: 2026-05-23. Refreshed on demand by background fetch (see refreshRates()).
 * Conservative midpoint values; live extractors prefer order-page native currency.
 */
export const FX_PINNED = {
  asOf: "2026-05-23",
  base: "USD",
  rates: {
    USD: 1, EUR: 0.91, GBP: 0.78, JPY: 154.2, CNY: 7.21,
    INR: 83.7, SGD: 1.34, HKD: 7.82, KRW: 1372, IDR: 16040, THB: 36.4,
    PHP: 57.8, MYR: 4.69, VND: 25420, AED: 3.67, SAR: 3.75, ILS: 3.66,
    CAD: 1.36, MXN: 16.9, BRL: 5.18, ARS: 880, CLP: 920,
    AUD: 1.51, NZD: 1.66,
    CHF: 0.91, SEK: 10.6, NOK: 10.8, DKK: 6.79, PLN: 4.0,
    CZK: 22.7, HUF: 354, RON: 4.54, TRY: 32.2, RUB: 89.5, UAH: 39.6,
    ZAR: 18.6, EGP: 47.5, NGN: 1530,
  },
};

/** Default currency for a country code. */
export const COUNTRY_TO_CURRENCY = {
  US: "USD", CA: "CAD", UK: "GBP", IN: "INR",
  AU: "AUD", NZ: "NZD",
  DE: "EUR", FR: "EUR", IT: "EUR", ES: "EUR", NL: "EUR", IE: "EUR", PT: "EUR", BE: "EUR", AT: "EUR", FI: "EUR", GR: "EUR",
  CH: "CHF", SE: "SEK", NO: "NOK", DK: "DKK", PL: "PLN", CZ: "CZK", HU: "HUF", RO: "RON", TR: "TRY", RU: "RUB", UA: "UAH",
  JP: "JPY", CN: "CNY", SG: "SGD", HK: "HKD", KR: "KRW", ID: "IDR", TH: "THB", PH: "PHP", MY: "MYR", VN: "VND",
  AE: "AED", SA: "SAR", IL: "ILS",
  MX: "MXN", BR: "BRL", AR: "ARS", CL: "CLP",
  ZA: "ZAR", EG: "EGP", NG: "NGN",
};

export function isSupportedCurrency(code) {
  return !!CURRENCIES[(code || "").toUpperCase()];
}

/**
 * Format amount using Intl.NumberFormat for the currency's preferred locale.
 * @param {number} amount  Numeric amount in major units (e.g. 1234.56 USD).
 * @param {string} code    ISO 4217 code.
 * @param {object} [opts]  { locale?: override, compact?: boolean }
 */
export function formatMoney(amount, code, opts = {}) {
  const c = CURRENCIES[(code || "").toUpperCase()];
  if (!c) return String(amount);
  const locale = opts.locale || c.locale;
  const notation = opts.compact ? "compact" : "standard";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: c.code,
      minimumFractionDigits: c.decimals,
      maximumFractionDigits: c.decimals,
      notation,
    }).format(amount);
  } catch {
    // Fallback if locale missing in runtime ICU.
    return `${c.symbol}${amount.toFixed(c.decimals)}`;
  }
}

/**
 * Parse a money string (from a merchant page) into { amount, currency }.
 * Returns { amount: NaN, currency: null } if unparseable.
 *
 *   parseMoney("₹1,29,999")   → { amount: 129999, currency: "INR" }
 *   parseMoney("$1,299.00")   → { amount: 1299, currency: "USD" }
 *   parseMoney("CDN$ 49.95")  → { amount: 49.95, currency: "CAD" }
 *   parseMoney("£12.34")      → { amount: 12.34, currency: "GBP" }
 *   parseMoney("1.234,56 €")  → { amount: 1234.56, currency: "EUR" }
 */
const SYMBOL_TO_CURRENCY = (() => {
  const m = {};
  // Prefer specific multi-char symbols first, then single
  for (const code of Object.keys(CURRENCIES)) {
    const sym = CURRENCIES[code].symbol;
    if (!m[sym]) m[sym] = code;
  }
  // Explicit aliases for ambiguous pages
  m["CDN$"] = "CAD"; m["C$"] = "CAD"; m["CA$"] = "CAD";
  m["US$"] = "USD"; m["USD"] = "USD";
  m["AU$"] = "AUD"; m["NZ$"] = "NZD";
  m["HK$"] = "HKD"; m["S$"] = "SGD"; m["NT$"] = "TWD";
  m["R$"] = "BRL"; m["AR$"] = "ARS"; m["CLP$"] = "CLP"; m["Mex$"] = "MXN";
  m["Rs"] = "INR"; m["Rs."] = "INR"; m["INR"] = "INR";
  m["£"] = "GBP"; m["€"] = "EUR"; m["¥"] = "JPY"; m["₹"] = "INR";
  return m;
})();

export function parseMoney(str, hint) {
  if (!str) return { amount: NaN, currency: hint || null };
  const cleaned = String(str).replace(/\u00a0/g, " ").trim();

  // Detect currency by leading or trailing symbol/code.
  let currency = hint || null;
  // ISO code wins if present
  const isoMatch = cleaned.match(/\b([A-Z]{3})\b/);
  if (isoMatch && CURRENCIES[isoMatch[1]]) currency = isoMatch[1];
  if (!currency) {
    // Try longest symbol match
    const syms = Object.keys(SYMBOL_TO_CURRENCY).sort((a, b) => b.length - a.length);
    for (const sym of syms) {
      if (cleaned.includes(sym)) { currency = SYMBOL_TO_CURRENCY[sym]; break; }
    }
  }
  if (!currency) currency = hint || "USD";

  // Strip everything except digits, separators, minus.
  let numPart = cleaned.replace(/[^\d.,\-]/g, "");
  if (!numPart) return { amount: NaN, currency };

  // Decide which separator is decimal.
  const lastDot = numPart.lastIndexOf(".");
  const lastComma = numPart.lastIndexOf(",");
  let amount;
  if (lastDot === -1 && lastComma === -1) {
    amount = parseInt(numPart, 10);
  } else if (lastDot > lastComma) {
    // dot is decimal, comma is thousands
    amount = parseFloat(numPart.replace(/,/g, ""));
  } else if (lastComma > lastDot) {
    // last separator is a comma. If it's followed by exactly 3 digits, treat it as thousands
    // (e.g. INR "1,29,999" or US "1,000"); otherwise it's a decimal (EU "1.234,56").
    const tail = numPart.slice(lastComma + 1);
    if (/^\d{3}$/.test(tail)) {
      amount = parseFloat(numPart.replace(/,/g, "").replace(/\.(?=\d{3}(\D|$))/g, ""));
    } else {
      amount = parseFloat(numPart.replace(/\./g, "").replace(",", "."));
    }
  } else {
    amount = parseFloat(numPart);
  }
  return { amount, currency };
}

/** Convert amount from one currency to another using pinned rates (or supplied rates object). */
export function convert(amount, from, to, rates = FX_PINNED.rates) {
  if (!isFinite(amount)) return NaN;
  const f = from?.toUpperCase(); const t = to?.toUpperCase();
  if (!rates[f] || !rates[t]) return NaN;
  if (f === t) return amount;
  // Bring to base (USD), then to target.
  const inUsd = amount / rates[f];
  return inUsd * rates[t];
}

/** Best-effort live refresh — uses open.er-api.com (free, no key). Caller must have host permission. */
export async function refreshRates({ fetcher = fetch } = {}) {
  try {
    const res = await fetcher("https://open.er-api.com/v6/latest/USD");
    if (!res.ok) throw new Error("fx http " + res.status);
    const j = await res.json();
    if (!j?.rates) throw new Error("no rates");
    return { asOf: new Date().toISOString().slice(0, 10), base: "USD", rates: j.rates };
  } catch (e) {
    return null; // Fall back to pinned rates
  }
}

/** Pretty list of supported currencies for settings dropdowns. */
export function listCurrencies() {
  return Object.values(CURRENCIES).map((c) => ({ code: c.code, label: `${c.code} — ${c.name} (${c.symbol})` }));
}
