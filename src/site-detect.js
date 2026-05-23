// Site detection helper.
// Given the current URL and the merchant registry, returns the matching
// merchant (if any) plus a flag indicating whether the URL looks like
// an order/receipt page for that merchant.
//
// Pure ES module. Safe to import from background, popup, tests, and to
// inline into content scripts via build tooling.

/**
 * Convert a chrome-style match pattern (e.g. "https://www.amazon.in/*")
 * into a RegExp anchored to the start of the URL.
 *
 * Supports `*` as scheme, `*` as host prefix (e.g. `*://*.example.com/*`),
 * and `*` as a wildcard inside the path. Throws on patterns we cannot
 * safely interpret.
 */
export function patternToRegex(pattern) {
  if (typeof pattern !== "string" || !pattern) {
    throw new TypeError("pattern must be a non-empty string");
  }
  // Split into scheme / rest.
  const schemeMatch = pattern.match(/^(\*|https?|file|ftp):\/\//);
  if (!schemeMatch) {
    throw new Error(`unsupported pattern (no scheme): ${pattern}`);
  }
  const scheme = schemeMatch[1];
  const rest = pattern.slice(schemeMatch[0].length);
  const slashIdx = rest.indexOf("/");
  const host = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
  const path = slashIdx === -1 ? "/" : rest.slice(slashIdx);

  const schemeRe = scheme === "*" ? "https?" : scheme;

  // Host: allow leading `*.` for any-subdomain, otherwise exact host.
  let hostRe;
  if (host === "*") {
    hostRe = "[^/]+";
  } else if (host.startsWith("*.")) {
    const tail = escapeRegex(host.slice(2));
    hostRe = `(?:[^/]+\\.)?${tail}`;
  } else {
    hostRe = escapeRegex(host);
  }

  // Path: `*` becomes `.*`; everything else is escaped.
  const pathRe = path
    .split("*")
    .map(escapeRegex)
    .join(".*");

  return new RegExp(`^${schemeRe}://${hostRe}${pathRe}$`);
}

function escapeRegex(str) {
  return str.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Match `url` against a single merchant entry. Returns true if the
 * merchant's `hostPattern` matches the URL.
 */
export function matchesMerchant(url, merchant) {
  if (!merchant || !merchant.hostPattern) return false;
  try {
    return patternToRegex(merchant.hostPattern).test(url);
  } catch {
    return false;
  }
}

/**
 * Returns true if `url`'s path matches the merchant's `orderUrlPattern`
 * glob (using `*` wildcards). Used to decide whether to fire extraction.
 */
export function isOrderUrl(url, merchant) {
  if (!merchant || !merchant.orderUrlPattern) return false;
  let pathname;
  try {
    pathname = new URL(url).pathname + new URL(url).search;
  } catch {
    return false;
  }
  const glob = merchant.orderUrlPattern;
  const re = new RegExp(
    "^" +
      glob
        .split("*")
        .map(escapeRegex)
        .join(".*") +
      "$"
  );
  return re.test(pathname);
}

/**
 * Detect the merchant for a given URL.
 *
 * Strategy: longest-host-match wins, so `https://www.nike.com/in/*` beats
 * `https://www.nike.com/*` for `https://www.nike.com/in/orders`. Ties
 * (same host, both match) are broken by longest `orderUrlPattern`.
 *
 * Returns: `{ merchant, isOrderUrl }` or `{ merchant: null, isOrderUrl: false }`.
 */
export function detectMerchant(url, merchants) {
  if (!url || !Array.isArray(merchants) || merchants.length === 0) {
    return { merchant: null, isOrderUrl: false };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { merchant: null, isOrderUrl: false };
  }

  let best = null;
  let bestScore = -1;

  for (const m of merchants) {
    if (!matchesMerchant(url, m)) continue;
    // Score by host-specificity: longer host pattern wins, then path-prefix
    // length (everything before the first `*`), then order pattern length.
    const hostLen = (extractHost(m.hostPattern) || "").length;
    const pathPrefix = extractPathPrefix(m.hostPattern).length;
    const orderLen = (m.orderUrlPattern || "").length;
    const score = hostLen * 10000 + pathPrefix * 100 + orderLen;
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }

  if (!best) return { merchant: null, isOrderUrl: false };
  return { merchant: best, isOrderUrl: isOrderUrl(url, best) };
}

function extractHost(pattern) {
  const m = pattern.match(/^(?:\*|https?|file|ftp):\/\/([^/]+)/);
  return m ? m[1].replace(/^\*\./, "") : "";
}

function extractPathPrefix(pattern) {
  const m = pattern.match(/^(?:\*|https?|file|ftp):\/\/[^/]+(\/[^*]*)/);
  return m ? m[1] : "";
}

/**
 * Build a `{ hostname: [merchant, ...] }` index for fast lookup. Useful
 * when called repeatedly (e.g. on every navigation event).
 */
export function buildIndex(merchants) {
  const index = new Map();
  for (const m of merchants) {
    const host = extractHost(m.hostPattern);
    if (!host) continue;
    if (!index.has(host)) index.set(host, []);
    index.get(host).push(m);
  }
  return index;
}

/**
 * Same as `detectMerchant` but uses a prebuilt index for O(1) host lookup.
 */
export function detectMerchantIndexed(url, index) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { merchant: null, isOrderUrl: false };
  }
  const host = parsed.hostname;
  const candidates = [];
  if (index.has(host)) candidates.push(...index.get(host));
  // Walk parent domains for any-subdomain matches.
  const parts = host.split(".");
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join(".");
    if (index.has(parent)) candidates.push(...index.get(parent));
  }
  if (candidates.length === 0) return { merchant: null, isOrderUrl: false };

  let best = null;
  let bestScore = -1;
  for (const m of candidates) {
    if (!matchesMerchant(url, m)) continue;
    const pathPrefix = extractPathPrefix(m.hostPattern).length;
    const orderLen = (m.orderUrlPattern || "").length;
    const score = pathPrefix * 100 + orderLen;
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  if (!best) return { merchant: null, isOrderUrl: false };
  return { merchant: best, isOrderUrl: isOrderUrl(url, best) };
}
