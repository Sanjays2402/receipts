// Receipts — empty state component.
//
// Two variants:
//   • variant="initial"  — no receipts in the library yet
//   • variant="filtered" — has receipts, but current filters match none
//
// Renders a hand-drawn-feeling receipt illustration (inline SVG, Phosphor-style
// stroke), a title, and a sub-line. No emoji. Accessible: the SVG is marked
// decorative; the text carries the message.

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Build the hand-drawn-feeling SVG illustration. Returns an SVGSVGElement.
 * The illustration is a torn-edge receipt with subtle line items and a
 * dashed check-circle to suggest "captured".
 *
 * @param {{ doc?: Document }} [opts]
 */
export function createEmptyIllustration(opts = {}) {
  const doc = opts.doc || document;
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 120 120");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("empty-illustration");

  // Inner markup as a single string keeps this declarative and easy to tweak.
  // The linear gradient gives the receipt a soft inner highlight.
  svg.innerHTML = `
    <defs>
      <linearGradient id="receipts-empty-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="currentColor" stop-opacity="0.10"/>
        <stop offset="100%" stop-color="currentColor" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    <path d="M34 16 L34 104 L42 98 L50 104 L58 98 L66 104 L74 98 L82 104 L82 16 L74 22 L66 16 L58 22 L50 16 L42 22 Z"
          fill="url(#receipts-empty-fill)" stroke="currentColor"/>
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

/**
 * Copy for the empty state. Exported so tests can lock the variants.
 */
export const EMPTY_COPY = Object.freeze({
  initial: {
    title: "No receipts yet",
    sub: "Visit a supported store's order page — Amazon, DoorDash, Flipkart and more — and your receipts will land here.",
  },
  filtered: {
    title: "No receipts match your filters",
    sub: "Try clearing the search or widening the date range.",
  },
});

/**
 * Build the empty state element.
 *
 * @param {object} [opts]
 * @param {"initial"|"filtered"} [opts.variant]
 * @param {Document} [opts.doc]
 * @returns {HTMLElement}
 */
export function createEmptyState(opts = {}) {
  const variant = opts.variant === "filtered" ? "filtered" : "initial";
  const doc = opts.doc || document;
  const copy = EMPTY_COPY[variant];

  const root = doc.createElement("div");
  root.className = "empty";
  root.dataset.variant = variant;
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");

  root.appendChild(createEmptyIllustration({ doc }));

  const title = doc.createElement("div");
  title.className = "empty-title";
  title.textContent = copy.title;
  root.appendChild(title);

  const sub = doc.createElement("div");
  sub.className = "empty-sub";
  sub.textContent = copy.sub;
  root.appendChild(sub);

  return root;
}
