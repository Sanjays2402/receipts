// Receipts — popup entry point. List + search + filter UI bound to the store.

import { createStore } from "./store.js";
import { MERCHANTS_BY_ID } from "./merchants.js";
import { formatMoney } from "./currency.js";
import {
  buildFilterOptions,
  buildStoreFilter,
} from "./popup-filters.js";

const store = createStore();
const ui = { q: "", merchantId: "*", country: "*", currency: "*", dateFrom: "", dateTo: "" };
let searchTimer = null;

// ── helpers ───────────────────────────────────────────────────────────────
function $(sel, root = document) { return root.querySelector(sel); }
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

function initials(name) {
  const s = String(name || "").trim();
  if (!s) return "?";
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function fmtDate(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtMoney(amount, currency) {
  try { return formatMoney(amount, currency); }
  catch { return `${currency} ${Number(amount).toFixed(2)}`; }
}

// ── rendering ─────────────────────────────────────────────────────────────
function renderEmpty(filtered) {
  return el("div", { class: "empty" },
    svgIllustration(),
    el("div", { class: "empty-title" }, filtered ? "No receipts match your filters" : "No receipts yet"),
    el("div", { class: "empty-sub" },
      filtered
        ? "Try clearing the search or widening the date range."
        : "Visit a supported store's order page — Amazon, DoorDash, Flipkart and more — and your receipts will land here."),
  );
}

function svgIllustration() {
  // Hand-drawn-feeling receipt illustration.
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 120 120");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.innerHTML = `
    <defs>
      <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="currentColor" stop-opacity="0.10"/>
        <stop offset="100%" stop-color="currentColor" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    <path d="M34 16 L34 104 L42 98 L50 104 L58 98 L66 104 L74 98 L82 104 L82 16 L74 22 L66 16 L58 22 L50 16 L42 22 Z"
          fill="url(#rg)" stroke="currentColor"/>
    <path d="M44 34 H72" opacity="0.7"/>
    <path d="M44 44 H68" opacity="0.55"/>
    <path d="M44 54 H70" opacity="0.55"/>
    <path d="M44 64 H60" opacity="0.45"/>
    <path d="M44 78 H56" opacity="0.7"/>
    <path d="M62 78 H72" opacity="0.7"/>
    <circle cx="92" cy="86" r="14" stroke-dasharray="2 3" opacity="0.55"/>
    <path d="M86 86 L91 91 L99 82" opacity="0.85"/>
  `;
  return svg;
}

function renderCard(r) {
  const merchant = MERCHANTS_BY_ID[r.merchantId];
  const name = merchant?.name || r.merchantId;
  const country = merchant?.country || "—";
  const dateText = fmtDate(r.date);
  const total = fmtMoney(r.total, r.currency);

  return el("article", { class: "card", role: "button", tabindex: "0", dataset: { id: r.id } },
    el("div", { class: "card-icon", "aria-hidden": "true" }, initials(name)),
    el("div", { class: "card-body" },
      el("div", { class: "card-line1" },
        el("div", { class: "card-merchant" }, name),
        el("div", { class: "card-total" }, total),
      ),
      el("div", { class: "card-line2" },
        el("span", {}, country),
        el("span", { class: "dot" }),
        el("span", {}, r.currency),
        el("span", { class: "dot" }),
        el("span", {}, dateText),
      ),
    ),
  );
}

function populateFilterSelects(receipts) {
  const opts = buildFilterOptions(receipts);
  const setOpts = (sel, list, makeLabel) => {
    const current = sel.value;
    sel.innerHTML = "";
    sel.append(el("option", { value: "*" }, "All"));
    for (const v of list) {
      const o = typeof v === "string" ? { id: v, label: makeLabel ? makeLabel(v) : v } : v;
      sel.append(el("option", { value: o.id }, o.label));
    }
    // Preserve selection if still valid.
    if ([...sel.options].some((o) => o.value === current)) sel.value = current;
  };
  setOpts($("#f-merchant"), opts.merchants);
  setOpts($("#f-country"), opts.countries);
  setOpts($("#f-currency"), opts.currencies);
}

async function refresh() {
  const root = $("#root");
  const filter = buildStoreFilter(ui);
  // For accurate "filtered vs empty" messaging and to keep filter selects
  // representative of the whole library, pull the full list once.
  const all = await store.list({});
  populateFilterSelects(all);
  const matches = await store.list(filter, { sort: { field: "date", dir: "desc" } });

  root.replaceChildren();
  if (matches.length === 0) {
    root.append(renderEmpty(all.length > 0));
  } else {
    for (const r of matches) root.append(renderCard(r));
  }

  $("#result-count").textContent = `${matches.length} of ${all.length}`;
}

// ── wiring ────────────────────────────────────────────────────────────────
function bind() {
  $("#q").addEventListener("input", (e) => {
    ui.q = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(refresh, 120);
  });

  $("#filter-toggle").addEventListener("click", (e) => {
    const panel = $("#filter-panel");
    const open = panel.hasAttribute("hidden");
    if (open) panel.removeAttribute("hidden"); else panel.setAttribute("hidden", "");
    e.currentTarget.setAttribute("aria-expanded", open ? "true" : "false");
  });

  for (const [id, key] of [
    ["#f-merchant", "merchantId"],
    ["#f-country",  "country"],
    ["#f-currency", "currency"],
    ["#f-from",     "dateFrom"],
    ["#f-to",       "dateTo"],
  ]) {
    $(id).addEventListener("change", (e) => { ui[key] = e.target.value; refresh(); });
  }

  $("#f-reset").addEventListener("click", () => {
    ui.q = ""; ui.merchantId = "*"; ui.country = "*"; ui.currency = "*"; ui.dateFrom = ""; ui.dateTo = "";
    $("#q").value = "";
    for (const id of ["#f-merchant", "#f-country", "#f-currency"]) $(id).value = "*";
    $("#f-from").value = ""; $("#f-to").value = "";
    refresh();
  });

  $("#theme-btn").addEventListener("click", () => {
    const cur = document.body.dataset.theme === "light" ? "dark" : "light";
    document.body.dataset.theme = cur;
    try { localStorage.setItem("receipts:theme", cur); } catch {}
  });

  $("#settings-btn").addEventListener("click", () => {
    // Settings page is a separate roadmap item; surface a minimal hint until then.
    if (chrome?.runtime?.openOptionsPage) chrome.runtime.openOptionsPage();
  });

  try {
    const saved = localStorage.getItem("receipts:theme");
    if (saved === "light" || saved === "dark") document.body.dataset.theme = saved;
  } catch {}
}

document.addEventListener("DOMContentLoaded", () => {
  bind();
  refresh().catch((err) => {
    console.error("[receipts] refresh failed", err);
    $("#root").replaceChildren(renderEmpty(false));
  });
});
