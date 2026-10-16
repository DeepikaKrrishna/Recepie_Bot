// Recipe card used by results and the cookbook.
import { h } from "./dom.js";
import { plateArt, matColors, pantryCoverage } from "./food.js";
import { minutes, cap } from "./format.js";
import { icon } from "./icons.js";

/** Give the plate a shared view-transition name so it morphs into the detail hero. */
export function markHero(card) {
  document.querySelectorAll("[data-vt]").forEach((el) => { el.style.removeProperty("view-transition-name"); delete el.dataset.vt; });
  const plate = card.querySelector(".plate");
  if (plate) { plate.style.setProperty("view-transition-name", "hero-plate"); plate.dataset.vt = "1"; }
}

export function recipeCard(recipe, { href, ribbon, pantry, fav, cooked, index = 0 }) {
  const [mat] = matColors(recipe);
  let coverage = null;
  if (pantry && recipe.ingredients) {
    const c = pantryCoverage(recipe, pantry);
    coverage = h("div", { class: "match", title: c.missing.length ? `Missing: ${c.missing.map((m) => m.name).join(", ")}` : "You have everything" },
      h("span", { text: `You have ${c.have.length}/${recipe.ingredients.length}` }),
      h("span", { class: "match__bar" }, h("i", { style: { "--w": `${c.pct}%` } })));
  }
  const card = h("article", { class: "rcard rise", style: { "--i": String(index) } },
    ribbon ? h("span", { class: "rcard__ribbon", text: ribbon }) : null,
    fav,
    h("div", { class: "rcard__art mat", style: { "--mat": mat } }, recipe.ingredients ? plateArt(recipe, { size: 168, label: false }) : plateArt({ title: recipe.title, ingredients: [] }, { size: 168, label: false })),
    h("div", { class: "rcard__body" },
      h("h2", { class: "rcard__title" }, h("a", { href, "data-link": "", onClick: () => markHero(card) }, recipe.title)),
      recipe.description ? h("p", { class: "rcard__desc", text: recipe.description }) : null,
      h("ul", { class: "pills" },
        recipe.total_minutes != null ? h("li", { class: "pill" }, icon("clock"), minutes(recipe.total_minutes)) : null,
        recipe.difficulty ? h("li", { class: "pill" }, icon("flame"), cap(recipe.difficulty)) : null,
        recipe.servings ? h("li", { class: "pill" }, icon("users"), `Serves ${recipe.servings}`) : null,
        ...(recipe.diet_tags || []).slice(0, 2).map((t) => h("li", { class: "pill pill--leaf", text: t })),
        recipe.notices?.length ? h("li", { class: "pill pill--warn", text: "Check notes" }) : null,
        cooked ? h("li", { class: "pill pill--tomato", text: `Cooked ${cooked}×` }) : null),
      coverage));
  return card;
}
