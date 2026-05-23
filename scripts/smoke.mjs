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
await import("../tests/site-detect.test.mjs");
await import("../tests/extractor.test.mjs");
await import("../tests/currency.test.mjs");
console.log("\u2713 smoke ok");
