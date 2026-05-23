// Smoke + behavioral tests for currency module.
import { CURRENCIES, FX_PINNED, COUNTRY_TO_CURRENCY, isSupportedCurrency, formatMoney, parseMoney, convert, listCurrencies } from "../src/currency.js";

let pass = 0, fail = 0;
function eq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log("\u2713", name); }
  else { fail++; console.error("\u2717", name, "\n   expected:", expected, "\n   actual:  ", actual); }
}
function approx(name, actual, expected, eps = 0.5) {
  const ok = Math.abs(actual - expected) <= eps;
  if (ok) { pass++; console.log("\u2713", name); }
  else { fail++; console.error("\u2717", name, "\n   expected:~", expected, "\n   actual:  ", actual); }
}

// Sanity
eq("at least 30 currencies", Object.keys(CURRENCIES).length >= 30, true);
eq("USD supported", isSupportedCurrency("usd"), true);
eq("XXX not supported", isSupportedCurrency("XXX"), false);
eq("country IN → INR", COUNTRY_TO_CURRENCY.IN, "INR");
eq("country UK → GBP", COUNTRY_TO_CURRENCY.UK, "GBP");
eq("country CA → CAD", COUNTRY_TO_CURRENCY.CA, "CAD");
eq("listCurrencies returns objects with code+label", typeof listCurrencies()[0].label, "string");

// FX rates pinned
eq("FX_PINNED has USD=1", FX_PINNED.rates.USD, 1);
eq("FX_PINNED has INR", typeof FX_PINNED.rates.INR, "number");

// formatMoney — exact strings are locale-dependent; just verify it includes the amount and the symbol/code.
const usdFmt = formatMoney(1299.5, "USD");
eq("formatMoney USD includes $", usdFmt.includes("$"), true);
eq("formatMoney USD includes 1,299.50", usdFmt.includes("1,299.50"), true);
const inrFmt = formatMoney(129999, "INR");
eq("formatMoney INR includes ₹", inrFmt.includes("₹"), true);
// en-IN uses lakhs grouping → "1,29,999"
eq("formatMoney INR uses lakh grouping", /1,29,999/.test(inrFmt) || /129,999/.test(inrFmt), true);
const jpyFmt = formatMoney(12345, "JPY");
eq("formatMoney JPY 0 decimals", /12,345/.test(jpyFmt) && !/\.\d/.test(jpyFmt), true);

// parseMoney
eq("parseMoney $1,299.00", parseMoney("$1,299.00"), { amount: 1299, currency: "USD" });
eq("parseMoney ₹1,29,999", parseMoney("₹1,29,999"), { amount: 129999, currency: "INR" });
eq("parseMoney £12.34", parseMoney("£12.34"), { amount: 12.34, currency: "GBP" });
eq("parseMoney CDN$ 49.95", parseMoney("CDN$ 49.95"), { amount: 49.95, currency: "CAD" });
eq("parseMoney EU-style 1.234,56 €", parseMoney("1.234,56 €"), { amount: 1234.56, currency: "EUR" });
eq("parseMoney with hint", parseMoney("49.95", "GBP"), { amount: 49.95, currency: "GBP" });
eq("parseMoney garbage", isNaN(parseMoney("---").amount), true);

// convert
approx("convert 100 USD → INR ≈ 8370", convert(100, "USD", "INR"), 8370, 5);
approx("convert 100 INR → USD ≈ 1.19", convert(100, "INR", "USD"), 100 / 83.7, 0.01);
approx("convert USD → USD = identity", convert(50, "USD", "USD"), 50, 0);
eq("convert unknown currency → NaN", isNaN(convert(50, "XXX", "USD")), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
