// Recipe Bot: app shell, router and navigation.
import { $, clear, h, mount } from "./lib/dom.js";
import { icon } from "./lib/icons.js";
import { emit, loadOptions, loadShoppingCount, refreshSession, state, subscribe } from "./lib/store.js";
import { logo, withTransition } from "./lib/ui.js";

const NAV = [
  ["/", "Discover", "compass"],
  ["/pantry", "Pantry", "jar"],
  ["/plan", "Plan", "calendar"],
  ["/shopping", "Shopping", "cart"],
  ["/cookbook", "Cookbook", "book"],
];

// [pattern, module path, export]
const ROUTES = [
  [/^\/$/, "./views/discover.js"],
  [/^\/results$/, "./views/results.js"],
  [/^\/recipe\/(\d+)$/, "./views/recipe.js", "renderTemp"],
  [/^\/cookbook$/, "./views/cookbook.js"],
  [/^\/cookbook\/(\d+)$/, "./views/recipe.js", "renderSaved"],
  [/^\/r\/([A-Za-z0-9_-]{8,32})$/, "./views/recipe.js", "renderShared"],
  [/^\/pantry$/, "./views/pantry.js"],
  [/^\/plan$/, "./views/planner.js"],
  [/^\/shopping$/, "./views/shopping.js"],
  [/^\/account$/, "./views/account.js"],
  [/^\/login$/, "./views/auth.js", "renderLogin"],
  [/^\/signup$/, "./views/auth.js", "renderSignup"],
];

const app = $("#app");
let renderSeq = 0;

export function navigate(path, { replace = false, transition = true } = {}) {
  if (path === location.pathname + location.search && !replace) { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
  history[replace ? "replaceState" : "pushState"]({}, "", path);
  render({ transition });
}

async function render({ transition = true } = {}) {
  const seq = ++renderSeq;
  const path = location.pathname.replace(/\/+$/, "") || "/";
  let match = null, route = null;
  for (const r of ROUTES) { match = r[0].exec(path); if (match) { route = r; break; } }
  let node;
  try {
    if (!route) {
      node = notFound();
    } else {
      const mod = await import(route[1]);
      const fn = mod[route[2] || "render"];
      node = await fn({ params: match.slice(1), query: new URLSearchParams(location.search), navigate });
    }
  } catch (err) {
    console.error(err);
    node = h("section", { class: "empty empty--error view" }, h("h3", { text: "This page didn't load" }),
      h("p", { text: "Please refresh and try again." }));
  }
  if (seq !== renderSeq) return; // a newer navigation won
  const update = () => {
    mount(app, node);
    updateNav(path);
    window.scrollTo(0, 0);
  };
  if (transition) await withTransition(update); else update();
  const heading = app.querySelector("h1");
  if (heading && document.activeElement === document.body) { heading.setAttribute("tabindex", "-1"); heading.focus({ preventScroll: true }); }
}

function notFound() {
  return h("section", { class: "gate view" },
    h("div", { class: "gate__art", "aria-hidden": "true" }, h("span", { style: { "--i": "0" }, text: "🥄" })),
    h("h1", { text: "Nothing cooking here" }),
    h("p", { class: "muted", text: "That page doesn't exist. Let's get you back to the kitchen." }),
    h("a", { class: "btn btn--primary", href: "/", "data-link": "" }, "Back to Discover"));
}

// ---------------------------------------------------------------- chrome
function updateNav(path) {
  const section = "/" + (path.split("/")[1] || "");
  const active = (href) => href === section || (href === "/" && (section === "/results" || section === "/recipe"))
    || (href === "/cookbook" && section === "/cookbook");
  for (const a of document.querySelectorAll("#mainnav a, #bottomnav a")) {
    if (active(a.getAttribute("href"))) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
}

function buildChrome() {
  mount($("#brand"), logo(), h("span", { class: "brand__name" }, "Recipe", h("span", { text: "Bot" })));
  const navLink = (href, label, ic) => h("a", { href, "data-link": "" }, icon(ic), h("span", { text: label }),
    href === "/shopping" ? h("span", { class: "badge", hidden: true, dataset: { badge: "shopping" } }) : null);
  mount($("#mainnav"), NAV.map(([href, label, ic]) => navLink(href, label, ic)));
  mount($("#bottomnav"), NAV.map(([href, label, ic]) => navLink(href, label, ic)));
  renderActions();
}

function renderActions() {
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  const themeBtn = h("button", { class: "icon-btn", type: "button", "aria-label": dark ? "Switch to light mode" : "Switch to dark mode",
    onClick: () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      const apply = () => { document.documentElement.setAttribute("data-theme", next); renderActions(); };
      try { localStorage.setItem("rb-theme", next); } catch { /* private mode */ }
      withTransition(apply);
    } }, icon(dark ? "sun" : "moon"));
  const user = state.user;
  const account = user
    ? h("a", { class: "icon-btn", href: "/account", "data-link": "", "aria-label": "Your account", title: user.email },
        h("span", { class: "serif", style: { "font-weight": "700" }, text: (user.display_name || user.email)[0].toUpperCase() }))
    : h("a", { class: "btn btn--dark btn--sm", href: "/login", "data-link": "" }, "Sign in");
  mount($("#topActions"), themeBtn, account);
}

function updateBadges() {
  for (const b of document.querySelectorAll('[data-badge="shopping"]')) {
    b.textContent = String(state.shoppingCount);
    b.hidden = !state.shoppingCount;
  }
}

// ---------------------------------------------------------------- global listeners
document.addEventListener("click", (e) => {
  const a = e.target.closest("a");
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const href = a.getAttribute("href");
  if (!href || !href.startsWith("/") || href.startsWith("//") || a.target === "_blank" || a.hasAttribute("download")) return;
  if (/^\/(static|api|privacy|terms|docs)/.test(href)) return;
  e.preventDefault();
  navigate(href);
});
window.addEventListener("popstate", () => render());
subscribe((what) => {
  if (what === "session") { renderActions(); loadShoppingCount(); }
  if (what === "shopping") updateBadges();
});

function offlineBanner() {
  let el = null;
  const sync = () => {
    state.online = navigator.onLine;
    if (!navigator.onLine && !el) { el = h("div", { class: "offline", role: "status", text: "You're offline. Saved recipes still open." }); document.body.append(el); }
    if (navigator.onLine && el) { el.remove(); el = null; }
    emit("online");
  };
  window.addEventListener("online", sync); window.addEventListener("offline", sync); sync();
}

// ---------------------------------------------------------------- boot
async function boot() {
  buildChrome();
  clear(app);
  await Promise.all([refreshSession(), loadOptions().catch(() => null)]);
  render({ transition: false });
  offlineBanner();
  const secure = location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname);
  if ("serviceWorker" in navigator && secure) {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }
}

boot();
