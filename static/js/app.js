/* Recipe Bot frontend: vanilla JS, no build step.
 *
 * Security: all server/AI text is rendered with textContent through `h()`.
 * HTML strings are never parsed from dynamic data, so model output cannot inject markup or scripts.
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------- helpers
  const $ = (sel, root = document) => root.querySelector(sel);

  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (value === null || value === undefined || value === false) continue;
        if (key === "class") el.className = value;
        else if (key === "text") el.textContent = value;
        else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
        else if (key === "dataset") Object.assign(el.dataset, value);
        else el.setAttribute(key, value === true ? "" : String(value));
      }
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  const store = {
    get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* ignore */ } },
  };

  class ApiError extends Error {
    constructor(message, status, retryAfter) { super(message); this.status = status; this.retryAfter = retryAfter; }
  }

  async function api(path, { method = "GET", body, timeoutMs = 30000 } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
        credentials: "same-origin",
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === "AbortError") throw new ApiError("This is taking longer than expected. Please try again.", 0);
      throw new ApiError("Can't reach Recipe Bot. Check your connection and try again.", 0);
    }
    clearTimeout(timer);
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON */ }
    if (!res.ok) {
      let message = (data && typeof data.detail === "string") ? data.detail : "Something went wrong. Please try again.";
      if (res.status === 422 && data && Array.isArray(data.errors) && data.errors.length) {
        message += " " + data.errors.map((e) => `${e.field}: ${e.message}`).join("; ");
      }
      throw new ApiError(message, res.status, Number(res.headers.get("Retry-After")) || null);
    }
    return data;
  }

  // quantity formatting with friendly fractions
  const FRACTIONS = [[0, ""], [0.125, "⅛"], [0.25, "¼"], [1 / 3, "⅓"], [0.5, "½"], [2 / 3, "⅔"], [0.75, "¾"], [1, ""]];
  function formatQty(q) {
    if (q === null || q === undefined || Number.isNaN(q)) return "";
    if (q >= 20) return String(Math.round(q));
    if (q >= 10) return String(Math.round(q * 2) / 2);
    const whole = Math.floor(q);
    const frac = q - whole;
    let best = null;
    for (const [value, glyph] of FRACTIONS) {
      if (Math.abs(frac - value) < 0.04) { best = [value, glyph]; break; }
    }
    if (best) {
      const w = whole + (best[0] === 1 ? 1 : 0);
      if (!best[1]) return String(w || (q > 0 ? "<⅛" : "0"));
      return (w ? w + " " : "") + best[1];
    }
    return String(Math.round(q * 10) / 10);
  }

  function minutesLabel(m) {
    if (m < 60) return `${m} min`;
    const hrs = Math.floor(m / 60), rem = m % 60;
    return rem ? `${hrs} h ${rem} min` : `${hrs} h`;
  }

  function artClass(text) {
    let hash = 0;
    for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return "art-" + (hash % 6);
  }

  function initials(title) {
    return title.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  }

  // ---------------------------------------------------------------- state
  const state = {
    ingredients: [],
    exclude: [],
    options: null,
    recipes: [],
    lastRequest: null,
    scrollY: 0,
  };

  const COMMON_INGREDIENTS = [
    "rice", "onion", "tomato", "potato", "garlic", "ginger", "green chilli", "curry leaves", "mustard seeds",
    "cumin", "turmeric", "coriander leaves", "paneer", "curd", "milk", "eggs", "chicken", "toor dal", "moong dal",
    "chana", "rajma", "spinach", "carrot", "beans", "cauliflower", "cabbage", "capsicum", "peas", "brinjal",
    "okra", "coconut", "lemon", "bread", "pasta", "noodles", "cheese", "butter", "ghee", "atta", "rava",
    "poha", "oats", "mushroom", "tofu", "fish", "prawns", "tamarind", "jaggery", "besan",
  ];

  // ---------------------------------------------------------------- chip inputs
  function setupChipInput(box, input, listEl, key, max) {
    function render() {
      clear(listEl);
      state[key].forEach((item, index) => {
        listEl.append(
          h("li", { class: "chip" },
            h("span", { text: item }),
            h("button", {
              type: "button", class: "chip__remove", "aria-label": `Remove ${item}`,
              onclick: () => { state[key].splice(index, 1); render(); input.focus(); updateFilterCount(); },
            }, "×"))
        );
      });
    }
    function add(raw) {
      const parts = String(raw).split(/,|\band\b/i).map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean);
      for (const part of parts) {
        const value = part.slice(0, 60);
        if (state[key].length >= max) { showFormError(`You can add up to ${max} items.`); break; }
        if (!state[key].some((x) => x.toLowerCase() === value.toLowerCase())) state[key].push(value);
      }
      render();
      updateFilterCount();
    }
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") {
        if (input.value.trim()) { e.preventDefault(); add(input.value); input.value = ""; }
        else if (e.key === ",") e.preventDefault();
      } else if (e.key === "Backspace" && !input.value && state[key].length) {
        state[key].pop(); render(); updateFilterCount();
      }
    });
    input.addEventListener("change", () => { // datalist pick on some browsers
      if (input.value.trim() && COMMON_INGREDIENTS.includes(input.value.trim().toLowerCase())) { add(input.value); input.value = ""; }
    });
    input.addEventListener("blur", () => { if (input.value.trim()) { add(input.value); input.value = ""; } });
    box.addEventListener("click", (e) => { if (e.target === box || e.target === listEl) input.focus(); });
    return { add, render };
  }

  // ---------------------------------------------------------------- form
  const form = $("#searchForm");
  const formError = $("#formError");
  const generateBtn = $("#generateBtn");
  const servingsInput = $("#servingsInput");
  let ingredientCtl, excludeCtl;

  function showFormError(message) {
    formError.textContent = message;
    formError.hidden = !message;
  }

  function selectedDiets() {
    return [...document.querySelectorAll("#dietChips input:checked")].map((i) => i.value);
  }

  function updateFilterCount() {
    let n = 0;
    if ($("#cuisineSelect").value !== "Any") n++;
    if ($("#timeSelect").value) n++;
    if (form.querySelector("input[name=difficulty]:checked").value) n++;
    if ($("#budgetInput").value) n++;
    n += selectedDiets().length + state.exclude.length;
    const badge = $("#filterCount");
    badge.textContent = String(n);
    badge.hidden = n === 0;
  }

  function readRequest() {
    const servings = Math.min(20, Math.max(1, parseInt(servingsInput.value, 10) || 2));
    servingsInput.value = servings;
    const budgetVal = parseFloat($("#budgetInput").value);
    const time = $("#timeSelect").value;
    const difficulty = form.querySelector("input[name=difficulty]:checked").value;
    const dish = $("#dishInput").value.trim();
    return {
      ingredients: [...state.ingredients],
      exclude: [...state.exclude],
      dish: dish || null,
      cuisine: $("#cuisineSelect").value,
      diets: selectedDiets(),
      max_total_minutes: time ? Number(time) : null,
      difficulty: difficulty || null,
      servings,
      budget: Number.isFinite(budgetVal) && budgetVal > 0 ? budgetVal : null,
      currency: $("#currencySelect").value,
      count: 3,
    };
  }

  // ---------------------------------------------------------------- results
  const resultsSection = $("#results");
  const resultsBody = $("#resultsBody");
  const resultsMeta = $("#resultsMeta");
  const quickMatches = $("#quickMatches");

  function showSkeletons(n) {
    clear(resultsBody);
    resultsSection.hidden = false;
    resultsSection.setAttribute("aria-busy", "true");
    resultsMeta.textContent = "Finding recipes… this can take up to 30 seconds.";
    for (let i = 0; i < n; i++) {
      resultsBody.append(h("div", { class: "skeleton", "aria-hidden": "true" },
        h("div", { class: "sk sk--art" }), h("div", { class: "sk sk--line" }),
        h("div", { class: "sk sk--line" }), h("div", { class: "sk sk--line sk--short" })));
    }
  }

  function showState(kind, title, message, action) {
    clear(resultsBody);
    resultsSection.setAttribute("aria-busy", "false");
    resultsBody.append(h("div", { class: `state state--${kind}`, role: kind === "error" ? "alert" : null },
      h("h3", { text: title }), h("p", { text: message }),
      action ? h("button", { type: "button", class: "btn btn--ghost", onclick: action.fn }, action.label) : null));
  }

  function recipeCard(recipe, index) {
    return h("article", { class: "card" },
      h("div", { class: `card__art ${artClass(recipe.title)}`, "aria-hidden": "true" }, initials(recipe.title)),
      h("div", { class: "card__body" },
        h("h3", { class: "card__title", text: recipe.title }),
        recipe.description ? h("p", { class: "card__desc", text: recipe.description }) : null,
        h("ul", { class: "meta" },
          h("li", { text: `${minutesLabel(recipe.total_minutes)}` }),
          h("li", { text: cap(recipe.difficulty) }),
          h("li", { text: `Serves ${recipe.servings}` }),
          recipe.cuisine ? h("li", { text: recipe.cuisine }) : null),
        recipe.diet_tags.length || recipe.notices.length
          ? h("ul", { class: "tags" },
              recipe.diet_tags.slice(0, 4).map((t) => h("li", { class: "tag", text: t })),
              recipe.notices.length ? h("li", { class: "tag tag--warn", text: "Check notes" }) : null)
          : null,
        h("div", { class: "card__foot" },
          h("button", { type: "button", class: "btn btn--primary", onclick: () => openDetail(index) }, "View recipe"))));
  }

  function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : ""; }

  function renderRecipes(data) {
    state.recipes = data.recipes;
    clear(resultsBody);
    resultsSection.setAttribute("aria-busy", "false");
    resultsMeta.textContent = `${data.recipes.length} suggestion${data.recipes.length === 1 ? "" : "s"}` +
      (data.dropped ? ` · ${data.dropped} skipped for not matching your filters` : "");
    data.recipes.forEach((r, i) => resultsBody.append(recipeCard(r, i)));
    $("#resultsTitle").focus();
  }

  async function generate(request) {
    showFormError("");
    if (!request.ingredients.length && !request.dish && !request.remix) {
      showFormError("Add at least one ingredient or a dish idea.");
      $("#ingredientInput").focus();
      return;
    }
    state.lastRequest = request;
    showDetail(false);
    generateBtn.disabled = true;
    generateBtn.textContent = "Finding recipes…";
    showSkeletons(request.count || 3);
    resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      const data = await api("/api/recipes/generate", { method: "POST", body: request, timeoutMs: 100000 });
      renderRecipes(data);
    } catch (err) {
      resultsMeta.textContent = "";
      const retry = err.status === 422 ? null : { label: "Try again", fn: () => generate(request) };
      const title = err.status === 429 ? "Slow down a little" : err.status === 422 ? "No matching recipes" : "Couldn't get recipes";
      showState("error", title, err.message, retry);
    } finally {
      generateBtn.disabled = false;
      generateBtn.textContent = "Find recipes";
    }
  }

  async function quick() {
    const terms = [...state.ingredients];
    const pending = $("#ingredientInput").value.trim();
    if (pending) terms.push(pending);
    if (!terms.length) { showFormError("Add at least one ingredient to see quick matches."); return; }
    showFormError("");
    resultsSection.hidden = false;
    clear(quickMatches);
    quickMatches.hidden = false;
    quickMatches.append(h("p", { class: "muted", text: "Looking up quick matches…" }));
    try {
      const params = new URLSearchParams({ ingredients: terms.join(", ") });
      selectedDiets().forEach((d) => params.append("diets", d));
      state.exclude.forEach((x) => params.append("exclude", x));
      const data = await api(`/api/suggest?${params}`);
      clear(quickMatches);
      quickMatches.append(h("h3", { text: data.fallback ? "No close matches. Here are some popular dishes that fit your filters:" : "Quick matches from our recipe list" }));
      if (!data.matches.length) {
        quickMatches.append(h("p", { class: "muted", text: "None of our saved recipes fit your filters. Try Find recipes for AI suggestions." }));
        return;
      }
      quickMatches.append(h("ul", { class: "quick__list" }, data.matches.map((m) =>
        h("li", null, h("button", {
          type: "button", class: "quick__item", title: m.ingredients,
          onclick: () => { $("#dishInput").value = m.title; generate(readRequest()); },
        }, m.title)))));
      quickMatches.append(h("p", { class: "field__help", text: "Pick one to get a full recipe adapted to your filters." }));
    } catch (err) {
      clear(quickMatches);
      quickMatches.append(h("p", { class: "form-error", role: "alert", text: err.message }));
    }
  }

  // ---------------------------------------------------------------- detail
  const searchView = $("#searchView");
  const detailView = $("#detailView");

  function showDetail(on) {
    detailView.hidden = !on;
    searchView.hidden = on;
    $("#askSection").hidden = on;
  }

  function openDetail(index) {
    state.scrollY = window.scrollY;
    history.pushState({ recipe: index }, "", `#recipe-${index + 1}`);
    renderDetail(index);
  }

  function closeDetail(fromPop) {
    showDetail(false);
    if (!fromPop && location.hash.startsWith("#recipe-")) history.back();
    window.scrollTo(0, state.scrollY);
    $("#resultsTitle").focus({ preventScroll: true });
  }

  window.addEventListener("popstate", () => {
    const m = /^#recipe-(\d+)$/.exec(location.hash);
    if (m && state.recipes[m[1] - 1]) renderDetail(m[1] - 1);
    else if (!detailView.hidden) closeDetail(true);
  });

  function renderDetail(index) {
    const recipe = state.recipes[index];
    if (!recipe) return;
    clear(detailView);
    let servings = recipe.servings;

    const ingList = h("ul", { class: "ing-list" });
    const servingsOut = h("output", { class: "input input--num", "aria-live": "polite" }, String(servings));

    function renderIngredients() {
      const factor = servings / recipe.servings;
      clear(ingList);
      recipe.ingredients.forEach((ing, i) => {
        const id = `ing-${index}-${i}`;
        const qty = ing.quantity != null ? formatQty(ing.quantity * factor) : "";
        const subsBox = h("div", { class: "subs", hidden: true, "aria-live": "polite" });
        ingList.append(h("li", { class: "ing" },
          h("input", { type: "checkbox", id }),
          h("div", { class: "ing__text" },
            h("label", { for: id },
              qty ? h("span", { class: "ing__qty" }, qty + (ing.unit ? " " + ing.unit : "") + " ") : null,
              ing.name,
              ing.optional ? h("span", { class: "muted" }, " (optional)") : null),
            ing.note ? h("div", { class: "ing__note", text: ing.note }) : null,
            h("button", { type: "button", class: "link-btn", onclick: () => loadSubs(recipe, ing.name, subsBox) }, "Substitutes"),
            subsBox)));
      });
    }

    function step(delta) {
      servings = Math.min(50, Math.max(1, servings + delta));
      servingsOut.textContent = String(servings);
      renderIngredients();
    }

    const allergenBox = h("section", { class: "callout callout--warn", "aria-labelledby": "allergenTitle" },
      h("h3", { id: "allergenTitle", text: "Allergens: please check yourself" }),
      recipe.possible_allergens.length
        ? h("p", null, "May contain: ", h("strong", { text: recipe.possible_allergens.join(", ") }), ".")
        : h("p", { text: "No common allergens were detected automatically." }),
      h("p", { text: "This list comes from the ingredient names and the AI, and it may be incomplete. Never rely on it for allergies. Always read product labels." }));

    const notices = recipe.notices.length
      ? h("section", { class: "callout callout--warn" }, h("h3", { text: "Notes about your filters" }),
          h("ul", null, recipe.notices.map((n) => h("li", { text: n }))))
      : null;

    const estimates = (recipe.estimated_cost || recipe.nutrition_per_serving)
      ? h("section", { class: "callout callout--info" },
          h("h3", { text: "Estimates (unverified)" }),
          h("table", { class: "est-table" }, h("tbody", null,
            recipe.estimated_cost ? h("tr", null, h("th", { scope: "row", text: "Cost for whole recipe" }),
              h("td", { text: `≈ ${recipe.estimated_cost.currency} ${Math.round(recipe.estimated_cost.amount)}` })) : null,
            ...nutritionRows(recipe.nutrition_per_serving))),
          h("p", { class: "field__help", text: "AI estimates, not checked against a nutrition database or local prices. Use them as a rough guide only." }))
      : null;

    const remixInput = h("input", { class: "input", type: "text", maxlength: "200", id: "remixInput", placeholder: "e.g. make it spicier, no oven, use millet instead of rice" });
    const remixForm = h("form", { class: "remix", onsubmit: (e) => {
      e.preventDefault();
      const instruction = remixInput.value.trim();
      if (!instruction) { remixInput.focus(); return; }
      const base = state.lastRequest || readRequest();
      generate({ ...base, count: 2, remix: { base_title: recipe.title, instruction } });
    } }, h("label", { for: "remixInput", class: "sr-only" }, "How should we change this recipe?"), remixInput,
      h("button", { type: "submit", class: "btn btn--ghost" }, "Remix"));

    renderIngredients();

    detailView.append(
      h("button", { type: "button", class: "btn btn--ghost btn--sm detail__back", onclick: () => closeDetail(false) }, "← Back to results"),
      h("header", { class: "detail__header" },
        h("h1", { id: "detailTitle", tabindex: "-1", text: recipe.title }),
        recipe.description ? h("p", { class: "hero__lede", text: recipe.description }) : null,
        h("ul", { class: "meta" },
          h("li", { text: `Prep ${minutesLabel(recipe.prep_minutes)}` }),
          h("li", { text: `Cook ${minutesLabel(recipe.cook_minutes)}` }),
          h("li", { text: cap(recipe.difficulty) }),
          recipe.cuisine ? h("li", { text: recipe.cuisine }) : null),
        recipe.diet_tags.length ? h("ul", { class: "tags" }, recipe.diet_tags.map((t) => h("li", { class: "tag", text: t }))) : null),
      h("div", { class: "detail__grid" },
        h("section", { class: "panel", "aria-labelledby": "ingTitle" },
          h("h2", { id: "ingTitle", text: "Ingredients" }),
          h("div", { class: "stepper field" },
            h("span", { class: "field__label", id: "servLbl" }, "Servings"),
            h("button", { type: "button", class: "icon-btn", "aria-label": "Fewer servings", onclick: () => step(-1) }, "−"),
            servingsOut,
            h("button", { type: "button", class: "icon-btn", "aria-label": "More servings", onclick: () => step(1) }, "+")),
          ingList),
        h("div", { class: "detail__stack" },
          notices,
          allergenBox,
          h("section", { class: "panel", "aria-labelledby": "stepsTitle" },
            h("h2", { id: "stepsTitle", text: "Method" }),
            h("ol", { class: "steps" }, recipe.steps.map((s) => h("li", { text: s })))),
          recipe.tips.length ? h("section", { class: "callout callout--info" }, h("h3", { text: "Tips" }),
            h("ul", null, recipe.tips.map((t) => h("li", { text: t })))) : null,
          estimates,
          h("section", { class: "panel", "aria-labelledby": "remixTitle" },
            h("h2", { id: "remixTitle", text: "Remix this recipe" }),
            h("p", { class: "muted", text: "Tell us what to change and we'll suggest variations." }),
            remixForm))),
      h("p", { class: "field__help", text: state.disclaimer || "" }));

    showDetail(true);
    window.scrollTo(0, 0);
    $("#detailTitle").focus({ preventScroll: true });
  }

  function nutritionRows(n) {
    if (!n) return [];
    const rows = [["Calories", n.calories, "kcal"], ["Protein", n.protein_g, "g"], ["Carbs", n.carbs_g, "g"], ["Fat", n.fat_g, "g"]];
    return rows.filter(([, v]) => v != null).map(([label, v, unit]) =>
      h("tr", null, h("th", { scope: "row", text: `${label} per serving` }), h("td", { text: `≈ ${Math.round(v)} ${unit}` })));
  }

  async function loadSubs(recipe, ingredient, box) {
    box.hidden = false;
    clear(box);
    box.append(h("span", { class: "muted", text: "Finding substitutes…" }));
    try {
      const data = await api("/api/recipes/substitute", {
        method: "POST", timeoutMs: 60000,
        body: { recipe_title: recipe.title, ingredient, diets: (state.lastRequest && state.lastRequest.diets) || [] },
      });
      clear(box);
      box.append(h("strong", { text: `Instead of ${ingredient}:` }),
        h("ul", null, data.substitutes.map((s) => h("li", null,
          h("strong", { text: s.name }), s.ratio ? ` (${s.ratio})` : "", s.notes ? `: ${s.notes}` : ""))));
    } catch (err) {
      clear(box);
      box.append(h("span", { class: "form-error", role: "alert", text: err.message }));
    }
  }

  // ---------------------------------------------------------------- ask
  function renderPlainAnswer(container, text) {
    // Minimal, safe formatting: paragraphs and "-" / "1." lists; markdown markers stripped.
    const clean = (s) => s.replace(/\*\*|__|`/g, "").replace(/^#+\s*/, "");
    let list = null;
    for (const raw of text.split(/\n/)) {
      const line = raw.trim();
      if (!line) { list = null; continue; }
      const bullet = /^([-*•]|\d+[.)])\s+(.*)$/.exec(line);
      if (bullet) {
        if (!list) { list = h(/^\d/.test(bullet[1]) ? "ol" : "ul"); container.append(list); }
        list.append(h("li", { text: clean(bullet[2]) }));
      } else {
        list = null;
        container.append(h("p", { text: clean(line) }));
      }
    }
  }

  async function ask(e) {
    e.preventDefault();
    const input = $("#askInput");
    const out = $("#askAnswer");
    const question = input.value.trim();
    if (question.length < 2) { input.focus(); return; }
    out.hidden = false;
    clear(out);
    out.append(h("div", { class: "sk sk--line" }), h("div", { class: "sk sk--line sk--short" }));
    try {
      const data = await api("/api/ask", { method: "POST", body: { question }, timeoutMs: 60000 });
      clear(out);
      renderPlainAnswer(out, data.answer);
    } catch (err) {
      clear(out);
      out.append(h("p", { class: "form-error", role: "alert", text: err.message }));
    }
  }

  // ---------------------------------------------------------------- voice (progressive enhancement)
  function setupVoice() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const btn = $("#voiceBtn");
    if (!Recognition) return;
    btn.hidden = false;
    let rec = null;
    btn.addEventListener("click", () => {
      if (rec) { rec.stop(); return; }
      rec = new Recognition();
      rec.lang = document.documentElement.lang || "en-IN";
      rec.interimResults = false;
      btn.setAttribute("aria-pressed", "true");
      rec.onresult = (ev) => ingredientCtl.add(ev.results[0][0].transcript);
      rec.onerror = (ev) => showFormError(ev.error === "not-allowed" ? "Microphone access was blocked." : "Voice input didn't work. Please type instead.");
      rec.onend = () => { rec = null; btn.setAttribute("aria-pressed", "false"); };
      rec.start();
    });
  }

  // ---------------------------------------------------------------- theme
  function setupTheme() {
    const btn = $("#themeToggle");
    const sync = () => {
      const dark = document.documentElement.getAttribute("data-theme") === "dark";
      btn.textContent = dark ? "Light mode" : "Dark mode";
      btn.setAttribute("aria-pressed", String(dark));
    };
    btn.addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      store.set("rb-theme", next);
      sync();
    });
    sync();
  }

  // ---------------------------------------------------------------- init
  async function loadOptions() {
    try {
      const opts = await api("/api/options");
      state.options = opts;
      state.disclaimer = opts.disclaimer;
      const cuisine = $("#cuisineSelect");
      clear(cuisine);
      opts.cuisines.forEach((c) => cuisine.append(h("option", { value: c, text: c })));
      const diets = $("#dietChips");
      clear(diets);
      opts.diets.forEach((d) => diets.append(h("label", null, h("input", { type: "checkbox", value: d }), h("span", { text: d }))));
      $("#currencySelect").value = opts.default_currency;
      if (!opts.ai_available) {
        $("#aiUnavailable").hidden = false;
        generateBtn.disabled = true;
        $("#askInput").disabled = true;
      }
    } catch (err) {
      showFormError("Couldn't load filter options. Some features may not work. " + err.message);
    }
  }

  function init() {
    setupTheme();
    const dl = $("#ingredientSuggestions");
    COMMON_INGREDIENTS.forEach((i) => dl.append(h("option", { value: i })));
    ingredientCtl = setupChipInput($("#ingredientBox"), $("#ingredientInput"), $("#ingredientChips"), "ingredients", 30);
    excludeCtl = setupChipInput($("#excludeBox"), $("#excludeInput"), $("#excludeChips"), "exclude", 20);
    void excludeCtl;

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const pending = $("#ingredientInput").value.trim();
      if (pending) { ingredientCtl.add(pending); $("#ingredientInput").value = ""; }
      generate(readRequest());
    });
    form.addEventListener("change", updateFilterCount);
    $("#quickBtn").addEventListener("click", quick);
    document.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => {
      servingsInput.value = Math.min(20, Math.max(1, (parseInt(servingsInput.value, 10) || 2) + Number(b.dataset.step)));
    }));
    $("#askForm").addEventListener("submit", ask);
    setupVoice();
    loadOptions();
    if (location.hash.startsWith("#recipe-")) history.replaceState(null, "", location.pathname);
  }

  // exported for tests in the browser console
  window.RecipeBot = { formatQty };
  init();
})();
