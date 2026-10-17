// Recipe page: fresh results and saved cookbook recipes.
import { api } from "../lib/api.js";
import { clear, h, mount } from "../lib/dom.js";
import { matColors, plateArt } from "../lib/food.js";
import { cap, formatQty, minutes } from "../lib/format.js";
import { icon } from "../lib/icons.js";
import { detectTimers, startTimer } from "../lib/timers.js";
import { state } from "../lib/store.js";
import { busy, button, confirmDialog, emptyState, errorToast, toast } from "../lib/ui.js";
import { startGeneration } from "./discover.js";

const DISCLAIMER = "AI-generated recipe. Quantities, times and nutrition are estimates and may be wrong. Check labels for allergens and cook food to safe temperatures.";
const REMIXES = [["🌶️", "Make it spicier"], ["🥗", "Make it healthier"], ["⚡", "Make it quicker"], ["🧒", "Make it kid-friendly"], ["🌱", "Make it vegan"]];

export async function renderTemp({ params, navigate }) {
  const recipe = state.results?.data?.recipes?.[Number(params[0])];
  if (!recipe) return gone(navigate, "That recipe isn't in your current results anymore.");
  return detail(recipe, { navigate, back: ["/results", "Back to results"] });
}

export async function renderSaved({ params, navigate }) {
  try {
    const row = await api(`/api/recipes/${Number(params[0])}`);
    return detail(row.recipe, { navigate, saved: row, back: ["/cookbook", "Back to cookbook"] });
  } catch (err) {
    return gone(navigate, err.status === 404 ? "This recipe isn't in your cookbook." : err.message);
  }
}

function gone(navigate, text) {
  return h("section", { class: "view section" }, emptyState({ art: "🍽️", title: "Recipe not found", text,
    actions: [button("Back to cooking", { variant: "primary", onClick: () => navigate("/") })] }));
}

async function detail(recipe, { navigate, saved = null, back }) {
  let servings = recipe.servings;
  let row = saved;
  const [mat] = matColors(recipe);
  const yours = new Set((recipe.uses_yours || []).map((x) => x.toLowerCase()));
  const needs = new Set((recipe.also_needs || []).map((x) => x.toLowerCase()));

  // ---- hero
  const plate = plateArt(recipe, { size: 300 });
  plate.style.setProperty("view-transition-name", "hero-plate");
  const hero = h("section", { class: "rhero" },
    h("div", { class: "rhero__art", style: { "--mat": mat } }, plate),
    h("div", null,
      h("a", { href: back[0], "data-link": "", class: "link-btn" }, `← ${back[1]}`),
      h("br"),
      h("span", { class: "eyebrow", text: `${recipe.hero_emoji || "🍽️"} ${recipe.cuisine || "Recipe"}` }),
      h("h1", { text: recipe.title }),
      recipe.description ? h("p", { class: "landing__lede", text: recipe.description }) : null,
      h("div", { class: "statline" },
        stat("clock", minutes(recipe.prep_minutes), "prep"),
        stat("flame", minutes(recipe.cook_minutes), "cook"),
        stat("sparkles", cap(recipe.difficulty), "difficulty"),
        recipe.nutrition_per_serving?.calories ? stat("leaf", `≈ ${Math.round(recipe.nutrition_per_serving.calories)}`, "kcal / serving") : null),
      recipe.diet_tags?.length ? h("ul", { class: "pills" }, recipe.diet_tags.map((t) => h("li", { class: "pill pill--mint", text: t }))) : null));

  // ---- actions
  const heart = h("button", { class: `btn heart${row?.favorite ? " is-on" : ""}`, type: "button", "aria-pressed": String(!!row?.favorite) },
    icon("heart"), row ? (row.favorite ? "Favourite" : "Saved") : "Save");
  heart.addEventListener("click", async () => {
    try {
      if (!row) {
        busy(heart, true);
        row = await api("/api/recipes", { method: "POST", body: { recipe } });
        busy(heart, false);
        clear(heart).append(icon("heart"), "Saved");
        history.replaceState({}, "", `/cookbook/${row.id}`);
        toast("Saved to your cookbook 📖", { icon: "❤️", action: { label: "Open", fn: () => navigate("/cookbook") } });
        return;
      }
      row = await api(`/api/recipes/${row.id}`, { method: "PATCH", body: { favorite: !row.favorite } });
      heart.classList.toggle("is-on", row.favorite);
      heart.setAttribute("aria-pressed", String(row.favorite));
      clear(heart).append(icon("heart"), row.favorite ? "Favourite" : "Saved");
      if (row.favorite) toast("Added to favourites", { icon: "💖" });
    } catch (err) { busy(heart, false); errorToast(err); }
  });

  const actionbar = h("div", { class: "actionbar no-print", role: "toolbar", "aria-label": "Recipe actions" },
    button("Start cooking", { variant: "primary", iconName: "play", onClick: async () => {
      const { openCookMode } = await import("./cookmode.js");
      openCookMode(recipe, { servings, savedId: () => row?.id });
    } }),
    heart,
    h("button", { class: "icon-btn", type: "button", "aria-label": "Print recipe", title: "Print", onClick: () => window.print() }, icon("printer")),
    saved ? h("button", { class: "icon-btn", type: "button", "aria-label": "Delete from cookbook", title: "Delete", onClick: async () => {
      if (!(await confirmDialog(`Remove “${recipe.title}” from your cookbook?`, { title: "Delete recipe?", confirm: "Delete", danger: true }))) return;
      try { await api(`/api/recipes/${row.id}`, { method: "DELETE" }); toast("Recipe deleted", { icon: "🗑️" }); navigate("/cookbook", { replace: true }); }
      catch (err) { errorToast(err); }
    } }, icon("trash")) : null);

  // ---- ingredients
  const ingList = h("ul", { class: "ings" });
  const servingsOut = h("output", { "aria-live": "polite", text: String(servings) });
  function renderIngredients() {
    const factor = servings / recipe.servings;
    clear(ingList);
    recipe.ingredients.forEach((ing, i) => {
      const id = `ing-${i}`;
      const qty = ing.quantity != null ? formatQty(ing.quantity * factor) : "";
      const name = ing.name.toLowerCase();
      const isYours = [...yours].some((y) => name.includes(y) || y.includes(name));
      const isNeed = needs.has(name);
      const subs = h("div", { class: "subs", hidden: true, "aria-live": "polite" });
      ingList.append(h("li", { class: "ing" },
        h("input", { type: "checkbox", id }),
        h("div", null,
          h("label", { for: id },
            qty ? h("span", { class: "ing__qty", text: `${qty}${ing.unit ? " " + ing.unit : ""} ` }) : null,
            ing.name, ing.optional ? h("span", { class: "muted", text: " (optional)" }) : null,
            ing.note ? h("span", { class: "ing__note", text: ing.note }) : null),
          h("button", { class: "link-btn no-print", type: "button", onClick: () => loadSubs(recipe, ing.name, subs) }, "🔁 Swap it"),
          subs),
        isYours ? h("span", { class: "ing__tag ing__tag--yours", text: "yours" }) : isNeed ? h("span", { class: "ing__tag ing__tag--need", text: "to buy" }) : h("span")));
    });
  }
  const step = (d) => { servings = Math.min(50, Math.max(1, servings + d)); servingsOut.textContent = servings; renderIngredients(); };
  renderIngredients();
  const side = h("aside", { class: "rbody__side" },
    h("section", { class: "card" },
      h("div", { class: "row", style: { "justify-content": "space-between", "margin-bottom": "8px" } },
        h("h2", { style: { margin: "0" }, text: "🧺 Ingredients" }),
        h("div", { class: "stepper", role: "group", "aria-label": "Servings" },
          h("button", { class: "icon-btn", type: "button", "aria-label": "Fewer servings", onClick: () => step(-1) }, icon("minus")),
          servingsOut,
          h("button", { class: "icon-btn", type: "button", "aria-label": "More servings", onClick: () => step(1) }, icon("plus")))),
      h("p", { class: "muted tiny", text: "Servings scale the quantities automatically." }),
      ingList));

  // ---- method
  const steps = h("ol", { class: "steps" }, recipe.steps.map((text, i) => h("li", { style: { "--i": String(i) } },
    h("p", { text }),
    detectTimers(text).map((t) => h("button", { class: "timer-chip", type: "button", onClick: () => startTimer(`Step ${i + 1}`, t.seconds) },
      icon("timer"), `Start ${t.label} timer`)))));

  const allergens = h("section", { class: "callout callout--sun" },
    h("h3", { text: "⚠️ Allergens: check for yourself" }),
    recipe.possible_allergens?.length ? h("p", null, "May contain: ", h("strong", { text: recipe.possible_allergens.join(", ") }), ".")
      : h("p", { text: "No common allergens detected automatically." }),
    h("p", { class: "tiny", text: "Detected from ingredient names. It can be incomplete, so always read product labels." }));

  const n = recipe.nutrition_per_serving;
  const nutrition = n && (n.calories || n.protein_g) ? h("section", { class: "callout callout--sky" },
    h("h3", { text: "📊 Nutrition per serving (rough estimate)" }),
    h("table", { class: "est-table" }, h("tbody", null,
      [["Calories", n.calories, "kcal"], ["Protein", n.protein_g, "g"], ["Carbs", n.carbs_g, "g"], ["Fat", n.fat_g, "g"]]
        .filter(([, v]) => v != null).map(([l, v, u]) => h("tr", null, h("th", { scope: "row", text: l }), h("td", { text: `≈ ${Math.round(v)} ${u}` }))))),
    h("p", { class: "tiny muted", style: { "margin-top": "8px" }, text: "AI estimate, not verified." })) : null;

  const remix = h("section", { class: "card card--grape no-print" },
    h("h2", { text: "🪄 Remix it" }),
    h("p", { class: "muted", text: "Want a twist? Tap one and get fresh variations." }),
    h("div", { class: "remix-row" }, REMIXES.map(([e, label]) => h("button", { class: "sticker", type: "button", onClick: () => {
      startGeneration(navigate, { count: 2, servings, cuisine: "Any", diets: state.results?.request?.diets || [],
        exclude: state.results?.request?.exclude || [], ingredients: state.results?.request?.ingredients || [],
        remix: { base_title: recipe.title.slice(0, 120), instruction: label } });
    } }, e, " ", label))));

  const notes = row ? notesPanel(row) : null;
  const main = h("div", { style: { display: "grid", gap: "18px" } },
    recipe.notices?.length ? h("section", { class: "callout callout--berry" }, h("h3", { text: "Heads up" }),
      h("ul", null, recipe.notices.map((x) => h("li", { text: x })))) : null,
    h("section", { class: "card" }, h("h2", { text: "👩‍🍳 Method" }), steps),
    recipe.tips?.length ? h("section", { class: "callout callout--mint" }, h("h3", { text: "💡 Chef's tips" }), h("ul", null, recipe.tips.map((t) => h("li", { text: t })))) : null,
    allergens, nutrition, notes, remix,
    h("p", { class: "tiny muted", text: DISCLAIMER }));

  return h("article", { class: "view" }, hero, actionbar, h("div", { class: "rbody" }, side, main));
}

function stat(ic, value, label) {
  return h("div", { class: "stat" }, icon(ic), h("div", null, h("b", { text: value }), h("small", { text: label })));
}

function notesPanel(row) {
  const area = h("textarea", { class: "input", id: "notes", maxlength: "2000", rows: "3", placeholder: "Your tweaks: 'extra green chilli', 'kids loved it'…", value: row.notes || "" });
  const status = h("span", { class: "muted tiny", "aria-live": "polite" });
  let t;
  area.addEventListener("input", () => {
    clearTimeout(t);
    status.textContent = "Saving…";
    t = setTimeout(async () => {
      try { await api(`/api/recipes/${row.id}`, { method: "PATCH", body: { notes: area.value } }); status.textContent = "Saved ✓"; }
      catch (err) { status.textContent = err.message; }
    }, 700);
  });
  return h("section", { class: "card card--sun" }, h("div", { class: "row", style: { "justify-content": "space-between" } },
    h("label", { for: "notes" }, h("h2", { style: { margin: "0" }, text: "📝 My notes" })), status), area,
    row.cooked_count ? h("p", { class: "muted tiny", style: { "margin-top": "8px" }, text: `Cooked ${row.cooked_count} time${row.cooked_count > 1 ? "s" : ""} 🎉` }) : null);
}

async function loadSubs(recipe, ingredient, box) {
  box.hidden = false;
  mount(box, h("span", { class: "muted", text: "Finding swaps…" }));
  try {
    const data = await api("/api/recipes/substitute", { method: "POST", timeoutMs: 60000,
      body: { recipe_title: recipe.title.slice(0, 120), ingredient: ingredient.slice(0, 60), diets: state.results?.request?.diets || [] } });
    mount(box, h("strong", { text: `Instead of ${ingredient}:` }),
      h("ul", null, data.substitutes.map((sub) => h("li", null, h("strong", { text: sub.name }), sub.ratio ? ` (${sub.ratio})` : "", sub.notes ? `: ${sub.notes}` : ""))));
  } catch (err) {
    mount(box, h("span", { class: "form-error", text: err.message }));
  }
}
