// Shopping list grouped by aisle, with a basket progress bar and "bought → pantry".
import { api } from "../lib/api.js";
import { h, mount } from "../lib/dom.js";
import { emojiFor } from "../lib/food.js";
import { formatQty, parseQuick } from "../lib/format.js";
import { icon } from "../lib/icons.js";
import { emit, state } from "../lib/store.js";
import { busy, button, confirmDialog, emptyState, errorToast, signInGate, toast } from "../lib/ui.js";

const AISLE_EMOJI = { "Produce": "🥬", "Dairy & Eggs": "🥛", "Meat & Seafood": "🍗", "Grains & Pulses": "🌾", "Spices & Herbs": "🌶️", "Oils & Sauces": "🫙", "Bakery": "🍞", "Other": "🧺" };
const ORDER = Object.keys(AISLE_EMOJI);

export async function render({ navigate }) {
  if (!state.user) return signInGate("Shopping list", ["🛒", "🥕", "✅"], "A smart list grouped by aisle. Build it from your meal plan or a recipe's missing ingredients.");
  let items = [];
  const bar = h("i", { style: { "--w": "0%" } });
  const count = h("span", { class: "muted", "aria-live": "polite" });
  const body = h("div", null, [0, 1].map(() => h("div", { class: "skel", style: { height: "120px", "margin-bottom": "12px", "border-radius": "18px" } })));
  const toPantry = button("Move bought items to pantry", { variant: "leaf", iconName: "jar", onClick: async () => {
    try {
      busy(toPantry, true);
      const res = await api("/api/shopping/to-pantry", { method: "POST" });
      state.pantry = null;
      toast(`${res.moved} item${res.moved === 1 ? "" : "s"} moved to your pantry`, { icon: "🫙", action: { label: "Add expiry dates", fn: () => navigate("/pantry") } });
      load();
    } catch (err) { errorToast(err); } finally { busy(toPantry, false); }
  } });
  const clearBtn = button("Clear bought", { variant: "ghost", iconName: "trash", onClick: async () => {
    if (!(await confirmDialog("Remove all ticked items from the list?", { title: "Clear bought items?", confirm: "Clear" }))) return;
    try { await api("/api/shopping?checked_only=true", { method: "DELETE" }); load(); } catch (err) { errorToast(err); }
  } });

  async function load() {
    try { items = await api("/api/shopping"); draw(); } catch (err) { mount(body, emptyState({ art: "⚠️", title: "Couldn't load your list", text: err.message, error: true })); }
  }

  function progress() {
    const done = items.filter((i) => i.checked).length;
    bar.style.setProperty("--w", items.length ? `${Math.round((done / items.length) * 100)}%` : "0%");
    count.textContent = items.length ? `${done} of ${items.length} in the basket` : "";
    toPantry.hidden = clearBtn.hidden = !done;
    state.shoppingCount = items.length - done;
    emit("shopping");
  }

  function draw() {
    progress();
    if (!items.length) {
      mount(body, emptyState({ art: "🛒", title: "Your list is empty", text: "Add items below, build a list from your meal plan, or add a recipe's missing ingredients.",
        actions: [h("a", { class: "btn btn--primary", href: "/plan", "data-link": "" }, icon("calendar"), "Go to meal plan")] }));
      return;
    }
    const groups = new Map();
    for (const it of items) { if (!groups.has(it.category)) groups.set(it.category, []); groups.get(it.category).push(it); }
    mount(body, ORDER.filter((c) => groups.has(c)).map((cat) => h("section", { class: "aisle" },
      h("h2", null, h("span", { "aria-hidden": "true", text: AISLE_EMOJI[cat] }), cat),
      h("ul", { class: "items" }, groups.get(cat).map((it, i) => row(it, i))))));
  }

  function row(it, i) {
    const li = h("li", { class: `item${it.checked ? " item--checked" : ""}`, style: { "--i": String(i) } });
    const cb = h("input", { type: "checkbox", id: `shop-${it.id}`, checked: it.checked, onChange: async () => {
      it.checked = cb.checked;
      li.classList.toggle("item--checked", it.checked);
      progress();
      navigator.vibrate?.(12);
      try { await api(`/api/shopping/${it.id}`, { method: "PATCH", body: { checked: it.checked } }); }
      catch (err) { it.checked = !it.checked; cb.checked = it.checked; li.classList.toggle("item--checked", it.checked); progress(); errorToast(err); }
    } });
    li.append(cb,
      h("label", { for: `shop-${it.id}` },
        h("span", { class: "item__name" }, `${emojiFor(it.name)} `,
          it.quantity != null ? h("strong", { text: `${formatQty(it.quantity)}${it.unit ? " " + it.unit : ""} ` }) : null, it.name),
        it.source ? h("div", { class: "item__meta", text: `for ${it.source}` }) : null),
      h("button", { class: "icon-btn icon-btn--plain", type: "button", "aria-label": `Remove ${it.name}`, onClick: async () => {
        try { await api(`/api/shopping/${it.id}`, { method: "DELETE" }); items = items.filter((x) => x.id !== it.id); draw(); } catch (err) { errorToast(err); }
      } }, icon("x")));
    return li;
  }

  const input = h("input", { class: "input", id: "shop-add", maxlength: "80", placeholder: "Add an item, e.g. 1 kg onions", autocomplete: "off" });
  const addForm = h("form", { class: "row", style: { margin: "0 0 10px" }, onSubmit: async (e) => {
    e.preventDefault();
    const raw = input.value.trim();
    if (!raw) return;
    const parts = raw.split(",").map((t) => parseQuick(t)).filter((p) => p.name).slice(0, 60);
    try {
      await api("/api/shopping/bulk", { method: "POST", body: { items: parts.map((p) => ({ name: p.name.slice(0, 80), quantity: p.quantity, unit: p.unit })) } });
      input.value = "";
      load();
    } catch (err) { errorToast(err); }
  } }, h("label", { class: "sr-only", for: "shop-add", text: "Add an item" }), h("div", { class: "grow" }, input), button("Add", { variant: "dark", iconName: "plus", type: "submit" }));

  load();
  return h("section", { class: "view" },
    h("div", { class: "pagehead" }, h("p", { class: "eyebrow", text: "Shopping" }), h("h1", { text: "Your shopping list" }),
      h("p", { text: "Grouped by aisle so you can sweep the shop once. Tick things off as they go in the basket." })),
    h("div", { class: "basket" }, h("span", { "aria-hidden": "true", style: { "font-size": "1.6rem" }, text: "🧺" }), h("div", { class: "basket__bar" }, bar), count),
    addForm,
    h("div", { class: "row", style: { margin: "6px 0 4px" } }, toPantry, clearBtn),
    body);
}
