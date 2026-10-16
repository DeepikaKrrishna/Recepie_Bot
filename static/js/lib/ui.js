// Shared UI pieces: mascot, cooking loader, toasts, dialogs, empty states,
// chip inputs, confetti and view transitions.
import { $, clear, h, reducedMotion, ripple, s } from "./dom.js";
import { emojiFor } from "./food.js";
import { icon } from "./icons.js";

// ---------------------------------------------------------------- mascot
/** "Pot-bot": the Recipe Bot mascot. */
export function mascot({ size = 120, flames = false, falling = false, cls = "" } = {}) {
  return s("svg", { viewBox: "0 0 150 130", width: size, height: size * 130 / 150, class: `mascot ${cls}`, "aria-hidden": "true" },
    s("path", { class: "steam", d: "M58 34c-6-6 6-10 0-18" }),
    s("path", { class: "steam", d: "M75 30c-6-6 6-10 0-18" }),
    s("path", { class: "steam", d: "M92 34c-6-6 6-10 0-18" }),
    falling ? ["🧅", "🍅", "🌿"].map((e, i) => s("text", { class: "float-ing", x: 50 + i * 25, y: 40, style: { "animation-delay": `${i * 0.8}s` } }, e)) : null,
    s("g", { class: "pot-lid" },
      s("rect", { x: 66, y: 34, width: 18, height: 8, rx: 4 }),
      s("path", { d: "M30 54c0-9 20-14 45-14s45 5 45 14Z" })),
    s("rect", { class: "pot-body", x: 26, y: 54, width: 98, height: 58, rx: 22 }),
    s("rect", { class: "pot-body", x: 14, y: 62, width: 18, height: 10, rx: 5 }),
    s("rect", { class: "pot-body", x: 118, y: 62, width: 18, height: 10, rx: 5 }),
    s("ellipse", { class: "pot-eye", cx: 60, cy: 80, rx: 6, ry: 8 }),
    s("ellipse", { class: "pot-eye", cx: 90, cy: 80, rx: 6, ry: 8 }),
    s("circle", { cx: 50, cy: 94, r: 5, fill: "#ff8a6a", opacity: ".55" }),
    s("circle", { cx: 100, cy: 94, r: 5, fill: "#ff8a6a", opacity: ".55" }),
    s("path", { d: "M66 96c5 5 13 5 18 0", fill: "none", stroke: "var(--paper)", "stroke-width": 3, "stroke-linecap": "round" }),
    flames ? s("g", null,
      s("path", { class: "pot-flame", d: "M55 128c-6-4-4-10 0-14 0 4 3 5 4 6 1-3 0-6 2-8 4 4 6 12-6 16Z" }),
      s("path", { class: "pot-flame", d: "M73 128c-6-4-4-10 0-14 0 4 3 5 4 6 1-3 0-6 2-8 4 4 6 12-6 16Z" }),
      s("path", { class: "pot-flame", d: "M91 128c-6-4-4-10 0-14 0 4 3 5 4 6 1-3 0-6 2-8 4 4 6 12-6 16Z" })) : null);
}

export function logo() {
  return s("svg", { viewBox: "0 0 48 48", class: "brand__logo", "aria-hidden": "true" },
    s("rect", { x: 2, y: 2, width: 44, height: 44, rx: 14, fill: "var(--tomato)" }),
    s("path", { d: "M12 22c0-3 5-5 12-5s12 2 12 5Z", fill: "var(--turmeric)" }),
    s("rect", { x: 21, y: 13, width: 6, height: 4, rx: 2, fill: "var(--turmeric)" }),
    s("rect", { x: 11, y: 22, width: 26, height: 16, rx: 7, fill: "#fff8ee" }),
    s("circle", { cx: 19.5, cy: 29, r: 2, fill: "#2a1a12" }),
    s("circle", { cx: 28.5, cy: 29, r: 2, fill: "#2a1a12" }),
    s("path", { d: "M21.5 33c1.5 1.4 3.5 1.4 5 0", fill: "none", stroke: "#2a1a12", "stroke-width": 1.6, "stroke-linecap": "round" }));
}

// ---------------------------------------------------------------- cooking loader
const STATUSES = ["Chopping onions…", "Tempering mustard seeds…", "Checking your filters…", "Tasting for salt…",
  "Plating up…", "Toasting the spices…", "Simmering ideas…", "Reading the spice box…"];

export function cookingLoader(text = "Cooking up ideas") {
  const status = h("p", { class: "cooking__status", "aria-live": "polite" }, h("span", { text: `${text}…` }));
  let i = 0;
  const node = h("div", { class: "cooking", role: "status" }, mascot({ size: 150, flames: true, falling: true }), status,
    h("p", { class: "muted tiny", text: "Free AI models can take up to 30 seconds." }));
  const timer = setInterval(() => {
    if (!node.isConnected) { clearInterval(timer); return; }
    clear(status).append(h("span", { text: STATUSES[i++ % STATUSES.length] }));
  }, 2200);
  return node;
}

// ---------------------------------------------------------------- toasts
export function toast(message, { icon: emoji = "✨", action, timeout = 4200 } = {}) {
  const host = $("#toasts");
  const el = h("div", { class: "toast", role: "status" },
    h("span", { class: "toast__icon", "aria-hidden": "true", text: emoji }),
    h("span", { class: "toast__msg", text: message }),
    action ? h("button", { class: "link-btn", type: "button", onClick: () => { action.fn(); close(); } }, action.label) : null);
  function close() {
    el.classList.add("toast--leaving");
    setTimeout(() => el.remove(), 300);
  }
  host.append(el);
  if (host.children.length > 3) host.firstElementChild.remove();
  setTimeout(close, timeout);
  return close;
}

export function errorToast(err) {
  toast(err?.message || "Something went wrong.", { icon: "⚠️", timeout: 6000 });
}

// ---------------------------------------------------------------- dialogs
export function modal(title, body, { onClose, wide = false } = {}) {
  const dlg = h("dialog", { class: "modal", "aria-labelledby": "modalTitle" },
    h("div", { class: "modal__head" },
      h("h2", { id: "modalTitle", text: title }),
      h("button", { class: "icon-btn icon-btn--plain", type: "button", "aria-label": "Close", onClick: () => dlg.close() }, icon("x"))),
    h("div", { class: "modal__body" }, body));
  if (wide) dlg.style.setProperty("width", "min(760px, calc(100% - 24px))");
  dlg.addEventListener("close", () => { dlg.remove(); onClose?.(); });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

export function confirmDialog(message, { title = "Are you sure?", confirm = "Confirm", danger = false } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const dlg = modal(title, [
      h("p", { text: message }),
      h("div", { class: "row" },
        button(confirm, { variant: danger ? "danger" : "primary", onClick: () => { result = true; dlg.close(); } }),
        button("Cancel", { variant: "ghost", onClick: () => dlg.close() })),
    ], { onClose: () => resolve(result) });
  });
}

// ---------------------------------------------------------------- building blocks
export function button(label, { variant = "", size = "", iconName, onClick, type = "button", ...rest } = {}) {
  const cls = ["btn", variant && `btn--${variant}`, size && `btn--${size}`].filter(Boolean).join(" ");
  return h("button", { class: cls, type, onClick: (e) => { ripple(e); onClick?.(e); }, ...rest }, iconName ? icon(iconName) : null, label);
}

export function busy(btn, on, label) {
  if (on) {
    btn.dataset.label = btn.textContent;
    btn.setAttribute("aria-busy", "true");
    btn.disabled = true;
    if (label) { const svg = btn.querySelector("svg"); clear(btn); if (svg) btn.append(svg); btn.append(label); }
  } else {
    btn.removeAttribute("aria-busy");
    btn.disabled = false;
    if (label && btn.dataset.label) { const svg = btn.querySelector("svg"); clear(btn); if (svg) btn.append(svg); btn.append(btn.dataset.label); }
  }
}

export function emptyState({ art = "🍽️", title, text, actions = [], error = false }) {
  return h("div", { class: `empty${error ? " empty--error" : ""}`, role: error ? "alert" : null },
    h("div", { class: "empty__art", "aria-hidden": "true", text: art }),
    h("h2", { text: title }),
    text ? h("p", { text }) : null,
    actions.length ? h("div", { class: "row", style: { "justify-content": "center" } }, actions) : null);
}

export function signInGate(feature, emojis, blurb) {
  return h("section", { class: "gate view" },
    h("div", { class: "gate__art", "aria-hidden": "true" }, emojis.map((e, i) => h("span", { style: { "--i": String(i) }, text: e }))),
    h("h1", { text: feature }),
    h("p", { class: "muted", text: blurb }),
    h("div", { class: "row", style: { "justify-content": "center" } },
      h("a", { class: "btn btn--primary", href: "/signup", "data-link": "" }, "Create a free account"),
      h("a", { class: "btn btn--ghost", href: "/login", "data-link": "" }, "Sign in")));
}

/** Chip input bound to an array. Returns { el, add, set }. */
export function chipInput({ id, items, max = 30, placeholder, variant = "", label, onChange, suggestions = [] }) {
  const list = h("ul", { class: "chip-list", "aria-label": label });
  const input = h("input", { id, type: "text", autocomplete: "off", maxlength: "60", placeholder, list: suggestions.length ? `${id}-dl` : null, enterKeyHint: "done" });
  const datalist = suggestions.length ? h("datalist", { id: `${id}-dl` }, suggestions.map((v) => h("option", { value: v }))) : null;
  const box = h("div", { class: "chip-input", onClick: (e) => { if (e.target === box) input.focus(); } }, list, input, datalist);

  function render() {
    clear(list);
    items.forEach((item, i) => {
      const li = h("li", { class: `chip ${variant}` },
        h("span", { class: "chip__emoji", "aria-hidden": "true", text: variant ? "🚫" : emojiFor(item) }),
        h("span", { class: "chip__label", text: item }),
        h("button", { type: "button", "aria-label": `Remove ${item}`, onClick: () => {
          li.classList.add("chip--leaving");
          setTimeout(() => { items.splice(i, 1); render(); onChange?.(); input.focus(); }, reducedMotion() ? 0 : 200);
        } }, icon("x")));
      list.append(li);
    });
  }
  function add(raw) {
    const parts = String(raw).split(/,|\band\b|\n/i).map((p) => p.trim().replace(/\s+/g, " ")).filter(Boolean);
    let added = 0;
    for (const p of parts) {
      if (items.length >= max) { toast(`Up to ${max} items.`, { icon: "✋" }); break; }
      if (!items.some((x) => x.toLowerCase() === p.toLowerCase())) { items.push(p.slice(0, 60)); added++; }
    }
    render();
    if (added) onChange?.();
    return added;
  }
  input.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === ",") && input.value.trim()) { e.preventDefault(); add(input.value); input.value = ""; }
    else if (e.key === "," ) e.preventDefault();
    else if (e.key === "Backspace" && !input.value && items.length) { items.pop(); render(); onChange?.(); }
  });
  // A pick from the suggestions list arrives as a change event.
  input.addEventListener("change", () => { if (suggestions.includes(input.value.trim())) { add(input.value); input.value = ""; } });
  input.addEventListener("blur", () => { if (input.value.trim()) { add(input.value); input.value = ""; } });
  render();
  return { el: box, input, add, render };
}

// ---------------------------------------------------------------- transitions
/** Run a DOM update inside a View Transition when supported. */
export function withTransition(update) {
  if (!document.startViewTransition || reducedMotion()) { update(); return Promise.resolve(); }
  const t = document.startViewTransition(() => update());
  return t.finished.catch(() => {});
}

// ---------------------------------------------------------------- confetti (spice burst)
export function confetti() {
  if (reducedMotion()) return;
  const canvas = h("canvas", { class: "confetti", "aria-hidden": "true" });
  document.body.append(canvas);
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const colors = ["#f0a20f", "#c63f1d", "#2b7a4b", "#ffc145", "#ff7d55", "#8e3b62"];
  const glyphs = ["🌶️", "🍋", "🌿", "🧄", "🍅"];
  const parts = Array.from({ length: 140 }, (_, i) => ({
    x: innerWidth / 2, y: innerHeight * 0.55, vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 18 - 6,
    r: Math.random() * 6 + 3, c: colors[i % colors.length], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
    g: i % 12 === 0 ? glyphs[i % glyphs.length] : null,
  }));
  const start = performance.now();
  (function frame(now) {
    const t = now - start;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.42; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.globalAlpha = Math.max(0, 1 - t / 2600);
      if (p.g) { ctx.font = "22px serif"; ctx.fillText(p.g, -11, 8); }
      else { ctx.fillStyle = p.c; ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); }
      ctx.restore();
    }
    if (t < 2600) requestAnimationFrame(frame); else canvas.remove();
  })(start);
}
