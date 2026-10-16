// Smart Pantry: shelves by aisle, freshness bars, quick add, and the rescue loop.
import { api } from "../lib/api.js";
import { countUp, h, mount, reducedMotion } from "../lib/dom.js";
import { emojiFor, STAPLES } from "../lib/food.js";
import { addDays, daysLeftLabel, formatQty, isoDate, parseQuick } from "../lib/format.js";
import { icon } from "../lib/icons.js";
import { localToday, refreshSession, state } from "../lib/store.js";
import { busy, button, emptyState, errorToast, modal, signInGate, toast, withTransition } from "../lib/ui.js";
import { startGeneration } from "./discover.js";

const SHELF_EMOJI = { "Produce": "🥬", "Dairy & Eggs": "🥛", "Meat & Seafood": "🍗", "Grains & Pulses": "🌾", "Spices & Herbs": "🌶️", "Oils & Sauces": "🫙", "Bakery": "🍞", "Other": "🧺" };

export async function render({ navigate }) {
  if (!state.user) return signInGate("Smart Pantry", ["🫙", "🥬", "⏳"], "Track what you have and when it expires. Recipe Bot will suggest recipes that rescue food before it goes to waste.");

  let data = { items: [], categories: Object.keys(SHELF_EMOJI), expiring: [] };
  const statsEl = h("div", { class: "pantry-stats" });
  const rescueEl = h("div");
  const shelves = h("div", { "aria-live": "polite" }, h("div", { class: "jars" }, [0, 1, 2, 3].map(() => h("div", { class: "skel", style: { height: "74px", "border-radius": "18px" } }))));

  async function load() {
    try {
      data = await api(`/api/pantry?today=${localToday()}`);
      state.pantry = data;
      draw();
    } catch (err) { mount(shelves, emptyState({ art: "⚠️", title: "Couldn't load your pantry", text: err.message, error: true })); }
  }

  function draw() {
    const soon = data.items.filter((i) => i.status === "soon");
    const expired = data.items.filter((i) => i.status === "expired");
    const b1 = h("b"), b2 = h("b"), b3 = h("b");
    mount(statsEl,
      h("div", { class: "bigstat" }, b1, h("span", { text: "items in stock" })),
      h("div", { class: "bigstat bigstat--warn" }, b2, h("span", { text: "use within 3 days" })),
      h("div", { class: "bigstat bigstat--leaf" }, b3, h("span", { text: "items rescued so far" })));
    countUp(b1, data.items.length); countUp(b2, soon.length + expired.length); countUp(b3, state.user?.stats?.rescued || 0);

    const urgent = [...expired.filter((i) => i.days_left >= -2), ...soon];
    mount(rescueEl, urgent.length ? h("div", { class: "rescue-banner rise" },
      h("span", { class: "rescue-banner__icon", "aria-hidden": "true", text: "🛟" }),
      h("p", null, h("strong", { text: "Rescue mission: " }), `${urgent.map((i) => i.name).slice(0, 5).join(", ")}${urgent.length > 5 ? "…" : ""} ${urgent.length > 1 ? "need" : "needs"} using up.`),
      button(`Cook with ${urgent.length > 1 ? "these" : "it"}`, { variant: "leaf", iconName: "sparkles", onClick: () => startGeneration(navigate, {
        use_first: urgent.slice(0, 15).map((i) => i.name), ingredients: [], count: 3, servings: state.prefs?.servings || 2,
        diets: state.prefs?.diets || [], exclude: state.prefs?.exclude || [], cuisine: state.prefs?.cuisine || "Any", currency: state.prefs?.currency || "INR",
      }) })) : null);

    withTransition(() => {
      if (!data.items.length) {
        mount(shelves, emptyState({ art: "🫙", title: "Your shelves are empty", text: "Add what you have, with an expiry date for perishables. Try “500 g paneer” or tap a staple below." }));
        return;
      }
      const groups = new Map();
      for (const item of data.items) { if (!groups.has(item.category)) groups.set(item.category, []); groups.get(item.category).push(item); }
      const order = data.categories.filter((c) => groups.has(c));
      mount(shelves, order.map((cat) => h("section", { class: "shelf" },
        h("div", { class: "shelf__head" }, h("span", { "aria-hidden": "true", style: { "font-size": "1.4rem" }, text: SHELF_EMOJI[cat] || "🧺" }),
          h("h2", { text: cat }), h("span", { class: "shelf__count", text: `${groups.get(cat).length}` })),
        h("div", { class: "jars" }, groups.get(cat).map((item, i) => jar(item, i))))));
    });
  }

  function jar(item, i) {
    const pct = item.days_left == null ? 100 : Math.max(4, Math.min(100, (item.days_left / 14) * 100));
    const color = item.status === "expired" ? "var(--danger)" : item.status === "soon" ? "var(--turmeric)" : "var(--leaf)";
    const el = h("article", { class: `jar jar--${item.status} rise`, style: { "--i": String(Math.min(i, 12)) } },
      h("div", { class: "jar__emoji", "aria-hidden": "true", text: emojiFor(item.name) }),
      h("div", null,
        h("div", { class: "jar__name", text: item.name }),
        h("div", { class: "jar__meta" },
          item.quantity != null ? h("span", { text: `${formatQty(item.quantity)}${item.unit ? " " + item.unit : ""}` }) : null,
          item.days_left != null ? h("span", { class: `days days--${item.status}`, text: daysLeftLabel(item.days_left) }) : null)),
      h("div", { class: "row", style: { gap: "2px" } },
        h("button", { class: "icon-btn icon-btn--plain", type: "button", "aria-label": `Edit ${item.name}`, onClick: () => editModal(item) }, icon("edit")),
        h("button", { class: "icon-btn icon-btn--plain", type: "button", "aria-label": `Used up ${item.name}`, title: "Used it up", onClick: () => consume(item, el) }, icon("check"))),
      item.days_left != null ? h("div", { class: "jar__fresh", "aria-hidden": "true" }, h("i", { style: { "--w": `${pct}%`, "--c": color } })) : null);
    return el;
  }

  async function consume(item, el) {
    try {
      const res = await api("/api/pantry/consume", { method: "POST", body: { ids: [item.id], today: localToday() } });
      el.classList.add("jar--leaving");
      await new Promise((r) => setTimeout(r, reducedMotion() ? 0 : 280));
      if (res.rescued) { await refreshSession(); toast(`🛟 Rescued ${item.name}! ${res.rescued_total} items saved from waste.`, { icon: "🎉" }); }
      else toast(`${item.name} cleared`, { icon: "✅" });
      load();
    } catch (err) { errorToast(err); }
  }

  function editModal(item) {
    const name = h("input", { class: "input", id: "e-name", value: item.name, maxlength: "60" });
    const qty = h("input", { class: "input", id: "e-qty", type: "number", min: "0", step: "any", value: item.quantity ?? "" });
    const unit = h("input", { class: "input", id: "e-unit", value: item.unit, maxlength: "24", placeholder: "g, kg, pcs…" });
    const cat = h("select", { class: "input", id: "e-cat" }, data.categories.map((c) => h("option", { value: c, selected: c === item.category, text: c })));
    const exp = h("input", { class: "input", id: "e-exp", type: "date", value: item.expires_on || "" });
    const dlg = modal(`Edit ${item.name}`, h("form", { onSubmit: async (e) => {
      e.preventDefault();
      const q = qty.value === "" ? null : Number(qty.value);
      try {
        await api(`/api/pantry/${item.id}`, { method: "PATCH", body: { name: name.value, quantity: q, unit: unit.value, category: cat.value,
          ...(exp.value ? { expires_on: exp.value } : { clear_expiry: true }) } });
        dlg.close(); load();
      } catch (err) { errorToast(err); }
    } },
      h("div", { class: "grid-2" },
        h("div", { class: "field span-2" }, h("label", { class: "label", for: "e-name", text: "Name" }), name),
        h("div", { class: "field" }, h("label", { class: "label", for: "e-qty", text: "Quantity" }), qty),
        h("div", { class: "field" }, h("label", { class: "label", for: "e-unit", text: "Unit" }), unit),
        h("div", { class: "field" }, h("label", { class: "label", for: "e-cat", text: "Shelf" }), cat),
        h("div", { class: "field" }, h("label", { class: "label", for: "e-exp", text: "Expires on" }), exp)),
      h("div", { class: "row" }, button("Save changes", { variant: "primary", type: "submit" }),
        button("Remove", { variant: "ghost", iconName: "trash", onClick: async () => {
          try { await api(`/api/pantry/${item.id}`, { method: "DELETE" }); dlg.close(); toast(`${item.name} removed`, { icon: "🗑️" }); load(); } catch (err) { errorToast(err); }
        } }))));
  }

  // ---- add bar
  const what = h("input", { class: "input", id: "p-what", maxlength: "80", placeholder: "e.g. 500 g paneer, 6 eggs, spinach", autocomplete: "off" });
  const expiry = h("input", { class: "input", id: "p-exp", type: "date", min: localToday() });
  const quickDates = h("div", { class: "toggles", style: { "margin-top": "8px" } }, [["+2 days", 2], ["+1 week", 7], ["+2 weeks", 14], ["+1 month", 30]].map(([l, d]) =>
    h("button", { class: "btn btn--soft btn--sm", type: "button", onClick: () => { expiry.value = isoDate(addDays(new Date(), d)); } }, l)));
  const addBtn = button("Add to pantry", { variant: "primary", iconName: "plus", type: "submit" });
  const addForm = h("form", { class: "panel", onSubmit: async (e) => {
    e.preventDefault();
    const raw = what.value.trim();
    if (!raw) { what.focus(); return; }
    const entries = raw.split(/,|\n/).map((t) => t.trim()).filter(Boolean).slice(0, 40).map((t) => {
      const p = parseQuick(t);
      return { name: p.name.slice(0, 60), quantity: p.quantity, unit: p.unit, expires_on: expiry.value || null };
    });
    try {
      busy(addBtn, true);
      await api("/api/pantry/bulk", { method: "POST", body: { items: entries } });
      toast(entries.length > 1 ? `Added ${entries.length} items` : `Added ${entries[0].name}`, { icon: emojiFor(entries[0].name) });
      what.value = ""; expiry.value = "";
      await load();
      what.focus();
    } catch (err) { errorToast(err); } finally { busy(addBtn, false); }
  } },
    h("div", { class: "addbar" },
      h("div", { class: "field", style: { margin: "0" } }, h("label", { class: "label", for: "p-what", text: "What did you buy?" }), what),
      h("div", { class: "field", style: { margin: "0" } }, h("label", { class: "label", for: "p-exp", text: "Expires (optional)" }), expiry),
      addBtn),
    quickDates,
    h("p", { class: "help", text: "Separate items with commas. Quantities like “2 kg” or “6” are understood." }),
    h("div", { class: "quickpicks", style: { "margin-top": "8px" } }, STAPLES.map((st) => h("button", { type: "button", onClick: () => {
      what.value = what.value.trim() ? `${what.value.trim()}, ${st}` : st; what.focus();
    } }, `${emojiFor(st)} ${st}`))));

  load();
  return h("section", { class: "view" },
    h("div", { class: "pagehead" }, h("p", { class: "eyebrow", text: "Smart Pantry" }), h("h1", { text: "What's on your shelves" }),
      h("p", { text: "Add expiry dates and Recipe Bot will nudge you to cook things before they spoil. Use up an item close to its date and it counts as rescued." })),
    statsEl, rescueEl, addForm, shelves);
}
