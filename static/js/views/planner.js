// Weekly meal planner: drag-and-drop (or tap-to-move on touch), recipe picker,
// and one-tap shopping list from the week's plan.
import { api } from "../lib/api.js";
import { h, mount } from "../lib/dom.js";
import { matColors, plateArt } from "../lib/food.js";
import { addDays, dayName, isoDate, mondayOf, shortDate } from "../lib/format.js";
import { icon } from "../lib/icons.js";
import { loadShoppingCount, state } from "../lib/store.js";
import { busy, button, emptyState, errorToast, modal, signInGate, toast, withTransition } from "../lib/ui.js";

const SLOTS = [["breakfast", "Breakfast", "🌅"], ["lunch", "Lunch", "🍱"], ["dinner", "Dinner", "🌙"], ["snack", "Snack", "☕"]];

export async function render({ navigate }) {
  if (!state.user) return signInGate("Meal planner", ["📅", "🍛", "🛒"], "Plan your week, drag meals around, and turn the whole plan into one shopping list.");

  let start = mondayOf();
  let entries = [];
  let picked = null; // entry chosen for tap-to-move
  const weekLabel = h("strong", { "aria-live": "polite" });
  const grid = h("div", { class: "week" });
  const hint = h("p", { class: "callout callout--info", hidden: true });

  async function load() {
    weekLabel.textContent = `${shortDate(start)} – ${shortDate(addDays(start, 6))}`;
    try {
      const data = await api(`/api/plan?start=${isoDate(start)}`);
      entries = data.entries;
      draw();
    } catch (err) { mount(grid, emptyState({ art: "⚠️", title: "Couldn't load your plan", text: err.message, error: true })); }
  }

  function at(day, slot) { return entries.find((e) => e.day === day && e.slot === slot); }

  async function move(entry, day, slot) {
    try {
      await api(`/api/plan/${entry.id}/move`, { method: "POST", body: { day, slot } });
      picked = null; hint.hidden = true;
      await load();
    } catch (err) { errorToast(err); }
  }

  function draw() {
    const today = isoDate(new Date());
    withTransition(() => mount(grid, Array.from({ length: 7 }, (_, d) => {
      const date = addDays(start, d);
      const day = isoDate(date);
      return h("section", { class: `day rise${day === today ? " day--today" : ""}`, style: { "--i": String(d) }, "aria-label": `${dayName(date, "long")} ${shortDate(date)}` },
        h("div", { class: "day__head" }, h("b", { text: dayName(date) }), h("span", { text: day === today ? "Today" : shortDate(date) })),
        h("div", { class: "slots" }, SLOTS.map(([slot, label, emoji]) => slotCell(day, slot, label, emoji))));
    })));
  }

  function slotCell(day, slot, label, emoji) {
    const entry = at(day, slot);
    const cell = h("button", { class: `slot${entry ? " slot--filled" : ""}${picked && entry && picked.id === entry.id ? " slot--picked" : ""}`, type: "button",
      "aria-label": entry ? `${label}: ${entry.recipe.title}. Open options` : `${label}: empty. Add a recipe`,
      draggable: entry ? "true" : null,
      style: entry ? { "--mat": matColors(entry.recipe)[0] } : null,
      onClick: () => {
        if (picked && (!entry || entry.id !== picked.id)) { move(picked, day, slot); return; }
        if (entry) entryMenu(entry); else pickRecipe(day, slot);
      } },
      h("span", { class: "slot__label", text: `${emoji} ${label}` }),
      entry ? h("span", { class: "slot__title", text: entry.recipe.title }) : h("span", { class: "slot__add", text: "+ Add" }));
    // drag & drop (mouse / trackpad)
    if (entry) {
      cell.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", String(entry.id)); cell.classList.add("slot--dragging"); });
      cell.addEventListener("dragend", () => cell.classList.remove("slot--dragging"));
    }
    cell.addEventListener("dragover", (e) => { e.preventDefault(); cell.classList.add("slot--drop"); });
    cell.addEventListener("dragleave", () => cell.classList.remove("slot--drop"));
    cell.addEventListener("drop", (e) => {
      e.preventDefault(); cell.classList.remove("slot--drop");
      const id = Number(e.dataTransfer.getData("text/plain"));
      const src = entries.find((x) => x.id === id);
      if (src && (src.day !== day || src.slot !== slot)) move(src, day, slot);
    });
    return cell;
  }

  function entryMenu(entry) {
    let servings = entry.servings;
    const out = h("output", { text: String(servings) });
    const dlg = modal(entry.recipe.title, [
      h("div", { class: "row", style: { "margin-bottom": "14px" } }, plateArt(entry.recipe.ingredients?.length ? entry.recipe : { title: entry.recipe.title, ingredients: [] }, { size: 72, label: false }),
        h("p", { class: "muted", style: { margin: "0" }, text: `${SLOTS.find((s) => s[0] === entry.slot)[1]} · ${dayName(new Date(entry.day + "T00:00"), "long")}` })),
      h("div", { class: "field" }, h("span", { class: "label", text: "Servings" }),
        h("div", { class: "stepper" },
          h("button", { class: "icon-btn", type: "button", "aria-label": "Fewer", onClick: () => { servings = Math.max(1, servings - 1); out.textContent = servings; } }, icon("minus")), out,
          h("button", { class: "icon-btn", type: "button", "aria-label": "More", onClick: () => { servings = Math.min(20, servings + 1); out.textContent = servings; } }, icon("plus")))),
      h("div", { class: "row" },
        button("Open recipe", { variant: "primary", iconName: "book", onClick: () => { dlg.close(); navigate(`/cookbook/${entry.recipe.id}`); } }),
        button("Save servings", { variant: "ghost", onClick: async () => {
          try { await api("/api/plan", { method: "PUT", body: { day: entry.day, slot: entry.slot, recipe_id: entry.recipe.id, servings } }); dlg.close(); load(); }
          catch (err) { errorToast(err); }
        } }),
        button("Move", { variant: "ghost", iconName: "calendar", onClick: () => {
          picked = entry; dlg.close(); hint.hidden = false;
          hint.textContent = `Tap any slot to move “${entry.recipe.title}” there (or drag it on a computer).`;
          draw();
        } }),
        button("Remove", { variant: "ghost", iconName: "trash", onClick: async () => {
          try { await api(`/api/plan/${entry.id}`, { method: "DELETE" }); dlg.close(); toast("Removed from plan", { icon: "🗑️" }); load(); }
          catch (err) { errorToast(err); }
        } })),
    ]);
  }

  async function pickRecipe(day, slot) {
    const list = h("div", { class: "picker" }, h("div", { class: "skel", style: { height: "60px" } }));
    const search = h("input", { class: "input", type: "search", placeholder: "Search your cookbook", "aria-label": "Search recipes", style: { "margin-bottom": "12px" } });
    const label = SLOTS.find((s) => s[0] === slot)[1];
    const dlg = modal(`${label} · ${dayName(new Date(day + "T00:00"), "long")}`, [search, list], { wide: true });
    let rows = [];
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const shown = rows.filter((r) => !q || r.title.toLowerCase().includes(q));
      if (!rows.length) {
        mount(list, emptyState({ art: "📖", title: "No saved recipes yet", text: "Save a recipe first, then add it to your week.",
          actions: [button("Find recipes", { variant: "primary", onClick: () => { dlg.close(); navigate("/"); } })] }));
        return;
      }
      mount(list, shown.map((r) => h("button", { type: "button", onClick: async () => {
        try {
          await api("/api/plan", { method: "PUT", body: { day, slot, recipe_id: r.id, servings: r.servings || state.prefs?.servings || 2 } });
          dlg.close(); toast(`${r.title} planned`, { icon: "📅" }); load();
        } catch (err) { errorToast(err); }
      } }, plateArt(r, { size: 48, label: false }), h("span", null, h("strong", { text: r.title }), h("br"),
        h("span", { class: "muted tiny", text: [r.favorite ? "❤️ favourite" : "", r.cuisine, r.total_minutes ? `${r.total_minutes} min` : ""].filter(Boolean).join(" · ") })))));
    };
    search.addEventListener("input", draw);
    try { rows = await api("/api/recipes"); draw(); } catch (err) { mount(list, h("p", { class: "form-error", text: err.message })); }
  }

  const shopBtn = button("Build shopping list", { variant: "primary", iconName: "cart", onClick: async () => {
    try {
      busy(shopBtn, true);
      const res = await api("/api/shopping/from-plan", { method: "POST", body: { start: isoDate(start) } });
      loadShoppingCount();
      const skipped = res.skipped_in_pantry.length ? ` Skipped ${res.skipped_in_pantry.length} you already have.` : "";
      toast(`Shopping list updated: ${res.added} items.${skipped}`, { icon: "🛒", action: { label: "Open", fn: () => navigate("/shopping") } });
    } catch (err) { errorToast(err); } finally { busy(shopBtn, false); }
  } });

  const shift = (days) => { start = addDays(start, days); picked = null; hint.hidden = true; load(); };
  load();

  return h("section", { class: "view" },
    h("div", { class: "pagehead" }, h("p", { class: "eyebrow", text: "Meal planner" }), h("h1", { text: "Your week on a plate" }),
      h("p", { text: "Tap a slot to add a saved recipe. Drag meals to rearrange them (or tap a meal, then Move). When you're happy, build the shopping list." })),
    h("div", { class: "section__head" },
      h("div", { class: "weeknav" },
        h("button", { class: "icon-btn", type: "button", "aria-label": "Previous week", onClick: () => shift(-7) }, icon("chevronLeft")),
        weekLabel,
        h("button", { class: "icon-btn", type: "button", "aria-label": "Next week", onClick: () => shift(7) }, icon("chevronRight")),
        button("This week", { variant: "ghost", size: "sm", onClick: () => { start = mondayOf(); load(); } })),
      shopBtn),
    hint, grid);
}
