// Cook: tell the bot what's in your kitchen, pick a mood and filters, go.
import { h } from "../lib/dom.js";
import { emojiFor, MOODS, STAPLES } from "../lib/food.js";
import { icon } from "../lib/icons.js";
import { loadOptions, state } from "../lib/store.js";
import { button, chipInput, mascot, toast } from "../lib/ui.js";

const TIMES = [["", "Any time"], ["15", "⚡ 15 min"], ["30", "30 min"], ["45", "45 min"], ["60", "1 hour"]];
const SPICE = [["", "Any"], ["mild", "🌶️ Mild"], ["medium", "🌶️🌶️ Medium"], ["hot", "🌶️🌶️🌶️ Hot"]];
const GREETINGS = ["What's in your kitchen today?", "What are we cooking?", "Got ingredients? Let's make magic.", "Hungry? Show me your fridge."];

export function startGeneration(navigate, request) {
  state.results = { request, data: null, promise: null };
  navigate("/results");
}

export async function render({ navigate }) {
  const opts = await loadOptions().catch(() => ({ cuisines: ["Any"], diets: [], ai_available: false }));
  const d = state.draft;
  const name = state.user?.display_name;
  const hour = new Date().getHours();
  const hi = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  // ---- greeting
  const hello = h("section", { class: "hello" },
    h("div", null,
      h("span", { class: "eyebrow", text: `👋 ${hi}${name ? ", " + name : ""}` }),
      h("h1", { text: GREETINGS[Math.floor(Math.random() * GREETINGS.length)] })),
    h("div", { class: "hello__mascot", "aria-hidden": "true" }, mascot({ size: 140 })));

  // ---- ingredients
  const ingredients = chipInput({ id: "ingredients", items: d.ingredients, max: 30, label: "Ingredients you have",
    placeholder: d.ingredients.length ? "Add more…" : "Type an ingredient and press Enter, e.g. paneer", suggestions: STAPLES });
  const voice = voiceButton((text) => ingredients.add(text));
  if (voice) ingredients.el.append(voice);
  const stickers = h("div", { class: "stickers", "aria-label": "Quick add" },
    STAPLES.map((st) => h("button", { class: "sticker", type: "button", onClick: () => { ingredients.add(st); } }, emojiFor(st), " ", st)));
  const dish = h("input", { class: "input", id: "dish", type: "text", maxlength: "120", value: d.dish,
    placeholder: "Craving something specific? e.g. 'something like biryani' (optional)", onInput: (e) => { d.dish = e.target.value; } });

  // ---- moods
  const moods = h("div", { class: "moods", role: "radiogroup", "aria-label": "Mood" },
    MOODS.map(([value, emoji, label]) => h("label", { class: "mood" },
      h("input", { type: "radio", name: "mood", value, checked: d.mood === value, onClick: (e) => {
        if (d.mood === value) { e.target.checked = false; d.mood = null; } else d.mood = value;
      } }),
      h("span", null, h("b", { "aria-hidden": "true", text: emoji }), label))));

  // ---- filters
  const radios = (name, list, key) => h("div", { class: "toggles", role: "radiogroup" }, list.map(([v, label]) => h("label", { class: "toggle" },
    h("input", { type: "radio", name, value: v, checked: (d[key] || "") === v, onChange: () => { d[key] = v; updateCount(); } }), h("span", { text: label }))));
  const cuisine = h("select", { class: "input", id: "cuisine", onChange: (e) => { d.cuisine = e.target.value; updateCount(); } },
    opts.cuisines.map((c) => h("option", { value: c, selected: c === d.cuisine, text: c })));
  const diets = h("div", { class: "toggles" }, opts.diets.map((x) => h("label", { class: "toggle" },
    h("input", { type: "checkbox", value: x, checked: d.diets.includes(x), onChange: (e) => {
      if (e.target.checked) d.diets.push(x); else d.diets.splice(d.diets.indexOf(x), 1);
      updateCount();
    } }), h("span", { text: x }))));
  const servingsOut = h("output", { text: String(d.servings) });
  const servings = h("div", { class: "stepper", role: "group", "aria-label": "Servings" },
    h("button", { class: "icon-btn", type: "button", "aria-label": "Fewer servings", onClick: () => { d.servings = Math.max(1, d.servings - 1); servingsOut.textContent = d.servings; } }, icon("minus")),
    servingsOut,
    h("button", { class: "icon-btn", type: "button", "aria-label": "More servings", onClick: () => { d.servings = Math.min(20, d.servings + 1); servingsOut.textContent = d.servings; } }, icon("plus")));
  const exclude = chipInput({ id: "exclude", items: d.exclude, max: 20, variant: "chip--exclude", label: "Never include", placeholder: "e.g. peanuts, mushroom", onChange: () => updateCount() });

  const countFilters = () => [d.cuisine !== "Any", d.diets.length, d.time, d.difficulty, d.spice, d.exclude.length].filter(Boolean).length;
  const badge = h("span", { class: "badge", hidden: !countFilters(), text: String(countFilters()) });
  function updateCount() { const n = countFilters(); badge.textContent = String(n); badge.hidden = !n; }
  const filters = h("details", { class: "filters", open: countFilters() > 0 },
    h("summary", null, icon("filter"), "Filters", badge, icon("chevronDown")),
    h("div", { class: "filters__body grid-2" },
      h("div", { class: "field" }, h("label", { class: "label", for: "cuisine", text: "Cuisine" }), cuisine),
      h("div", { class: "field" }, h("span", { class: "label", text: "Servings" }), servings),
      h("fieldset", { class: "field span-2" }, h("legend", { class: "label", text: "Diet" }), diets),
      h("fieldset", { class: "field" }, h("legend", { class: "label", text: "Time" }), radios("time", TIMES, "time")),
      h("fieldset", { class: "field" }, h("legend", { class: "label", text: "Spice" }), radios("spice", SPICE, "spice")),
      h("fieldset", { class: "field" }, h("legend", { class: "label", text: "Difficulty" }), radios("difficulty", [["", "Any"], ["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]], "difficulty")),
      h("div", { class: "field span-2" }, h("label", { class: "label", for: "exclude", text: "Never include" }), exclude.el,
        h("p", { class: "help", text: "Anything containing these is filtered out, but always check labels if you have allergies." }))));

  const formError = h("p", { class: "form-error", role: "alert", hidden: true });
  const cook = button("Cook something!", { variant: "primary", size: "lg", iconName: "sparkles", type: "submit" });
  if (!opts.ai_available) cook.disabled = true;
  const surprise = button("Surprise me", { variant: "sun", size: "lg", onClick: () => {
    const picks = [...STAPLES].sort(() => Math.random() - 0.5).slice(0, 3);
    picks.forEach((p) => ingredients.add(p));
    toast(`Let's try ${picks.join(", ")}!`, { icon: "🎲" });
  } }, );

  const request = () => ({
    ingredients: [...d.ingredients], exclude: [...d.exclude], dish: d.dish.trim() || null, cuisine: d.cuisine,
    diets: [...d.diets], max_total_minutes: d.time ? Number(d.time) : null, difficulty: d.difficulty || null,
    servings: d.servings, count: 3, occasion: d.mood || null, spice: d.spice || null,
  });

  const form = h("form", { class: "card kitchen", novalidate: true, onSubmit: (e) => {
    e.preventDefault();
    const pending = ingredients.input.value.trim();
    if (pending) { ingredients.add(pending); ingredients.input.value = ""; }
    if (!d.ingredients.length && !d.dish.trim()) {
      formError.textContent = "Add at least one ingredient (or a dish idea) first. 🥕";
      formError.hidden = false;
      ingredients.input.focus();
      return;
    }
    formError.hidden = true;
    startGeneration(navigate, request());
  } },
    h("label", { class: "label", for: "ingredients", text: "🧺 What do you have?" }),
    ingredients.el, stickers, dish,
    h("h2", { class: "label", style: { "margin-top": "20px" }, text: "😋 In the mood for…" }),
    moods, filters, formError,
    h("div", { class: "cta-row" }, cook, surprise),
    opts.demo_mode ? h("p", { class: "demo-banner", style: { "margin-top": "16px" } }, "🧪", h("span", null, h("strong", { text: "Demo mode: " }), "recipes are canned samples. Add a GROQ_API_KEY to .env and run the real server for AI recipes.")) : null,
    !opts.ai_available ? h("p", { class: "demo-banner", style: { "margin-top": "16px" } }, "🔌", h("span", { text: "AI isn't configured on this server yet (missing GROQ_API_KEY)." })) : null);

  return h("div", { class: "view" }, hello, form);
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
