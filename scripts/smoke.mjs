// Smoke test: validates manifest.json shape and required files exist.
import fs from "node:fs";
const m = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const must = ["manifest_version","name","version","description"];
for (const k of must) if (!m[k]) { console.error("missing manifest key:", k); process.exit(1); }
if (m.manifest_version !== 3) { console.error("manifest_version must be 3"); process.exit(1); }
for (const p of ["src/popup.html","src/popup.js","src/popup.css","src/background.js"])
  if (!fs.existsSync(p)) { console.error("missing file:", p); process.exit(1); }
for (const sz of [16,32,48,128]) if (!fs.existsSync(`icons/icon-${sz}.png`)) { console.error("missing icon:", sz); process.exit(1); }
if (!Array.isArray(m.content_scripts) || m.content_scripts.length === 0) { console.error("content_scripts missing"); process.exit(1); }
const csFiles = new Set(m.content_scripts.flatMap(cs => cs.js || []));
for (const f of csFiles) if (!fs.existsSync(f)) { console.error("missing content script:", f); process.exit(1); }
if (!fs.existsSync("src/content/common.js")) { console.error("missing src/content/common.js"); process.exit(1); }
for (const m2 of ["amazon","doordash","ubereats","flipkart"]) if (!fs.existsSync(`src/content/${m2}.js`)) { console.error("missing extractor:", m2); process.exit(1); }
if (!fs.existsSync("src/currency.js")) { console.error("missing src/currency.js"); process.exit(1); }
if (!fs.existsSync("src/merchants.js")) { console.error("missing src/merchants.js"); process.exit(1); }
if (!fs.existsSync("src/site-detect.js")) { console.error("missing src/site-detect.js"); process.exit(1); }
if (!fs.existsSync("src/extractor.js")) { console.error("missing src/extractor.js"); process.exit(1); }
if (!fs.existsSync("src/store.js")) { console.error("missing src/store.js"); process.exit(1); }
if (!fs.existsSync("src/popup-display-currency.js")) { console.error("missing src/popup-display-currency.js"); process.exit(1); }
if (!fs.existsSync("src/fx-cache.js")) { console.error("missing src/fx-cache.js"); process.exit(1); }
await import("../tests/site-detect.test.mjs");
await import("../tests/extractor.test.mjs");
await import("../tests/store.test.mjs");
await import("../tests/popup-filters.test.mjs");
await import("../tests/popup-empty.test.mjs");
await import("../tests/popup-drawer.test.mjs");
await import("../tests/popup-display-currency.test.mjs");
await import("../tests/fx-cache.test.mjs");
await import("../tests/extractors/amazon-in.test.mjs");
await import("../tests/extractors/amazon-us.test.mjs");
await import("../tests/extractors/amazon-uk.test.mjs");
await import("../tests/extractors/amazon-ca.test.mjs");
await import("../tests/extractors/flipkart.test.mjs");
await import("../tests/extractors/walmart.test.mjs");
await import("../tests/extractors/target.test.mjs");
await import("../tests/currency.test.mjs");
if (!fs.existsSync("src/extractors/amazon-in.js")) { console.error("missing src/extractors/amazon-in.js"); process.exit(1); }
if (!fs.existsSync("src/extractors/amazon-us.js")) { console.error("missing src/extractors/amazon-us.js"); process.exit(1); }
if (!fs.existsSync("src/extractors/amazon-uk.js")) { console.error("missing src/extractors/amazon-uk.js"); process.exit(1); }
if (!fs.existsSync("src/extractors/amazon-ca.js")) { console.error("missing src/extractors/amazon-ca.js"); process.exit(1); }
if (!fs.existsSync("src/extractors/flipkart.js")) { console.error("missing src/extractors/flipkart.js"); process.exit(1); }
if (!fs.existsSync("src/extractors/walmart.js")) { console.error("missing src/extractors/walmart.js"); process.exit(1); }
if (!fs.existsSync("src/extractors/target.js")) { console.error("missing src/extractors/target.js"); process.exit(1); }
console.log("\u2713 smoke ok");
