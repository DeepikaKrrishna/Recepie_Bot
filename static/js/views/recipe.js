// Recipe detail: fresh results, saved cookbook recipes and public share links.
import { api } from "../lib/api.js";
import { clear, h, mount } from "../lib/dom.js";
import { matColors, pantryCoverage, plateArt } from "../lib/food.js";
import { addDays, cap, dayName, formatQty, isoDate, minutes, money, shortDate } from "../lib/format.js";
import { icon } from "../lib/icons.js";
import { detectTimers, startTimer } from "../lib/timers.js";
import { loadPantry, loadShoppingCount, pantryNames, state } from "../lib/store.js";
import { busy, button, confirmDialog, emptyState, errorToast, modal, toast } from "../lib/ui.js";
import { startGeneration } from "./discover.js";

const DISCLAIMER = "AI-generated recipe. Quantities, times, cost and nutrition are estimates and may be wrong. Check labels for allergens, cook to safe internal temperatures and follow food-storage guidance.";

export async function renderTemp({ params, navigate }) {
  const recipe = state.results?.data?.recipes?.[Number(params[0])];
  if (!recipe) return gone(navigate, "That recipe isn't in your current results anymore.");
  return detail(recipe, { navigate, back: ["/results", "Back to results"] });
}

export async function renderSaved({ params, navigate }) {
  if (!state.user) { navigate(`/login?next=${encodeURIComponent(location.pathname)}`, { replace: true }); return h("div"); }
  try {
    const row = await api(`/api/recipes/${Number(params[0])}`);
    return detail(row.recipe, { navigate, saved: row, back: ["/cookbook", "Back to cookbook"] });
  } catch (err) {
    return gone(navigate, err.status === 404 ? "This recipe isn't in your cookbook." : err.message);
  }
}

export async function renderShared({ params, navigate }) {
  try {
    const shared = await api(`/api/shared/${params[0]}`);
    return detail(shared.recipe, { navigate, shareId: params[0], back: ["/", "Discover more recipes"] });
  } catch (err) {
    return gone(navigate, err.status === 404 ? "This shared recipe doesn't exist or is no longer shared." : err.message);
  }
}

function gone(navigate, text) {
  return h("section", { class: "view section" }, emptyState({ art: "🍽️", title: "Recipe not found", text,
    actions: [button("Go to Discover", { variant: "primary", onClick: () => navigate("/") })] }));
}

async function detail(recipe, { navigate, saved = null, shareId = null, back }) {
  let servings = recipe.servings;
  let savedRow = saved;
  if (state.user) await loadPantry();
  const pantry = state.user ? pantryNames() : null;
  const [mat] = matColors(recipe);

  // ---- hero
  const plate = plateArt(recipe, { size: 320 });
  plate.style.setProperty("view-transition-name", "hero-plate");
  const costPer = recipe.estimated_cost ? recipe.estimated_cost.amount / recipe.servings : null;
  const hero = h("section", { class: "rhero" },
    h("div", { class: "rhero__art", style: { background: `radial-gradient(closest-side, ${mat}, transparent)` } }, plate),
    h("div", null,
      h("a", { href: back[0], "data-link": "", class: "link-btn" }, `← ${back[1]}`),
      h("p", { class: "eyebrow", text: recipe.cuisine || "Recipe" }),
      h("h1", { text: recipe.title }),
      recipe.description ? h("p", { class: "hero__lede", text: recipe.description }) : null,
      h("div", { class: "statline" },
        stat("clock", minutes(recipe.prep_minutes), "prep"),
        stat("flame", minutes(recipe.cook_minutes), "cook"),
        stat("sparkles", cap(recipe.difficulty), "difficulty"),
        costPer != null ? stat("cart", `≈ ${money(costPer, recipe.estimated_cost.currency)}`, "per serving (est.)") : null),
      recipe.diet_tags?.length ? h("ul", { class: "pills" }, recipe.diet_tags.map((t) => h("li", { class: "pill pill--leaf", text: t }))) : null,
      recipe.uses_expiring?.length ? h("p", { class: "callout callout--leaf", style: { "margin-top": "12px" } },
        "🛟 Uses your expiring ", h("strong", { text: recipe.uses_expiring.join(", ") }), ". Nice save!") : null));

  // ---- action bar
  const heart = h("button", { class: `btn btn--ghost heart${savedRow?.favorite ? " is-on" : ""}`, type: "button", "aria-pressed": String(!!savedRow?.favorite) },
    icon("heart"), savedRow ? (savedRow.favorite ? "Favourite" : "Favourite?") : "Save");
  heart.addEventListener("click", async () => {
    if (!state.user) return askSignup(navigate, "save recipes");
    try {
      if (!savedRow) {
        busy(heart, true);
        savedRow = await api("/api/recipes", { method: "POST", body: { recipe, favorite: false } });
        busy(heart, false);
        clear(heart).append(icon("heart"), "Favourite?");
        toast("Saved to your cookbook", { icon: "📖", action: { label: "Open", fn: () => navigate(`/cookbook/${savedRow.id}`) } });
        history.replaceState({}, "", `/cookbook/${savedRow.id}`);
        planBtn.hidden = false; shareBtn.hidden = false;
        return;
      }
      savedRow = await api(`/api/recipes/${savedRow.id}`, { method: "PATCH", body: { favorite: !savedRow.favorite } });
      heart.classList.toggle("is-on", savedRow.favorite);
      heart.setAttribute("aria-pressed", String(savedRow.favorite));
      clear(heart).append(icon("heart"), savedRow.favorite ? "Favourite" : "Favourite?");
      toast(savedRow.favorite ? "Added to favourites" : "Removed from favourites", { icon: savedRow.favorite ? "❤️" : "🤍" });
    } catch (err) { busy(heart, false); errorToast(err); }
  });

  const ensureSaved = async () => {
    if (savedRow) return savedRow;
    savedRow = await api("/api/recipes", { method: "POST", body: { recipe } });
    history.replaceState({}, "", `/cookbook/${savedRow.id}`);
    clear(heart).append(icon("heart"), "Favourite?");
    return savedRow;
  };

  const planBtn = button("Plan", { variant: "ghost", iconName: "calendar", hidden: !!shareId && !state.user, onClick: async () => {
    if (!state.user) return askSignup(navigate, "plan meals");
    try { planModal(await ensureSaved(), servings, navigate); } catch (err) { errorToast(err); }
  } });
  const shareBtn = button("Share", { variant: "ghost", iconName: "share", hidden: !!shareId, onClick: async () => {
    if (!state.user) return askSignup(navigate, "share recipes");
    try {
      const row = await ensureSaved();
      const res = await api(`/api/recipes/${row.id}/share`, { method: "POST" });
      shareModal(`${location.origin}${res.path}`, recipe.title, row.id);
    } catch (err) { errorToast(err); }
  } });
  const saveShared = shareId ? button("Save to my cookbook", { variant: "ghost", iconName: "book", onClick: async (e) => {
    if (!state.user) return askSignup(navigate, "save recipes");
    const btn = e.currentTarget;
    try {
      busy(btn, true);
      const row = await api(`/api/shared/${shareId}/save`, { method: "POST" });
      toast("Saved to your cookbook", { icon: "📖" });
      navigate(`/cookbook/${row.id}`, { replace: true });
    } catch (err) { errorToast(err); busy(btn, false); }
  } }) : null;

  const actionbar = h("div", { class: "actionbar no-print", role: "toolbar", "aria-label": "Recipe actions" },
    button("Cook mode", { variant: "primary", iconName: "play", onClick: async () => {
      const { openCookMode } = await import("./cookmode.js");
      openCookMode(recipe, { servings, savedId: () => savedRow?.id, navigate });
    } }),
    shareId ? saveShared : heart, planBtn, shareBtn,
    h("button", { class: "icon-btn", type: "button", "aria-label": "Print recipe", onClick: () => window.print() }, icon("printer")));

  // ---- ingredients
  const ingList = h("ul", { class: "ings" });
  const servingsOut = h("output", { "aria-live": "polite", text: String(servings) });
  const missingBox = h("div");
  function renderIngredients() {
    const factor = servings / recipe.servings;
    clear(ingList);
    const cov = pantry ? pantryCoverage(recipe, pantry) : null;
    recipe.ingredients.forEach((ing, i) => {
      const id = `ing-${i}`;
      const qty = ing.quantity != null ? formatQty(ing.quantity * factor) : "";
      const has = pantry ? cov.have.includes(ing) : null;
      const subs = h("div", { class: "subs", hidden: true, "aria-live": "polite" });
      ingList.append(h("li", { class: "ing" },
        h("input", { type: "checkbox", id }),
        h("div", null,
          h("label", { for: id },
            qty ? h("span", { class: "ing__qty", text: `${qty}${ing.unit ? " " + ing.unit : ""} ` }) : null,
            ing.name, ing.optional ? h("span", { class: "muted", text: " (optional)" }) : null,
            ing.note ? h("span", { class: "ing__note", text: ing.note }) : null),
          h("button", { class: "link-btn no-print", type: "button", onClick: () => loadSubs(recipe, ing.name, subs) }, "Swap it"),
          subs),
        has === null ? h("span") : h("span", { class: `ing__have ing__have--${has ? "yes" : "no"}`, text: has ? "✓ have" : "need" })));
    });
    clear(missingBox);
    if (cov && cov.missing.length) {
      missingBox.append(button(`Add ${cov.missing.length} missing to shopping list`, { variant: "soft", size: "sm", iconName: "cart", onClick: async (e) => {
        const btn = e.currentTarget;
        try {
          busy(btn, true);
          await api("/api/shopping/bulk", { method: "POST", body: { items: cov.missing.map((m) => ({
            name: m.name, quantity: m.quantity != null ? Math.round(m.quantity * (servings / recipe.servings) * 100) / 100 : null, unit: m.unit || "", source: recipe.title.slice(0, 80),
          })) } });
          loadShoppingCount();
          toast(`Added ${cov.missing.length} items to your shopping list`, { icon: "🛒", action: { label: "View", fn: () => navigate("/shopping") } });
        } catch (err) { errorToast(err); } finally { busy(btn, false); }
      } }));
    } else if (cov) {
      missingBox.append(h("p", { class: "callout callout--leaf tiny", text: "🎉 You have everything for this in your pantry." }));
    }
  }
  const step = (d) => { servings = Math.min(50, Math.max(1, servings + d)); servingsOut.textContent = servings; renderIngredients(); };
  renderIngredients();

  const side = h("aside", { class: "rbody__side" },
    h("section", { class: "panel" },
      h("div", { class: "row", style: { "justify-content": "space-between", "margin-bottom": "6px" } },
        h("h2", { style: { margin: "0" }, text: "Ingredients" }),
        h("div", { class: "stepper", role: "group", "aria-label": "Servings" },
          h("button", { class: "icon-btn", type: "button", "aria-label": "Fewer servings", onClick: () => step(-1) }, icon("minus")),
          servingsOut,
          h("button", { class: "icon-btn", type: "button", "aria-label": "More servings", onClick: () => step(1) }, icon("plus")))),
      h("p", { class: "muted tiny", text: "Quantities scale with servings." }),
      ingList, missingBox));

  // ---- method
  const steps = h("ol", { class: "steps" }, recipe.steps.map((text, i) => h("li", null,
    h("p", { text }),
    h("div", { class: "row" }, detectTimers(text).map((t) => h("button", { class: "timer-chip", type: "button", onClick: () => startTimer(`Step ${i + 1}`, t.seconds) },
      icon("timer"), `Start ${t.label} timer`))))));

  const allergens = h("section", { class: "callout callout--warn" },
    h("h3", { text: "⚠️ Allergens: check for yourself" }),
    recipe.possible_allergens?.length ? h("p", null, "May contain: ", h("strong", { text: recipe.possible_allergens.join(", ") }), ".")
      : h("p", { text: "No common allergens detected automatically." }),
    h("p", { class: "tiny", text: "Detected from ingredient names and the AI. This list can be incomplete. Never rely on it for allergies. Read every product label." }));

  const estimates = (recipe.estimated_cost || recipe.nutrition_per_serving) ? h("section", { class: "callout callout--info" },
    h("h3", { text: "Estimates (unverified)" }),
    h("table", { class: "est-table" }, h("tbody", null,
      recipe.estimated_cost ? h("tr", null, h("th", { scope: "row", text: "Whole recipe" }), h("td", { text: `≈ ${money(recipe.estimated_cost.amount, recipe.estimated_cost.currency)}` })) : null,
      ...nutritionRows(recipe.nutrition_per_serving))),
    h("p", { class: "tiny muted", style: { "margin-top": "8px" }, text: "Rough AI estimates, not checked against a nutrition database or local prices." })) : null;

  const remixInput = h("input", { class: "input", id: "remix", maxlength: "200", placeholder: "Make it spicier · no onion-garlic · air-fryer version · use millet" });
  const remix = h("section", { class: "panel no-print" },
    h("h2", { text: "Remix this recipe" }),
    h("p", { class: "muted", text: "Tell the bot what to change and get fresh variations." }),
    h("form", { class: "row", onSubmit: (e) => {
      e.preventDefault();
      const instruction = remixInput.value.trim();
      if (!instruction) { remixInput.focus(); return; }
      startGeneration(navigate, { count: 2, servings, cuisine: "Any", diets: state.results?.request?.diets || [],
        exclude: state.results?.request?.exclude || [], remix: { base_title: recipe.title.slice(0, 120), instruction } });
    } }, h("label", { class: "sr-only", for: "remix", text: "How should we change it?" }), h("div", { class: "grow" }, remixInput),
      button("Remix", { variant: "dark", iconName: "wand", type: "submit" })));

  const notes = savedRow ? notesPanel(savedRow) : null;

  const main = h("div", { style: { display: "grid", gap: "18px" } },
    recipe.notices?.length ? h("section", { class: "callout callout--warn" }, h("h3", { text: "Notes about your filters" }),
      h("ul", null, recipe.notices.map((n) => h("li", { text: n })))) : null,
    allergens,
    h("section", { class: "panel" }, h("h2", { text: "Method" }), steps),
    recipe.tips?.length ? h("section", { class: "callout callout--leaf" }, h("h3", { text: "💡 Tips" }), h("ul", null, recipe.tips.map((t) => h("li", { text: t })))) : null,
    estimates, notes, remix,
    h("p", { class: "tiny muted", text: DISCLAIMER }));

  return h("article", { class: "view" }, hero, actionbar, h("div", { class: "rbody" }, side, main));
}

function stat(ic, value, label) {
  return h("div", { class: "stat" }, icon(ic), h("div", null, h("b", { text: value }), h("small", { text: label })));
}

function nutritionRows(n) {
  if (!n) return [];
  return [["Calories", n.calories, "kcal"], ["Protein", n.protein_g, "g"], ["Carbs", n.carbs_g, "g"], ["Fat", n.fat_g, "g"]]
    .filter(([, v]) => v != null)
    .map(([l, v, u]) => h("tr", null, h("th", { scope: "row", text: `${l} / serving` }), h("td", { text: `≈ ${Math.round(v)} ${u}` })));
}

function notesPanel(row) {
  const area = h("textarea", { class: "input notes", id: "notes", maxlength: "2000", placeholder: "Your tweaks: 'add an extra green chilli', 'kids loved it'…", value: row.notes || "" });
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
  return h("section", { class: "panel" }, h("div", { class: "row", style: { "justify-content": "space-between" } },
    h("label", { for: "notes" }, h("h2", { style: { margin: "0" }, text: "My notes" })), status), area,
    row.cooked_count ? h("p", { class: "muted tiny", style: { "margin-top": "8px" }, text: `Cooked ${row.cooked_count} time${row.cooked_count > 1 ? "s" : ""}.` }) : null);
}

async function loadSubs(recipe, ingredient, box) {
  box.hidden = false;
  mount(box, h("span", { class: "muted", text: "Finding swaps…" }));
  try {
    const data = await api("/api/recipes/substitute", { method: "POST", timeoutMs: 60000,
      body: { recipe_title: recipe.title.slice(0, 120), ingredient: ingredient.slice(0, 60), diets: state.results?.request?.diets || state.prefs?.diets || [] } });
    mount(box, h("strong", { text: `Instead of ${ingredient}:` }),
      h("ul", null, data.substitutes.map((sub) => h("li", null, h("strong", { text: sub.name }), sub.ratio ? ` (${sub.ratio})` : "", sub.notes ? `: ${sub.notes}` : ""))));
  } catch (err) {
    mount(box, h("span", { class: "form-error", text: err.message }));
  }
}

function askSignup(navigate, what) {
  toast(`Create a free account to ${what}.`, { icon: "🔐", action: { label: "Sign up", fn: () => navigate(`/signup?next=${encodeURIComponent(location.pathname)}`) } });
}

function planModal(row, servings, navigate) {
  const today = new Date();
  let day = isoDate(today), slot = "dinner";
  const days = h("div", { class: "toggles" }, Array.from({ length: 7 }, (_, i) => {
    const d = addDays(today, i);
    return h("label", { class: "toggle" }, h("input", { type: "radio", name: "pday", value: isoDate(d), checked: i === 0, onChange: (e) => { day = e.target.value; } }),
      h("span", { text: i === 0 ? "Today" : `${dayName(d)} ${shortDate(d)}` }));
  }));
  const slots = h("div", { class: "toggles" }, [["breakfast", "🌅 Breakfast"], ["lunch", "🍱 Lunch"], ["dinner", "🌙 Dinner"], ["snack", "☕ Snack"]].map(([v, l]) =>
    h("label", { class: "toggle" }, h("input", { type: "radio", name: "pslot", value: v, checked: v === slot, onChange: () => { slot = v; } }), h("span", { text: l }))));
  const dlg = modal(`Plan “${row.title}”`, [
    h("fieldset", { class: "field" }, h("legend", { class: "label", text: "Day" }), days),
    h("fieldset", { class: "field" }, h("legend", { class: "label", text: "Meal" }), slots),
    button(`Add to plan (${servings} servings)`, { variant: "primary", iconName: "calendar", onClick: async () => {
      try {
        await api("/api/plan", { method: "PUT", body: { day, slot, recipe_id: row.id, servings } });
        dlg.close();
        toast("Added to your meal plan", { icon: "📅", action: { label: "View week", fn: () => navigate("/plan") } });
      } catch (err) { errorToast(err); }
    } }),
  ]);
}

function shareModal(url, title, id) {
  const input = h("input", { class: "input", readOnly: true, value: url, "aria-label": "Share link", onFocus: (e) => e.target.select() });
  const dlg = modal("Share this recipe", [
    h("p", { class: "muted", text: "Anyone with this link can view the recipe (not your notes or account). You can stop sharing any time." }),
    input,
    h("div", { class: "row", style: { "margin-top": "14px" } },
      navigator.share ? button("Share…", { variant: "primary", iconName: "share", onClick: () => navigator.share({ title, url }).catch(() => {}) }) : null,
      button("Copy link", { variant: navigator.share ? "ghost" : "primary", iconName: "list", onClick: async () => {
        try { await navigator.clipboard.writeText(url); toast("Link copied", { icon: "🔗" }); } catch { input.select(); toast("Press Ctrl/Cmd+C to copy", { icon: "🔗" }); }
      } }),
      button("Stop sharing", { variant: "ghost", onClick: async () => {
        if (!(await confirmDialog("The link will stop working for everyone.", { title: "Stop sharing?", confirm: "Stop sharing", danger: true }))) return;
        try { await api(`/api/recipes/${id}/share`, { method: "DELETE" }); dlg.close(); toast("Sharing turned off", { icon: "🔒" }); } catch (err) { errorToast(err); }
      } })),
  ]);
}

