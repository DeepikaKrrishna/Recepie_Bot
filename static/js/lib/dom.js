// Tiny DOM toolkit. All dynamic text goes through textContent / text nodes;
// HTML strings are never parsed from data, so recipe or user text can't inject markup.

const SVG_NS = "http://www.w3.org/2000/svg";

function apply(el, props) {
  if (!props) return el;
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") el.setAttribute("class", value);
    else if (key === "text") el.textContent = value;
    else if (key === "style" && typeof value === "object") {
      for (const [prop, v] of Object.entries(value)) el.style.setProperty(prop, v);
    } else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "ref" && typeof value === "function") value(el);
    else if (key in el && typeof value !== "string" && key !== "list") el[key] = value;
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Create an HTML element: h("div", {class: "x", onClick}, "text", child). */
export function h(tag, props, ...children) {
  return append(apply(document.createElement(tag), props), children);
}

/** Create an SVG element. */
export function s(tag, props, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === "class") el.setAttribute("class", value);
      else if (key === "text") el.textContent = value;
      else if (key === "style" && typeof value === "object") {
        for (const [prop, v] of Object.entries(value)) el.style.setProperty(prop, v);
      } else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
      else el.setAttribute(key, String(value));
    }
  }
  return append(el, children);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function mount(el, ...children) {
  clear(el);
  return append(el, children);
}

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Index-based stagger for entrance animations. */
export function stagger(el, i) {
  el.classList.add("rise");
  el.style.setProperty("--i", String(i));
  return el;
}

/** Material-ish ripple on buttons. */
export function ripple(e) {
  const btn = e.currentTarget;
  if (reducedMotion() || !btn.getBoundingClientRect) return;
  const r = btn.getBoundingClientRect();
  const size = Math.max(r.width, r.height);
  const dot = h("span", { class: "ripple", style: { width: `${size}px`, height: `${size}px`, left: `${e.clientX - r.left - size / 2}px`, top: `${e.clientY - r.top - size / 2}px` } });
  btn.append(dot);
  setTimeout(() => dot.remove(), 650);
}

/** Animate a number counting up. */
export function countUp(el, to, ms = 900) {
  if (reducedMotion() || !to) { el.textContent = String(to); return; }
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / ms);
    el.textContent = String(Math.round(to * (1 - Math.pow(1 - t, 3))));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
