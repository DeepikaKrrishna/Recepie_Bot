// Discover: hero, ingredient search, moods, filters, rescue banner, quick matches.
import { api } from "../lib/api.js";
import { clear, h, mount, s, stagger } from "../lib/dom.js";
import { emojiFor, MOODS, STAPLES } from "../lib/food.js";
import { daysLeftLabel } from "../lib/format.js";
import { icon } from "../lib/icons.js";
import { loadOptions, loadPantry, state } from "../lib/store.js";
import { button, chipInput, emptyState, mascot, toast } from "../lib/ui.js";

const TIMES = [["", "Any time"], ["15", "15 min"], ["30", "30 min"], ["45", "45 min"], ["60", "1 hour"], ["90", "1.5 h"]];
const SPICE = [["", "Any"], ["mild", "🌶️ Mild"], ["medium", "🌶️🌶️ Medium"], ["hot", "🌶️🌶️🌶️ Hot"]];

export function startGeneration(navigate, request) {
  state.results = { request, data: null, promise: null, error: null };
  navigate("/results");
}

function applyPrefs(draft) {
  if (draft._prefsApplied || !state.prefs) return;
  const p = state.prefs;
  if (draft.diets === null) draft.diets = [...p.diets];
  if (draft.cuisine === null) draft.cuisine = p.cuisine;
  if (draft.servings === null) draft.servings = p.servings;
  if (!draft.exclude.length) draft.exclude.push(...p.exclude);
  draft.currency = draft.currency || p.currency;
  draft._prefsApplied = true;
}

export async function render({ navigate }) {
  const opts = await loadOptions().catch(() => ({ cuisines: ["Any"], diets: [], ai_available: false, default_currency: "INR" }));
  const draft = state.draft;
  applyPrefs(draft);
  draft.diets ??= [];
  draft.cuisine ??= "Any";
  draft.servings ??= 2;
  draft.currency ||= opts.default_currency;

  // ---- hero
  const hero = h("section", { class: "hero" },
    h("div", null,
      h("p", { class: "eyebrow", text: "Your spice-box sous-chef" }),
      h("h1", null, "What's cooking with ", h("span", { class: "em" }, "what you've got",
        s("svg", { viewBox: "0 0 200 20", preserveAspectRatio: "none", "aria-hidden": "true" }, s("path", { d: "M3 14 C 50 4, 100 4, 197 12" })))),
      h("p", { class: "hero__lede", text: "Add what's in your kitchen. Recipe Bot suggests dishes that fit your diet, time and budget, rescues ingredients before they expire, and turns your week's plan into a shopping list." })),
    h("div", { class: "hero__stage", "aria-hidden": "true" },
      h("div", { class: "orbit" }, ["🍅", "🧅", "🌶️", "🥥", "🍋", "🌿", "🧄", "🍚"].map((e, i) => {
        const a = (i / 8) * Math.PI * 2;
        return h("span", { style: { left: `${50 + Math.cos(a) * 44}%`, top: `${50 + Math.sin(a) * 44}%` }, text: e });
      })),
      mascot({ size: 230 })));

  // ---- rescue banner (signed-in users with expiring items)
  const rescueSlot = h("div");
  if (state.user) {
    loadPantry(true).then((p) => {
      const soon = (p?.expiring || []).filter((i) => i.status === "soon" || (i.status === "expired" && i.days_left >= -1));
      if (!soon.length) return;
      const names = soon.slice(0, 12).map((i) => i.name);
      mount(rescueSlot, h("div", { class: "rescue-banner rise" },
        h("span", { class: "rescue-banner__icon", "aria-hidden": "true", text: "🛟" }),
        h("p", null, h("strong", { text: `${soon.length} item${soon.length > 1 ? "s" : ""} expiring soon: ` }),
          soon.slice(0, 4).map((i, idx) => [idx ? ", " : "", `${i.name} (${daysLeftLabel(i.days_left)})`]), soon.length > 4 ? "…" : ""),
        button("Rescue them", { variant: "leaf", iconName: "rescue", onClick: () => {
          startGeneration(navigate, { ...baseRequest(), ingredients: [], use_first: names, count: 3 });
        } })));
    });
  }

  // ---- ingredients
  const ingredients = chipInput({ id: "ingredients", items: draft.ingredients, max: 30, label: "Ingredients you have",
    placeholder: draft.ingredients.length ? "Add another…" : "e.g. rice, tomato, paneer", suggestions: STAPLES });
  const voiceBtn = voiceButton((text) => ingredients.add(text));
  if (voiceBtn) ingredients.el.append(voiceBtn);

  const quickpicks = h("div", { class: "quickpicks", "aria-label": "Common ingredients" },
    STAPLES.slice(0, 12).map((st) => h("button", { type: "button", onClick: () => ingredients.add(st) }, `${emojiFor(st)} ${st}`)));
  const pantryBtn = state.user ? button("Use my pantry", { variant: "soft", size: "sm", iconName: "jar", onClick: async () => {
    const p = await loadPantry(true);
    const names = (p?.items || []).map((i) => i.name);
    if (!names.length) { toast("Your pantry is empty. Add items on the Pantry tab.", { icon: "🫙" }); return; }
    const n = ingredients.add(names.slice(0, 30).join(","));
    toast(n ? `Added ${n} pantry item${n > 1 ? "s" : ""}` : "Those are already added", { icon: "🫙" });
  } }) : null;

  const dish = h("input", { class: "input", id: "dish", type: "text", maxlength: "120", value: draft.dish,
    placeholder: "Optional: a dish idea, e.g. 'something like a dosa'", onInput: (e) => { draft.dish = e.target.value; } });

  // ---- moods
  const moods = h("div", { class: "moods", role: "radiogroup", "aria-label": "What are you in the mood for?" },
    MOODS.map(([value, emoji, label]) => h("label", { class: "mood" },
      h("input", { type: "radio", name: "mood", value, checked: draft.mood === value, onClick: (e) => {
        if (draft.mood === value) { e.target.checked = false; draft.mood = null; } else draft.mood = value;
      } }),
      h("span", null, h("b", { "aria-hidden": "true", text: emoji }), label))));

  // ---- filters
  const cuisine = h("select", { class: "input", id: "cuisine", onChange: (e) => { draft.cuisine = e.target.value; } },
    opts.cuisines.map((c) => h("option", { value: c, selected: c === draft.cuisine, text: c })));
  const diets = h("div", { class: "toggles" }, opts.diets.map((d) => h("label", { class: "toggle toggle--leaf" },
    h("input", { type: "checkbox", value: d, checked: draft.diets.includes(d), onChange: (e) => {
      if (e.target.checked) draft.diets.push(d); else draft.diets.splice(draft.diets.indexOf(d), 1);
    } }), h("span", { text: d }))));
  const radios = (name, list, key) => h("div", { class: "toggles", role: "radiogroup" }, list.map(([v, label]) => h("label", { class: "toggle" },
    h("input", { type: "radio", name, value: v, checked: (draft[key] || "") === v, onChange: () => { draft[key] = v; } }), h("span", { text: label }))));
  const servingsOut = h("output", { id: "servingsOut", text: String(draft.servings) });
  const servings = h("div", { class: "stepper" },
    h("button", { class: "icon-btn", type: "button", "aria-label": "Fewer servings", onClick: () => { draft.servings = Math.max(1, draft.servings - 1); servingsOut.textContent = draft.servings; } }, icon("minus")),
    servingsOut,
    h("button", { class: "icon-btn", type: "button", "aria-label": "More servings", onClick: () => { draft.servings = Math.min(20, draft.servings + 1); servingsOut.textContent = draft.servings; } }, icon("plus")));
  const currency = h("select", { class: "input", "aria-label": "Currency", style: { width: "96px", flex: "none" }, onChange: (e) => { draft.currency = e.target.value; } },
    ["INR", "USD", "EUR", "GBP", "AUD", "CAD", "SGD", "AED"].map((c) => h("option", { value: c, selected: c === draft.currency, text: c })));
  const budget = h("input", { class: "input", id: "budget", type: "number", inputmode: "decimal", min: "1", placeholder: "e.g. 250", value: draft.budget,
    onInput: (e) => { draft.budget = e.target.value; } });
  const exclude = chipInput({ id: "exclude", items: draft.exclude, max: 20, variant: "chip--exclude", label: "Never include", placeholder: "e.g. peanuts, mushroom",
    onChange: () => filters.dispatchEvent(new Event("change")) }); // `filters` is defined below; called later

  const activeFilters = () => [draft.cuisine !== "Any", draft.diets.length, draft.time, draft.difficulty, draft.spice, draft.budget, draft.exclude.length].filter(Boolean).length;
  const filterCount = h("span", { class: "badge", hidden: !activeFilters(), text: String(activeFilters()) });
  const filters = h("details", { class: "filters", open: activeFilters() > 0, onChange: () => { const n = activeFilters(); filterCount.textContent = n; filterCount.hidden = !n; } },
    h("summary", null, icon("filter"), "Filters", filterCount, icon("chevronDown")),
    h("div", { class: "filters__body grid-2" },
      h("div", { class: "field" }, h("label", { class: "label", for: "cuisine", text: "Cuisine" }), cuisine),
      h("div", { class: "field" }, h("span", { class: "label", text: "Servings" }), servings),
      h("fieldset", { class: "field span-2" }, h("legend", { class: "label", text: "Diet" }), diets),
      h("fieldset", { class: "field" }, h("legend", { class: "label", text: "Max total time" }), radios("time", TIMES, "time")),
      h("fieldset", { class: "field" }, h("legend", { class: "label", text: "Difficulty" }), radios("difficulty", [["", "Any"], ["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]], "difficulty")),
      h("fieldset", { class: "field" }, h("legend", { class: "label", text: "Spice level" }), radios("spice", SPICE, "spice")),
      h("div", { class: "field" }, h("label", { class: "label", for: "budget", text: "Budget for the whole dish" }), h("div", { class: "row" }, currency, h("div", { class: "grow" }, budget)),
        h("p", { class: "help", text: "Costs are rough AI estimates, not live prices." })),
      h("div", { class: "field span-2" }, h("label", { class: "label", for: "exclude", text: "Never include" }), exclude.el,
        h("p", { class: "help", text: "Any suggestion containing these is removed, but always double-check labels if you have allergies." }))));

  function baseRequest() {
    const b = parseFloat(draft.budget);
    return {
      ingredients: [...draft.ingredients], exclude: [...draft.exclude], dish: draft.dish.trim() || null,
      cuisine: draft.cuisine, diets: [...draft.diets], max_total_minutes: draft.time ? Number(draft.time) : null,
      difficulty: draft.difficulty || null, servings: draft.servings, budget: Number.isFinite(b) && b > 0 ? b : null,
      currency: draft.currency, count: 3, occasion: draft.mood || null, spice: draft.spice || null,
    };
  }

  const formError = h("p", { class: "form-error", role: "alert", hidden: true });
  const quickOut = h("div", { "aria-live": "polite" });
  const findBtn = button("Find recipes", { variant: "primary", size: "lg", iconName: "sparkles", type: "submit" });
  if (!opts.ai_available) findBtn.disabled = true;

  const form = h("form", { class: "panel search", novalidate: true, onSubmit: (e) => {
    e.preventDefault();
    const pending = ingredients.input.value.trim();
    if (pending) { ingredients.add(pending); ingredients.input.value = ""; }
    if (!draft.ingredients.length && !draft.dish.trim()) {
      formError.textContent = "Add at least one ingredient or a dish idea.";
      formError.hidden = false;
      ingredients.input.focus();
      return;
    }
    formError.hidden = true;
    startGeneration(navigate, baseRequest());
  } },
    h("div", { class: "search__main" },
      h("div", { class: "row", style: { "justify-content": "space-between" } },
        h("label", { class: "label", for: "ingredients", style: { margin: "0" }, text: "What's in your kitchen?" }), pantryBtn),
      ingredients.el, quickpicks, dish),
    h("h2", { class: "label", style: { "margin-top": "18px", "font-family": "var(--font-body)", "font-size": ".92rem" }, text: "In the mood for…" }),
    moods,
    filters,
    formError,
    h("div", { class: "search__actions" }, findBtn,
      button("Quick matches", { variant: "ghost", size: "lg", iconName: "search", onClick: () => quickMatches() })),
    !opts.ai_available ? h("p", { class: "callout callout--warn", style: { "margin-top": "12px" }, text: "AI recipe generation isn't configured on this server yet. Quick matches still work." }) : null,
    quickOut);

  async function quickMatches() {
    const terms = [...draft.ingredients];
    if (ingredients.input.value.trim()) terms.push(ingredients.input.value.trim());
    if (!terms.length) { formError.textContent = "Add an ingredient to see quick matches."; formError.hidden = false; return; }
    formError.hidden = true;
    mount(quickOut, h("p", { class: "muted", style: { "margin-top": "14px" }, text: "Looking through our recipe box…" }));
    const params = new URLSearchParams({ ingredients: terms.join(", ") });
    draft.diets.forEach((d) => params.append("diets", d));
    draft.exclude.forEach((x) => params.append("exclude", x));
    try {
      const data = await api(`/api/suggest?${params}`);
      clear(quickOut);
      if (!data.matches.length) { quickOut.append(h("p", { class: "muted", style: { "margin-top": "14px" }, text: "None of our saved recipes fit. Try Find recipes for AI ideas." })); return; }
      quickOut.append(h("div", { style: { "margin-top": "16px" } },
        h("p", { class: "label", text: data.fallback ? "No close matches. These popular dishes fit your filters:" : "Quick matches from the recipe box:" }),
        h("div", { class: "quickpicks" }, data.matches.map((m, i) => stagger(h("button", { type: "button", title: m.ingredients, onClick: () => {
          draft.dish = m.title; dish.value = m.title; startGeneration(navigate, baseRequest());
        } }, `${emojiFor(m.ingredients)} ${m.title}`), i))),
        h("p", { class: "help", text: "Pick one and we'll write a full recipe that fits your filters." })));
    } catch (err) {
      mount(quickOut, h("p", { class: "form-error", role: "alert", text: err.message }));
    }
  }

  // ---- recent searches (signed in)
  const recent = h("div");
  if (state.user) {
    api("/api/account/history").then((rows) => {
      if (!rows.length) return;
      mount(recent, h("section", { class: "section" },
        h("div", { class: "section__head" }, h("h2", { text: "Cook it again" }), h("a", { href: "/account", "data-link": "", class: "link-btn" }, "History settings")),
        h("div", { class: "cards" }, rows.slice(0, 3).map((r, i) => stagger(h("button", { type: "button", class: "panel", style: { "text-align": "left", cursor: "pointer" },
          onClick: () => startGeneration(navigate, { count: 3, servings: 2, ...r.request }) },
          h("p", { class: "label", text: (r.request.ingredients || r.request.use_first || []).slice(0, 5).join(", ") || r.request.dish || "Your search" }),
          h("p", { class: "muted tiny", text: r.titles.join(" · ") })), i)))));
    }).catch(() => {});
  }

  // ---- feature showcase
  const features = [
    ["🛟", "Food-waste rescue", "Track expiry dates in your pantry and get recipes built around what's about to go off."],
    ["👩‍🍳", "Hands-free Cook Mode", "Big step-by-step view with auto-detected timers, voice commands and read-aloud. Keeps your screen awake too."],
    ["📅", "Plan → shop", "Drag meals into your week. One tap builds a shopping list grouped by aisle, minus what you already have."],
    ["🪔", "Indian kitchens first", "South & North Indian regional styles, Jain and eggetarian diets, tiffin ideas, INR budgets."],
  ];
  const showcase = h("section", { class: "section" },
    h("div", { class: "section__head" }, h("div", null, h("p", { class: "eyebrow", text: "Why Recipe Bot" }), h("h2", { text: "More than a recipe generator" }))),
    h("div", { class: "cards" }, features.map(([e, t, d], i) => stagger(h("article", { class: "panel" },
      h("div", { style: { "font-size": "2rem" }, "aria-hidden": "true", text: e }), h("h3", { text: t }), h("p", { class: "muted", text: d })), i))));

  return h("div", { class: "view" }, hero, rescueSlot, form, recent, showcase,
    !state.user ? h("section", { class: "section" }, emptyState({ art: "🫙", title: "Save recipes, track your pantry, plan your week",
      text: "A free account keeps your cookbook, pantry, meal plan and shopping list in sync on all your devices.",
      actions: [h("a", { class: "btn btn--primary", href: "/signup", "data-link": "" }, "Create a free account")] })) : null);
}

function voiceButton(onText) {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Rec) return null;
  let rec = null;
  const btn = h("button", { class: "icon-btn", type: "button", "aria-label": "Say your ingredients", "aria-pressed": "false", title: "Say your ingredients", onClick: () => {
    if (rec) { rec.stop(); return; }
    rec = new Rec();
    rec.lang = "en-IN";
    rec.interimResults = false;
    btn.setAttribute("aria-pressed", "true");
    rec.onresult = (ev) => onText(ev.results[0][0].transcript);
    rec.onerror = (ev) => toast(ev.error === "not-allowed" ? "Microphone access was blocked." : "Didn't catch that. Try typing instead.", { icon: "🎙️" });
    rec.onend = () => { rec = null; btn.setAttribute("aria-pressed", "false"); };
    rec.start();
  } }, icon("mic"));
  return btn;
}
