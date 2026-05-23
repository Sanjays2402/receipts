// Tests for src/popup-drawer.js
//
// Uses the same lightweight DOM shim style as popup-empty.test.mjs — no jsdom.
import assert from "node:assert/strict";
import {
  createReceiptDrawer,
  computeItemsSubtotal,
  formatRawSnapshot,
  formatDrawerDate,
} from "../src/popup-drawer.js";

// ── tiny DOM shim ────────────────────────────────────────────────────────
function makeDoc() {
  const listeners = new Set();
  function makeNode(tag, ns) {
    const node = {
      tagName: String(tag).toUpperCase(),
      namespaceURI: ns || "http://www.w3.org/1999/xhtml",
      children: [],
      attrs: {},
      dataset: {},
      _listeners: {},
      _text: "",
      _html: "",
      classList: {
        _set: new Set(),
        add(c) { this._set.add(c); node.attrs.class = [...this._set].join(" "); },
        contains(c) { return this._set.has(c); },
      },
      appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
      replaceChildren(...kids) {
        this.children = [];
        for (const k of kids) if (k) this.appendChild(k);
      },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      removeAttribute(k) { delete this.attrs[k]; },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); },
      addEventListener(ev, fn) { (this._listeners[ev] ||= []).push(fn); },
      removeEventListener(ev, fn) {
        const arr = this._listeners[ev] || [];
        this._listeners[ev] = arr.filter((f) => f !== fn);
      },
      dispatchEvent(ev) {
        const fns = this._listeners[ev.type] || [];
        for (const fn of fns) fn(ev);
      },
      focus() { doc.activeElement = node; node._focused = true; },
      get className() { return this.attrs.class || ""; },
      set className(v) { this.attrs.class = String(v); this.classList._set = new Set(String(v).split(/\s+/).filter(Boolean)); },
      get textContent() { return this._text || this.children.map((c) => c.textContent || "").join(""); },
      set textContent(v) { this._text = String(v); this.children = []; },
      get innerHTML() { return this._html; },
      set innerHTML(v) { this._html = String(v); },
    };
    return node;
  }
  const doc = {
    activeElement: null,
    _listeners: {},
    body: null,
    createElement(tag) { return makeNode(tag, "http://www.w3.org/1999/xhtml"); },
    createElementNS(ns, tag) { return makeNode(ns === "http://www.w3.org/2000/svg" ? "svg" : tag, ns); },
    createTextNode(t) { return { tagName: "#text", textContent: String(t), children: [] }; },
    addEventListener(ev, fn) { (this._listeners[ev] ||= []).push(fn); listeners.add(fn); },
    removeEventListener(ev, fn) {
      const arr = this._listeners[ev] || [];
      this._listeners[ev] = arr.filter((f) => f !== fn);
      listeners.delete(fn);
    },
    _fire(ev) {
      const fns = this._listeners[ev.type] || [];
      for (const fn of fns) fn(ev);
    },
  };
  doc.body = doc.createElement("body");
  return doc;
}

function findAll(node, pred, out = []) {
  if (pred(node)) out.push(node);
  for (const c of node.children || []) findAll(c, pred, out);
  return out;
}
function findFirst(node, pred) {
  const r = findAll(node, pred);
  return r[0];
}

// ── computeItemsSubtotal ─────────────────────────────────────────────────
{
  assert.equal(computeItemsSubtotal(null), null);
  assert.equal(computeItemsSubtotal([]), null);
  assert.equal(computeItemsSubtotal([{ name: "x" }]), null, "no lineTotals => null");
  assert.equal(computeItemsSubtotal([{ lineTotal: 1.10 }, { lineTotal: 2.25 }]), 3.35);
  // ignores non-numeric, sums the rest
  assert.equal(computeItemsSubtotal([{ lineTotal: 5 }, { lineTotal: "x" }, { lineTotal: 1.5 }]), 6.5);
}

// ── formatRawSnapshot ────────────────────────────────────────────────────
{
  assert.equal(formatRawSnapshot(null), "");
  assert.equal(formatRawSnapshot("<html/>"), "<html/>");
  const out = formatRawSnapshot({ a: 1 });
  assert.ok(out.includes("\"a\": 1"), "pretty JSON");
  // Circular safe
  const c = {}; c.self = c;
  assert.equal(typeof formatRawSnapshot(c), "string", "circular handled");
}

// ── formatDrawerDate ─────────────────────────────────────────────────────
{
  assert.equal(formatDrawerDate(""), "");
  assert.equal(formatDrawerDate("not-a-date"), "not-a-date");
  const out = formatDrawerDate("2026-05-23T00:00:00Z");
  assert.ok(out.length > 0, "renders a date");
}

// ── drawer open/close lifecycle ──────────────────────────────────────────
{
  const doc = makeDoc();
  const drawer = createReceiptDrawer({
    container: doc.body,
    doc,
    getMerchant: (id) => ({ "amazon-us": { name: "Amazon US", country: "US" } }[id]),
    formatMoney: (a, c) => `${c} ${a.toFixed(2)}`,
  });

  // Mounted into container
  assert.ok(doc.body.children.includes(drawer.element), "drawer mounted");
  assert.ok(drawer.element.hasAttribute("hidden"), "starts hidden");
  assert.equal(drawer.isOpen(), false);

  const receipt = {
    id: "r1",
    merchantId: "amazon-us",
    date: "2026-05-23T00:00:00Z",
    total: 12.50,
    currency: "USD",
    items: [
      { name: "Book", qty: 1, unitPrice: 9.00, lineTotal: 9.00 },
      { name: "Pen", qty: 2, unitPrice: 1.50, lineTotal: 3.00 },
    ],
    raw: { url: "https://amazon.com/orders/r1", html: "<div/>" },
  };

  // Simulate an opener element with focus()
  const opener = doc.createElement("button");
  opener._focused = false;
  opener.focus = function () { this._focused = true; doc.activeElement = this; };

  drawer.open(receipt, { returnFocus: opener });
  assert.equal(drawer.isOpen(), true, "open() sets visible");
  assert.equal(drawer.element.dataset.open, "true");
  assert.equal(drawer.element.getAttribute("role"), "dialog");
  assert.equal(drawer.element.getAttribute("aria-modal"), "true");

  // Title and meta rendered
  const title = findFirst(drawer.element, (n) => n.className === "drawer-title");
  assert.equal(title.textContent, "Amazon US");
  const meta = findFirst(drawer.element, (n) => n.className === "drawer-meta");
  assert.ok(/US/.test(meta.textContent), "meta has country");
  assert.ok(/USD/.test(meta.textContent), "meta has currency");

  // Items rendered
  const items = findAll(drawer.element, (n) => n.className === "drawer-item");
  assert.equal(items.length, 2, "two item rows");

  // Totals rendered with formatted money
  const totals = findFirst(drawer.element, (n) => n.className === "drawer-totals");
  assert.ok(/USD 12\.50/.test(totals.textContent), "grand total formatted");

  // Raw source collapsible present
  const raw = findFirst(drawer.element, (n) => n.className === "drawer-raw");
  assert.ok(raw, "raw section rendered");
  const pre = findFirst(raw, (n) => n.className === "drawer-raw-body");
  assert.ok(/amazon\.com\/orders\/r1/.test(pre.textContent), "raw includes captured URL");

  // Esc closes
  doc._fire({ type: "keydown", key: "Escape", preventDefault() {} });
  assert.equal(drawer.isOpen(), false, "Esc closes");
  assert.equal(opener._focused, true, "focus returned to opener");

  // Reopening works, backdrop click closes
  drawer.open(receipt);
  assert.equal(drawer.isOpen(), true);
  drawer.backdrop.dispatchEvent({ type: "click", preventDefault() {} });
  assert.equal(drawer.isOpen(), false, "backdrop click closes");
}

// ── empty items + no extra subtotal row when sub === total ──────────────
{
  const doc = makeDoc();
  const drawer = createReceiptDrawer({
    container: doc.body,
    doc,
    getMerchant: () => undefined,
    formatMoney: (a, c) => `${c} ${a.toFixed(2)}`,
  });

  drawer.open({
    id: "r2",
    merchantId: "unknown",
    date: "2026-05-23T00:00:00Z",
    total: 5,
    currency: "USD",
    items: [], // empty
    raw: {},
  });

  const empty = findFirst(drawer.element, (n) => n.className === "drawer-empty");
  assert.ok(empty, "empty-items message shown");

  // Only the grand total row; no "Items subtotal" dt.
  const dts = findAll(drawer.element, (n) => n.tagName === "DT");
  assert.equal(dts.length, 1, "single dt (grand total only)");
  assert.equal(dts[0].textContent, "Total");
  drawer.close();
}

// ── No emoji anywhere in rendered chrome copy ───────────────────────────
{
  const doc = makeDoc();
  const drawer = createReceiptDrawer({
    container: doc.body,
    doc,
    getMerchant: () => ({ name: "Test Store", country: "IN" }),
    formatMoney: (a, c) => `${c} ${a.toFixed(2)}`,
  });
  drawer.open({
    id: "r3", merchantId: "test", date: "2026-01-01", total: 1, currency: "INR",
    items: [{ name: "Tea", lineTotal: 1 }], raw: { ok: true },
  });
  const text = findAll(drawer.element, (n) => typeof n.textContent === "string" && n.tagName !== "#text")
    .map((n) => n.textContent).join(" ");
  assert.ok(!/\p{Extended_Pictographic}/u.test(text), "no emoji in drawer chrome");
}

console.log("\u2713 popup-drawer");
