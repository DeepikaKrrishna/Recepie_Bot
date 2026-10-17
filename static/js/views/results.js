// Results: play Chef Run while the AI cooks, then reveal the recipe cards.
import { api } from "../lib/api.js";
import { recipeCard } from "../lib/cards.js";
import { chefRun } from "../lib/chefrun.js";
import { clear, h, mount } from "../lib/dom.js";
import { emojiFor } from "../lib/food.js";
import { icon } from "../lib/icons.js";
import { bestScore, saveBest, state } from "../lib/store.js";
import { button, confetti, emptyState, toast, withTransition } from "../lib/ui.js";

const STATUSES = ["Reading your ingredients", "Raiding the spice box", "Tasting for salt", "Balancing the flavours",
  "Checking your filters", "Heating the pan", "Plating up", "Adding the final garnish"];

function describe(req) {
  const bits = [];
  if (req.remix) bits.push(`🪄 ${req.remix.base_title}: ${req.remix.instruction}`);
  (req.ingredients || []).forEach((i) => bits.push(`${emojiFor(i)} ${i}`));
  if (req.dish) bits.push(`“${req.dish}”`);
  if (req.cuisine && req.cuisine !== "Any") bits.push(req.cuisine);
  (req.diets || []).forEach((d) => bits.push(d));
  if (req.occasion) bits.push(req.occasion);
  if (req.max_total_minutes) bits.push(`≤ ${req.max_total_minutes} min`);
  if (req.spice) bits.push(`${req.spice} spice`);
  (req.exclude || []).forEach((x) => bits.push(`no ${x}`));
  return bits;
}

/** Resolve once `el` is attached (fast responses can beat the view transition); false if we left. */
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
    return h("section", { class: "view section" }, emptyState({ art: "🍳", title: "Nothing on the stove yet",
      text: "Tell me what's in your kitchen and I'll whip up some ideas.",
      actions: [h("a", { class: "btn btn--primary", href: "/", "data-link": "" }, "Start cooking")] }));
  }

  const title = h("h1", { text: r.data ? "Here's what you can cook" : "Cooking up ideas…" });
  const meta = h("p", { class: "muted", style: { margin: "6px 0 0" } });
  const body = h("div", { "aria-live": "polite" });
  const again = button("New ideas", { variant: "sun", iconName: "refresh", onClick: () => { state.results = { request: r.request }; navigate("/results", { replace: true }); } });
  const view = h("section", { class: "view" },
    h("div", { class: "results-head" },
      h("div", null, h("a", { href: "/", "data-link": "", class: "link-btn" }, "← Change ingredients"), title, meta,
        h("div", { class: "pills", style: { "margin-top": "10px" } }, describe(r.request).slice(0, 12).map((b) => h("span", { class: "pill", text: b })))),
      again),
    body);

  function show(data, { celebrate = false } = {}) {
    withTransition(() => {
      title.textContent = r.request.remix ? "Fresh remixes 🪄" : "Here's what you can cook";
      meta.textContent = `${data.recipes.length} idea${data.recipes.length === 1 ? "" : "s"} for you` + (data.dropped ? ` · ${data.dropped} skipped for not matching your filters` : "");
      mount(body, h("div", { class: "cards" }, data.recipes.map((rec, i) => recipeCard(rec, {
        href: `/recipe/${i}`, index: i,
        ribbon: i === 0 && rec.uses_yours?.length ? "⭐ Best match" : null,
      }))));
    });
    if (celebrate) confetti({ y: 0.35 });
  }

  if (r.data) { show(r.data); return view; }

  // ---- waiting: status + game
  const statusText = h("span", { text: `${STATUSES[0]}…` });
  const status = h("p", { class: "thinking__status", "aria-live": "polite" }, h("span", { class: "dots", "aria-hidden": "true" }, h("i"), h("i"), h("i")), statusText);
  let si = 1;
  const ticker = setInterval(() => {
    if (!status.isConnected) { clearInterval(ticker); return; }
    statusText.textContent = `${STATUSES[si++ % STATUSES.length]}…`;
    statusText.style.animation = "none";
    void statusText.offsetWidth; // restart the fade-in animation
    statusText.style.removeProperty("animation");
  }, 2200);
  const game = chefRun({ best: bestScore(), onGameOver: (score) => {
    if (saveBest(score)) toast(`New best: ${score}! 🏆`, { icon: "🎮" });
    if (pending) reveal();
  } });
  let pending = null;
  function reveal() {
    const data = pending; pending = null;
    clearInterval(ticker);
    game.stop();
    show(data, { celebrate: true });
  }
  mount(body,
    h("div", { class: "thinking" }, status, h("span", { class: "muted tiny", text: "Tip: tap the game or press Space to jump. 🎮" })),
    game.el);

  r.promise ||= api("/api/recipes/generate", { method: "POST", body: r.request, timeoutMs: 100000 });
  r.promise.then(async (data) => {
    r.data = data;
    if (state.results !== r || !(await mounted(body))) return;
    pending = data;
    if (game.isPlaying()) {
      // Let them finish the run: show a wiggling "ready" button on the game.
      clear(game.readySlot).append(button("Your recipes are ready! 🍽️", { variant: "primary", onClick: reveal }));
      game.readySlot.hidden = false;
      statusText.textContent = "Ready when you are!";
    } else {
      reveal();
    }
  }).catch(async (err) => {
    r.promise = null;
    clearInterval(ticker);
    if (!(await mounted(body))) return;
    game.stop();
    title.textContent = "Hmm, that didn't cook";
    mount(body, emptyState({
      art: err.status === 429 ? "⏳" : err.status === 422 ? "🤔" : "🍳💨",
      title: err.status === 429 ? "The kitchen's busy" : err.status === 422 ? "Nothing fits those filters" : "That didn't cook through",
      text: err.message, error: err.status !== 422,
      actions: [
        err.status !== 422 ? button("Try again", { variant: "primary", iconName: "refresh", onClick: () => { state.results = { request: r.request }; navigate("/results", { replace: true }); } }) : null,
        h("a", { class: "btn btn--ghost", href: "/", "data-link": "" }, icon("arrowLeft"), "Change ingredients"),
      ].filter(Boolean),
    }));
  });
  return view;
}
