// Recipe card used by results and the cookbook.
import { h } from "./dom.js";
import { cap, minutes } from "./format.js";
import { matColors, plateArt } from "./food.js";
import { icon } from "./icons.js";

/** Give the plate a shared view-transition name so it morphs into the recipe page hero. */
export function markHero(card) {
  document.querySelectorAll("[data-vt]").forEach((el) => { el.style.removeProperty("view-transition-name"); delete el.dataset.vt; });
  const plate = card.querySelector(".plate");
  if (plate) { plate.style.setProperty("view-transition-name", "hero-plate"); plate.dataset.vt = "1"; }
}

export function recipeCard(recipe, { href, ribbon, fav, cooked, index = 0, extra }) {
  const [mat] = matColors(recipe);
  const total = recipe.ingredients?.length || 0;
  const yours = recipe.uses_yours?.length || 0;
  const coverage = recipe.uses_yours ? h("div", { class: "coverage" },
    h("span", { text: yours ? `Uses ${yours} of yours` : "New ingredients" }),
    h("span", { class: "coverage__bar", "aria-hidden": "true" }, h("i", { style: { "--w": `${total ? Math.round(((total - (recipe.also_needs?.length || 0)) / total) * 100) : 0}%` } })),
    recipe.also_needs?.length ? h("span", { class: "muted", text: `+${recipe.also_needs.length} to buy` }) : h("span", { text: "✅ all set" })) : null;
  const card = h("article", { class: "rcard rise", style: { "--i": String(index) } },
    ribbon ? h("span", { class: "rcard__ribbon", text: ribbon }) : null,
    fav,
    h("div", { class: "rcard__art", style: { "--mat": mat } }, plateArt(recipe, { size: 170, label: false })),
    h("div", { class: "rcard__body" },
      h("h2", { class: "rcard__title" }, h("a", { href, "data-link": "", onClick: () => markHero(card) }, recipe.title)),
      recipe.description ? h("p", { class: "rcard__desc", text: recipe.description }) : null,
      h("ul", { class: "pills" },
        recipe.total_minutes != null ? h("li", { class: "pill pill--sun" }, icon("clock"), minutes(recipe.total_minutes)) : null,
        recipe.difficulty ? h("li", { class: "pill pill--berry" }, icon("flame"), cap(recipe.difficulty)) : null,
        ...(recipe.diet_tags || []).slice(0, 2).map((t) => h("li", { class: "pill pill--mint", text: t })),
        cooked ? h("li", { class: "pill pill--grape", text: `Cooked ${cooked}×` }) : null),
      coverage, extra));
  return card;
}
