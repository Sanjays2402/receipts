// Tests for popup-display-currency: pref storage + converted view helpers.
import {
  STORAGE_KEY,
  AUTO,
  readPref,
  writePref,
  convertedView,
  formatConverted,
} from "../src/popup-display-currency.js";
import { FX_PINNED, formatMoney } from "../src/currency.js";

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("\u2713", name); }
  else { fail++; console.error("\u2717", name, detail || ""); }
}
function eq(name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected),
     `\n   expected: ${JSON.stringify(expected)}\n   actual:   ${JSON.stringify(actual)}`);
}

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

// readPref
eq("readPref empty → AUTO", readPref(makeStorage()), AUTO);
eq("readPref uppercases stored code", readPref(makeStorage({ [STORAGE_KEY]: "usd" })), "USD");
eq("readPref ignores unknown", readPref(makeStorage({ [STORAGE_KEY]: "ZZZ" })), AUTO);

// writePref
{
  const s = makeStorage({ [STORAGE_KEY]: "EUR" });
  writePref(AUTO, s);
  eq("writePref AUTO clears key", s.getItem(STORAGE_KEY), null);
}
{
  const s = makeStorage();
  writePref("eur", s);
  eq("writePref stores uppercased", s.getItem(STORAGE_KEY), "EUR");
}
{
  const s = makeStorage();
  writePref("ZZZ", s);
  eq("writePref ignores unsupported", s.getItem(STORAGE_KEY), null);
}

// convertedView
eq("convertedView AUTO → null", convertedView(10, "USD", AUTO), null);
eq("convertedView same currency → null", convertedView(10, "USD", "USD"), null);
eq("convertedView unknown target → null", convertedView(10, "USD", "ZZZ"), null);
eq("convertedView NaN amount → null", convertedView(NaN, "USD", "EUR"), null);
eq("convertedView missing from → null", convertedView(10, null, "EUR"), null);

{
  const v = convertedView(100, "USD", "INR");
  ok("convertedView USD→INR has currency", v && v.currency === "INR");
  ok("convertedView USD→INR amount finite and positive", v && Number.isFinite(v.amount) && v.amount > 0,
     `amount=${v && v.amount}`);
}

{
  const v = convertedView(10, "EUR", "INR", FX_PINNED.rates);
  const expected = (10 / FX_PINNED.rates.EUR) * FX_PINNED.rates.INR;
  ok("convertedView EUR→INR matches via-USD math", v && Math.abs(v.amount - expected) < 1e-6,
     `diff=${v && Math.abs(v.amount - expected)}`);
}

// formatConverted
eq("formatConverted AUTO → empty", formatConverted(10, "USD", AUTO, formatMoney), "");
eq("formatConverted same → empty", formatConverted(10, "USD", "USD", formatMoney), "");
{
  const s = formatConverted(100, "USD", "EUR", (a, c) => `${c} ${a.toFixed(2)}`);
  ok("formatConverted has ≈ prefix", s.startsWith("\u2248 "), `got: ${s}`);
  ok("formatConverted includes target code", /EUR/.test(s), `got: ${s}`);
}

if (fail) { console.error(`\n${fail} failed`); process.exit(1); }
console.log(`\u2713 popup-display-currency (${pass} checks)`);
