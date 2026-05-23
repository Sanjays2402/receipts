// Receipts — popup entry point. List + search + filter UI bound to the store.

import { createStore } from "./store.js";
import { MERCHANTS_BY_ID } from "./merchants.js";
import { formatMoney } from "./currency.js";
import {
  buildFilterOptions,
  buildStoreFilter,
} from "./popup-filters.js";
import { createEmptyState } from "./popup-empty.js";

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
  return createEmptyState({ variant: filtered ? "filtered" : "initial" });
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
    applyTheme(cur, /* persist */ true);
  });

  $("#settings-btn").addEventListener("click", () => {
    // Settings page is a separate roadmap item; surface a minimal hint until then.
    if (chrome?.runtime?.openOptionsPage) chrome.runtime.openOptionsPage();
  });

  // Initial theme: saved preference > system preference > dark default.
  let initial = "dark";
  try {
    const saved = localStorage.getItem("receipts:theme");
    if (saved === "light" || saved === "dark") {
      initial = saved;
    } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
      initial = "light";
    }
  } catch {}
  applyTheme(initial, /* persist */ false);

  // Follow system changes only when user has not pinned a preference.
  try {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = (e) => {
      let pinned = null;
      try { pinned = localStorage.getItem("receipts:theme"); } catch {}
      if (pinned !== "light" && pinned !== "dark") applyTheme(e.matches ? "light" : "dark", false);
    };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
  } catch {}
}

function applyTheme(theme, persist) {
  const t = theme === "light" ? "light" : "dark";
  document.body.dataset.theme = t;
  const btn = document.getElementById("theme-btn");
  if (btn) {
    btn.setAttribute("aria-label", t === "light" ? "Switch to dark theme" : "Switch to light theme");
    btn.title = t === "light" ? "Switch to dark theme" : "Switch to light theme";
    btn.setAttribute("aria-pressed", t === "light" ? "true" : "false");
  }
  if (persist) {
    try { localStorage.setItem("receipts:theme", t); } catch {}
  }
}

document.addEventListener("DOMContentLoaded", () => {
  bind();
  refresh().catch((err) => {
    console.error("[receipts] refresh failed", err);
    $("#root").replaceChildren(renderEmpty(false));
  });
});
