// Results: runs the generation (with the cooking loader), then shows recipe cards.
import { api } from "../lib/api.js";
import { recipeCard } from "../lib/cards.js";
import { h, mount } from "../lib/dom.js";
import { emojiFor } from "../lib/food.js";
import { icon } from "../lib/icons.js";
import { loadPantry, pantryNames, state } from "../lib/store.js";
import { button, cookingLoader, emptyState, withTransition } from "../lib/ui.js";

function describe(req) {
  const bits = [];
  if (req.remix) bits.push(`Remix of ${req.remix.base_title}: ${req.remix.instruction}`);
  if (req.use_first?.length) bits.push(`🛟 Rescuing ${req.use_first.join(", ")}`);
  (req.ingredients || []).forEach((i) => bits.push(`${emojiFor(i)} ${i}`));
  if (req.dish) bits.push(`“${req.dish}”`);
  if (req.cuisine && req.cuisine !== "Any") bits.push(req.cuisine);
  (req.diets || []).forEach((d) => bits.push(d));
  if (req.occasion) bits.push(req.occasion);
  if (req.max_total_minutes) bits.push(`≤ ${req.max_total_minutes} min`);
  if (req.spice) bits.push(`${req.spice} spice`);
  if (req.budget) bits.push(`budget ${req.currency} ${req.budget}`);
  (req.exclude || []).forEach((x) => bits.push(`no ${x}`));
  return bits;
}

/** Resolve true once `el` is attached (fast responses can beat the view transition), false if we navigated away. */
function mounted(el) {
  return new Promise((resolve) => {
    const start = performance.now();
    (function check() {
      if (el.isConnected) return resolve(true);
      if (location.pathname !== "/results" || performance.now() - start > 5000) return resolve(false);
      requestAnimationFrame(check);
    })();
  });
}

export async function render({ navigate }) {
  const r = state.results;
  if (!r) {
    return h("section", { class: "view" }, emptyState({ art: "🍳", title: "No search yet",
      text: "Tell us what's in your kitchen and we'll suggest something tasty.",
      actions: [h("a", { class: "btn btn--primary", href: "/", "data-link": "" }, "Start cooking")] }));
  }
  const body = h("div", { "aria-live": "polite" });
  const title = h("h1", { text: r.request.use_first?.length ? "Rescue recipes" : r.request.remix ? "Remixed for you" : "Here's what you can cook" });
  const meta = h("p", { class: "muted", style: { margin: "6px 0 0" } });
  const view = h("section", { class: "view" },
    h("div", { class: "results-head" },
      h("div", null, h("a", { href: "/", "data-link": "", class: "link-btn" }, "← Edit search"), title, meta,
        h("div", { class: "summary-chips" }, describe(r.request).slice(0, 12).map((b) => h("span", { class: "pill", text: b })))),
      button("New ideas", { variant: "ghost", iconName: "refresh", onClick: () => { state.results = { request: r.request }; navigate("/results", { replace: true }); } })),
    body);

  const show = async (data) => {
    if (state.user) await loadPantry();
    const pantry = state.user ? pantryNames() : null;
    withTransition(() => {
      meta.textContent = `${data.recipes.length} idea${data.recipes.length === 1 ? "" : "s"}` + (data.dropped ? ` · ${data.dropped} skipped for not matching your filters` : "");
      mount(body, h("div", { class: "cards" }, data.recipes.map((rec, i) => recipeCard(rec, {
        href: `/recipe/${i}`, index: i, pantry,
        ribbon: rec.uses_expiring?.length ? `🛟 Uses ${rec.uses_expiring.length} expiring` : null,
      }))));
    });
  };

  if (r.data) {
    show(r.data);
  } else {
    mount(body, cookingLoader(r.request.use_first?.length ? "Rescuing your ingredients" : "Cooking up ideas"));
    r.promise ||= api("/api/recipes/generate", { method: "POST", body: r.request, timeoutMs: 100000 });
    r.promise.then(async (data) => {
      r.data = data;
      if (state.results === r && await mounted(body)) show(data);
    }).catch(async (err) => {
      r.promise = null;
      if (!(await mounted(body))) return;
      meta.textContent = "";
      const retry = err.status !== 422;
      mount(body, emptyState({
        art: err.status === 429 ? "⏳" : err.status === 422 ? "🤔" : "🍳💨",
        title: err.status === 429 ? "The kitchen's busy" : err.status === 422 ? "Nothing fits those filters" : "That didn't cook through",
        text: err.message, error: err.status !== 422,
        actions: [
          retry ? button("Try again", { variant: "primary", iconName: "refresh", onClick: () => { state.results = { request: r.request }; navigate("/results", { replace: true }); } }) : null,
          h("a", { class: "btn btn--ghost", href: "/", "data-link": "" }, icon("arrowLeft"), "Adjust filters"),
        ].filter(Boolean),
      }));
    });
  }
  return view;
}
