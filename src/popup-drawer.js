// Receipts — receipt detail drawer.
//
// Renders a slide-over drawer for a single Receipt with:
//   • header: merchant name, country/currency/date, close button
//   • line items list (qty × name → unitPrice / lineTotal)
//   • totals block (items subtotal when derivable + grand total)
//   • raw source snapshot (collapsed by default; <pre> with the JSON, or the
//     captured HTML rendered as inert text)
//
// Pure DOM. No emoji. Phosphor-style inline SVG. Accessible:
//   role="dialog", aria-modal, aria-labelledby, Esc closes, focus moves to
//   the close button on open, focus returns to the opener on close.
//
// Public API:
//   const drawer = createReceiptDrawer({ container, getMerchant, formatMoney });
//   drawer.open(receipt, { returnFocus });
//   drawer.close();
//   drawer.isOpen() -> boolean
//   drawer.element  -> root DOM node (already attached to container)
//
// Exports also expose the pure helpers for tests.

import { convertedView } from "./popup-display-currency.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// ── pure helpers (exported) ──────────────────────────────────────────────

/** Sum of `lineTotal` across items that declare one; null if none do. */
export function computeItemsSubtotal(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  let any = false;
  let sum = 0;
  for (const it of items) {
    if (it && Number.isFinite(Number(it.lineTotal))) {
      any = true;
      sum += Number(it.lineTotal);
    }
  }
  if (!any) return null;
  return Math.round(sum * 100) / 100;
}

/** Stringify the receipt's raw snapshot for display. */
export function formatRawSnapshot(raw) {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  try { return JSON.stringify(raw, null, 2); }
  catch { return String(raw); }
}

/** Format an ISO date for the drawer header. Falls back to the input. */
export function formatDrawerDate(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return String(iso || "");
  return new Date(t).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

// ── DOM builders (internal) ──────────────────────────────────────────────

function svgEl(doc, attrs, inner) {
  const s = doc.createElementNS(SVG_NS, "svg");
  s.setAttribute("viewBox", attrs.viewBox || "0 0 24 24");
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "1.5");
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("focusable", "false");
  if (inner) s.innerHTML = inner;
  return s;
}

const ICON_CLOSE = `<path d="M6 6 L18 18"/><path d="M18 6 L6 18"/>`;
const ICON_CHEVRON = `<path d="M9 6 l6 6 -6 6"/>`;
const ICON_RECEIPT = `<path d="M6 3v18l2-1.5L10 21l2-1.5L14 21l2-1.5L18 21V3l-2 1.5L14 3l-2 1.5L10 3 8 4.5 6 3Z"/><path d="M9 8h6"/><path d="M9 12h6"/><path d="M9 16h4"/>`;

function el(doc, tag, attrs = {}, ...children) {
  const node = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    if (typeof c === "string" || typeof c === "number") node.appendChild(doc.createTextNode(String(c)));
    else node.appendChild(c);
  }
  return node;
}

// ── factory ──────────────────────────────────────────────────────────────

/**
 * @param {{
 *   container?: HTMLElement,
 *   doc?: Document,
 *   getMerchant?: (id: string) => ({ name?: string, country?: string } | undefined),
 *   formatMoney?: (amount: number, currency: string) => string,
 * }} [opts]
 */
export function createReceiptDrawer(opts = {}) {
  const doc = opts.doc || (typeof document !== "undefined" ? document : null);
  if (!doc) throw new Error("createReceiptDrawer: no document available");
  const container = opts.container || doc.body;
  const getMerchant = opts.getMerchant || (() => undefined);
  const fmtMoney = opts.formatMoney || ((a, c) => `${c} ${Number(a).toFixed(2)}`);
  let displayCurrency = opts.displayCurrency || null;

  function fmtConverted(amount, currency) {
    const v = convertedView(amount, currency, displayCurrency);
    if (!v) return "";
    return `\u2248 ${fmtMoney(v.amount, v.currency)}`;
  }

  let returnFocusEl = null;
  let titleId = `receipts-drawer-title-${Math.random().toString(36).slice(2, 8)}`;

  // Backdrop + drawer
  const backdrop = el(doc, "div", {
    class: "drawer-backdrop",
    hidden: true,
    "aria-hidden": "true",
  });

  const closeBtn = el(doc, "button", {
    type: "button",
    class: "icon-btn drawer-close",
    title: "Close",
    "aria-label": "Close receipt details",
  }, svgEl(doc, {}, ICON_CLOSE));

  const headerTitle = el(doc, "h2", { class: "drawer-title", id: titleId });
  const headerMeta = el(doc, "div", { class: "drawer-meta" });

  const body = el(doc, "div", { class: "drawer-body" });

  const drawer = el(doc, "aside", {
    class: "drawer glass",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": titleId,
    tabindex: "-1",
    hidden: true,
  },
    el(doc, "header", { class: "drawer-header" },
      el(doc, "div", { class: "drawer-header-text" },
        el(doc, "div", { class: "drawer-eyebrow" },
          svgEl(doc, {}, ICON_RECEIPT),
          el(doc, "span", {}, "Receipt details"),
        ),
        headerTitle,
        headerMeta,
      ),
      closeBtn,
    ),
    body,
  );

  container.appendChild(backdrop);
  container.appendChild(drawer);

  // ── handlers ────────────────────────────────────────────────────────
  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }
  function onBackdrop(e) { e.preventDefault(); close(); }
  closeBtn.addEventListener("click", () => close());
  backdrop.addEventListener("click", onBackdrop);

  function setOpenAttrs(open) {
    if (open) {
      drawer.removeAttribute("hidden");
      backdrop.removeAttribute("hidden");
      drawer.dataset.open = "true";
      backdrop.dataset.open = "true";
      doc.addEventListener("keydown", onKey);
    } else {
      drawer.setAttribute("hidden", "");
      backdrop.setAttribute("hidden", "");
      delete drawer.dataset.open;
      delete backdrop.dataset.open;
      doc.removeEventListener("keydown", onKey);
    }
  }

  function renderItems(items, currency) {
    if (!Array.isArray(items) || items.length === 0) {
      return el(doc, "div", { class: "drawer-empty" },
        el(doc, "span", {}, "No line items captured."),
      );
    }
    const list = el(doc, "ul", { class: "drawer-items", role: "list" });
    for (const it of items) {
      const qty = Number.isFinite(Number(it.qty)) ? Number(it.qty) : null;
      const unit = Number.isFinite(Number(it.unitPrice)) ? Number(it.unitPrice) : null;
      const line = Number.isFinite(Number(it.lineTotal)) ? Number(it.lineTotal) : null;

      const nameNode = el(doc, "div", { class: "item-name" },
        qty && qty !== 1 ? el(doc, "span", { class: "item-qty" }, `${qty}×`) : null,
        el(doc, "span", {}, it.name || "Item"),
      );

      const priceNode = el(doc, "div", { class: "item-price" },
        line != null
          ? el(doc, "span", { class: "item-line-total" }, fmtMoney(line, currency))
          : (unit != null ? el(doc, "span", { class: "item-line-total" }, fmtMoney(unit, currency)) : null),
        unit != null && line != null && qty && qty !== 1
          ? el(doc, "span", { class: "item-unit" }, `${fmtMoney(unit, currency)} ea`)
          : null,
        (() => {
          const base = line != null ? line : unit;
          if (base == null) return null;
          const text = fmtConverted(base, currency);
          return text ? el(doc, "span", { class: "item-converted" }, text) : null;
        })(),
      );

      list.appendChild(el(doc, "li", { class: "drawer-item" }, nameNode, priceNode));
    }
    return list;
  }

  function renderTotals(receipt) {
    const sub = computeItemsSubtotal(receipt.items);
    const rows = el(doc, "dl", { class: "drawer-totals" });
    if (sub != null && Math.abs(sub - receipt.total) > 0.005) {
      rows.appendChild(el(doc, "dt", {}, "Items subtotal"));
      rows.appendChild(el(doc, "dd", {}, fmtMoney(sub, receipt.currency)));
    }
    rows.appendChild(el(doc, "dt", { class: "is-grand" }, "Total"));
    const grandValue = el(doc, "dd", { class: "is-grand" }, fmtMoney(receipt.total, receipt.currency));
    const convertedText = fmtConverted(receipt.total, receipt.currency);
    if (convertedText) {
      grandValue.appendChild(el(doc, "span", { class: "is-grand-converted" }, convertedText));
    }
    rows.appendChild(grandValue);
    return rows;
  }

  function renderRaw(receipt) {
    const text = formatRawSnapshot(receipt.raw);
    if (!text) return null;
    const details = el(doc, "details", { class: "drawer-raw" });
    const summary = el(doc, "summary", { class: "drawer-raw-summary" },
      svgEl(doc, {}, ICON_CHEVRON),
      el(doc, "span", {}, "Raw source"),
      el(doc, "span", { class: "drawer-raw-hint" }, `${text.length.toLocaleString()} chars`),
    );
    details.appendChild(summary);
    const pre = el(doc, "pre", { class: "drawer-raw-body" });
    pre.appendChild(doc.createTextNode(text));
    details.appendChild(pre);
    return details;
  }

  // ── public API ──────────────────────────────────────────────────────
  function open(receipt, options = {}) {
    if (!receipt || typeof receipt !== "object") return;
    returnFocusEl = options.returnFocus || (doc.activeElement || null);

    const merchant = getMerchant(receipt.merchantId) || {};
    const name = merchant.name || receipt.merchantId || "Receipt";
    headerTitle.textContent = name;

    headerMeta.replaceChildren();
    const country = merchant.country || "—";
    const dateText = formatDrawerDate(receipt.date);
    const parts = [country, receipt.currency, dateText];
    parts.forEach((p, i) => {
      if (i > 0) headerMeta.appendChild(el(doc, "span", { class: "dot", "aria-hidden": "true" }));
      headerMeta.appendChild(el(doc, "span", {}, String(p || "—")));
    });

    body.replaceChildren();

    body.appendChild(el(doc, "section", { class: "drawer-section" },
      el(doc, "h3", { class: "drawer-section-title" }, "Items"),
      renderItems(receipt.items, receipt.currency),
    ));

    body.appendChild(el(doc, "section", { class: "drawer-section" },
      renderTotals(receipt),
    ));

    const raw = renderRaw(receipt);
    if (raw) {
      body.appendChild(el(doc, "section", { class: "drawer-section" },
        el(doc, "h3", { class: "drawer-section-title" }, "Source"),
        raw,
      ));
    }

    setOpenAttrs(true);
    try { closeBtn.focus(); } catch {}
  }

  function close() {
    if (drawer.hasAttribute("hidden")) return;
    setOpenAttrs(false);
    if (returnFocusEl && typeof returnFocusEl.focus === "function") {
      try { returnFocusEl.focus(); } catch {}
    }
    returnFocusEl = null;
  }

  function isOpen() { return !drawer.hasAttribute("hidden"); }

  return { element: drawer, backdrop, open, close, isOpen, setDisplayCurrency(c) { displayCurrency = c || null; } };
}
