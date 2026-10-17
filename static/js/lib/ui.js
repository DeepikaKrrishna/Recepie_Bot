// Shared UI pieces: mascot, toasts, dialogs, empty states, chip inputs, confetti, view transitions.
import { $, clear, h, reducedMotion, ripple, s } from "./dom.js";
import { emojiFor } from "./food.js";
import { icon } from "./icons.js";

const INK = "#1f1a2e";

// ---------------------------------------------------------------- mascot
/** Pot-bot: the Recipe Bot mascot (same character as in Chef Run). */
export function mascot({ size = 160, cls = "" } = {}) {
  return s("svg", { viewBox: "0 0 160 150", width: size, height: size * 150 / 160, class: `mascot ${cls}`, "aria-hidden": "true" },
    s("g", { class: "mascot__steam", fill: "none", stroke: "#9b90b0", "stroke-width": 4, "stroke-linecap": "round" },
      s("path", { d: "M62 30c-7-7 7-12 0-20" }), s("path", { d: "M80 26c-7-7 7-12 0-20" }), s("path", { d: "M98 30c-7-7 7-12 0-20" })),
    s("g", { class: "mascot__lid" },
      s("path", { d: "M28 58c0-12 24-18 52-18s52 6 52 18Z", fill: "#ff7a3d", stroke: INK, "stroke-width": 4, "stroke-linejoin": "round" }),
      s("rect", { x: 70, y: 32, width: 20, height: 10, rx: 5, fill: "#ffc93c", stroke: INK, "stroke-width": 4 })),
    s("rect", { x: 14, y: 70, width: 20, height: 12, rx: 6, fill: INK }),
    s("rect", { x: 126, y: 70, width: 20, height: 12, rx: 6, fill: INK }),
    s("rect", { x: 26, y: 58, width: 108, height: 72, rx: 26, fill: "#fffdf8", stroke: INK, "stroke-width": 4 }),
    s("ellipse", { class: "mascot__eye", cx: 64, cy: 88, rx: 6, ry: 8, fill: INK }),
    s("ellipse", { class: "mascot__eye", cx: 96, cy: 88, rx: 6, ry: 8, fill: INK }),
    s("circle", { cx: 50, cy: 102, r: 6, fill: "#ff5a7e", opacity: ".5" }),
    s("circle", { cx: 110, cy: 102, r: 6, fill: "#ff5a7e", opacity: ".5" }),
    s("path", { d: "M70 104c5 6 15 6 20 0", fill: "none", stroke: INK, "stroke-width": 4, "stroke-linecap": "round" }),
    s("rect", { x: 48, y: 128, width: 10, height: 14, rx: 4, fill: INK }),
    s("rect", { x: 102, y: 128, width: 10, height: 14, rx: 4, fill: INK }));
}

export function logo() {
  return s("svg", { viewBox: "0 0 48 48", class: "brand__logo", "aria-hidden": "true" },
    s("rect", { x: 2, y: 2, width: 44, height: 44, rx: 15, fill: "#ffc93c", stroke: INK, "stroke-width": 3 }),
    s("path", { d: "M11 22c0-4 6-6 13-6s13 2 13 6Z", fill: "#ff7a3d", stroke: INK, "stroke-width": 2.5, "stroke-linejoin": "round" }),
    s("rect", { x: 10, y: 21, width: 28, height: 18, rx: 8, fill: "#fffdf8", stroke: INK, "stroke-width": 2.5 }),
    s("circle", { cx: 19.5, cy: 29, r: 2.2, fill: INK }),
    s("circle", { cx: 28.5, cy: 29, r: 2.2, fill: INK }),
    s("path", { d: "M21.5 33c1.5 1.4 3.5 1.4 5 0", fill: "none", stroke: INK, "stroke-width": 2, "stroke-linecap": "round" }));
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
  toast(err?.message || "Something went wrong.", { icon: "😬", timeout: 6000 });
}

// ---------------------------------------------------------------- dialogs
export function modal(title, body, { onClose } = {}) {
  const dlg = h("dialog", { class: "modal", "aria-labelledby": "modalTitle" },
    h("div", { class: "modal__head" },
      h("h2", { id: "modalTitle", text: title }),
      h("button", { class: "icon-btn icon-btn--plain", type: "button", "aria-label": "Close", onClick: () => dlg.close() }, icon("x"))),
    h("div", { class: "modal__body" }, body));
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

/** Chip input bound to an array. Returns { el, input, add, render }. */
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
    else if (e.key === ",") e.preventDefault();
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

// ---------------------------------------------------------------- confetti
export function confetti({ y = 0.55 } = {}) {
  if (reducedMotion()) return;
  const canvas = h("canvas", { class: "confetti", "aria-hidden": "true" });
  document.body.append(canvas);
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const colors = ["#ff7a3d", "#ffc93c", "#3ed1b2", "#ff5a7e", "#9b7bff", "#5ab8ff"];
  const glyphs = ["🍅", "🌶️", "🍋", "🧅", "🥕", "🌿"];
  const parts = Array.from({ length: 150 }, (_, i) => ({
    x: innerWidth / 2, y: innerHeight * y, vx: (Math.random() - 0.5) * 18, vy: -Math.random() * 19 - 6,
    r: Math.random() * 6 + 4, c: colors[i % colors.length], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
    g: i % 10 === 0 ? glyphs[i % glyphs.length] : null,
  }));
  const start = performance.now();
  (function frame(now) {
    const t = now - start;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.45; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.globalAlpha = Math.max(0, 1 - t / 2600);
      if (p.g) { ctx.font = "24px serif"; ctx.fillText(p.g, -12, 8); }
      else { ctx.fillStyle = p.c; ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); ctx.strokeRect(-p.r, -p.r / 2, p.r * 2, p.r); }
      ctx.restore();
    }
    if (t < 2600) requestAnimationFrame(frame); else canvas.remove();
  })(start);
}
