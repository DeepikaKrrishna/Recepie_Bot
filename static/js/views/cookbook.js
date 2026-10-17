// Cookbook: saved recipes and favourites.
import { api } from "../lib/api.js";
import { recipeCard } from "../lib/cards.js";
import { h, mount } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { emptyState, errorToast, toast, withTransition } from "../lib/ui.js";

export async function render() {
  let tab = "all", q = "", rows = [];
  const grid = h("div", { "aria-live": "polite" },
    h("div", { class: "cards" }, [0, 1, 2].map(() => h("div", { class: "skel", style: { height: "360px", "border-radius": "32px" } }))));
  const tabs = h("div", { class: "tabs", role: "tablist", "aria-label": "Filter recipes" },
    [["all", "📖 All"], ["fav", "❤️ Favourites"]].map(([v, l]) => h("button", { role: "tab", type: "button", "aria-selected": String(v === tab), onClick: (e) => {
      tab = v;
      tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b === e.currentTarget)));
      draw();
    } }, l)));
  const search = h("input", { class: "input", type: "search", placeholder: "🔍 Search your recipes", "aria-label": "Search your cookbook", style: { "max-width": "300px" },
    onInput: (e) => { q = e.target.value.trim().toLowerCase(); draw(); } });

  function favButton(row) {
    const b = h("button", { class: `icon-btn heart rcard__fav${row.favorite ? " is-on" : ""}`, type: "button", "aria-pressed": String(row.favorite),
      "aria-label": row.favorite ? `Remove ${row.title} from favourites` : `Add ${row.title} to favourites`, onClick: async () => {
        try {
          const upd = await api(`/api/recipes/${row.id}`, { method: "PATCH", body: { favorite: !row.favorite } });
          row.favorite = upd.favorite;
          b.classList.toggle("is-on", row.favorite);
          b.setAttribute("aria-pressed", String(row.favorite));
          if (row.favorite) toast("Added to favourites", { icon: "💖" });
          if (tab === "fav") draw();
        } catch (err) { errorToast(err); }
      } }, icon("heart"));
    return b;
  }

  function draw() {
    const list = rows.filter((r) => (tab === "all" || r.favorite) && (!q || r.title.toLowerCase().includes(q)));
    withTransition(() => {
      if (!rows.length) {
        mount(grid, emptyState({ art: "📖", title: "Your cookbook is empty", text: "Cook something you love and tap Save. It'll live here, ready for Cook Mode.",
          actions: [h("a", { class: "btn btn--primary", href: "/", "data-link": "" }, "Find something to cook")] }));
        return;
      }
      if (!list.length) { mount(grid, emptyState({ art: tab === "fav" ? "🤍" : "🔍", title: tab === "fav" ? "No favourites yet" : "No matches", text: tab === "fav" ? "Tap the heart on a recipe to keep it here." : "Try a different search." })); return; }
      mount(grid, h("div", { class: "cards" }, list.map((row, i) => recipeCard(row, { href: `/cookbook/${row.id}`, index: i, fav: favButton(row), cooked: row.cooked_count }))));
    });
  }

  api("/api/recipes").then((data) => { rows = data; draw(); })
    .catch((err) => mount(grid, emptyState({ art: "😬", title: "Couldn't load your cookbook", text: err.message, error: true })));

  return h("section", { class: "view" },
    h("div", { class: "pagehead" }, h("span", { class: "eyebrow", text: "📖 Cookbook" }), h("h1", { text: "Your keepers" }),
      h("p", { text: "Recipes you've saved. Favourites float to the top." })),
    h("div", { class: "section__head" }, tabs, search),
    grid);
}
