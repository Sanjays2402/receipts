// Tests for src/popup-empty.js
//
// We avoid pulling in jsdom; instead we supply a tiny Document/Element shim
// that records the structure created. This is sufficient to verify the
// component contract: variants, copy, illustration shape, accessibility hooks.
import assert from "node:assert/strict";
import {
  createEmptyState,
  createEmptyIllustration,
  EMPTY_COPY,
} from "../src/popup-empty.js";

// ── tiny DOM shim ────────────────────────────────────────────────────────
function makeDoc() {
  function makeNode(tag, ns) {
    const node = {
      tagName: String(tag).toUpperCase(),
      namespaceURI: ns || "http://www.w3.org/1999/xhtml",
      children: [],
      attrs: {},
      dataset: {},
      classList: {
        _set: new Set(),
        add(c) { this._set.add(c); node.attrs.class = [...this._set].join(" "); },
        contains(c) { return this._set.has(c); },
      },
      _text: "",
      _html: "",
      appendChild(child) { this.children.push(child); return child; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); },
      get className() { return this.attrs.class || ""; },
      set className(v) { this.attrs.class = String(v); this.classList._set = new Set(String(v).split(/\s+/).filter(Boolean)); },
      get textContent() { return this._text || this.children.map((c) => c.textContent || "").join(""); },
      set textContent(v) { this._text = String(v); this.children = []; },
      get innerHTML() { return this._html; },
      set innerHTML(v) { this._html = String(v); },
    };
    return node;
  }
  return {
    createElement(tag) { return makeNode(tag, "http://www.w3.org/1999/xhtml"); },
    createElementNS(ns, tag) { return makeNode(tag, ns); },
  };
}

function findAll(node, pred, out = []) {
  if (pred(node)) out.push(node);
  for (const c of node.children || []) findAll(c, pred, out);
  return out;
}

// ── illustration ─────────────────────────────────────────────────────────
{
  const doc = makeDoc();
  const svg = createEmptyIllustration({ doc });
  assert.equal(svg.tagName, "SVG", "illustration is an <svg>");
  assert.equal(svg.namespaceURI, "http://www.w3.org/2000/svg", "SVG namespace");
  assert.equal(svg.getAttribute("viewBox"), "0 0 120 120", "viewBox set");
  assert.equal(svg.getAttribute("stroke"), "currentColor", "stroke uses currentColor");
  assert.equal(svg.getAttribute("stroke-width"), "1.5", "Phosphor-style stroke width");
  assert.equal(svg.getAttribute("stroke-linecap"), "round", "round linecap");
  assert.equal(svg.getAttribute("aria-hidden"), "true", "decorative");
  assert.equal(svg.getAttribute("focusable"), "false", "not focusable");
  assert.ok(svg.classList.contains("empty-illustration"), "carries class");
  const html = svg.innerHTML;
  assert.ok(/<path /.test(html), "has path elements");
  assert.ok(/<circle /.test(html), "has check-mark circle");
  assert.ok(/linearGradient/.test(html), "has soft inner highlight gradient");
  // Receipt outline should describe a torn/zig-zag bottom edge.
  assert.ok(/L42 98 L50 104/.test(html), "torn-edge geometry preserved");
}

// ── variants & copy ──────────────────────────────────────────────────────
for (const variant of ["initial", "filtered"]) {
  const doc = makeDoc();
  const root = createEmptyState({ variant, doc });
  assert.equal(root.tagName, "DIV", "container div");
  assert.equal(root.className, "empty", "uses .empty");
  assert.equal(root.dataset.variant, variant, "variant on dataset");
  assert.equal(root.getAttribute("role"), "status", "a11y role");
  assert.equal(root.getAttribute("aria-live"), "polite", "a11y live region");

  const svgs = findAll(root, (n) => n.tagName === "SVG");
  assert.equal(svgs.length, 1, "exactly one illustration");

  const titles = findAll(root, (n) => n.className === "empty-title");
  const subs = findAll(root, (n) => n.className === "empty-sub");
  assert.equal(titles.length, 1, "one title");
  assert.equal(subs.length, 1, "one subtitle");
  assert.equal(titles[0].textContent, EMPTY_COPY[variant].title);
  assert.equal(subs[0].textContent, EMPTY_COPY[variant].sub);

  // No emoji anywhere in the rendered copy. Phosphor-only.
  const allText = titles[0].textContent + " " + subs[0].textContent;
  assert.ok(!/\p{Extended_Pictographic}/u.test(allText), "no emoji in empty-state copy");
}

// Unknown variant falls back to "initial".
{
  const doc = makeDoc();
  const root = createEmptyState({ variant: "bogus", doc });
  assert.equal(root.dataset.variant, "initial", "unknown variant => initial");
  const titles = findAll(root, (n) => n.className === "empty-title");
  assert.equal(titles[0].textContent, EMPTY_COPY.initial.title);
}

// Default (no variant) is "initial".
{
  const doc = makeDoc();
  const root = createEmptyState({ doc });
  assert.equal(root.dataset.variant, "initial");
}

// Copy table is frozen so accidental mutation in tests/runtime fails loudly.
{
  assert.throws(() => { EMPTY_COPY.initial = { title: "x", sub: "y" }; }, "EMPTY_COPY frozen");
}

console.log("\u2713 popup-empty");
