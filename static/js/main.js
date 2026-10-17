// Recipe Bot: app shell, router (sign-in first) and navigation.
import { $, h, mount } from "./lib/dom.js";
import { icon } from "./lib/icons.js";
import { loadOptions, refreshSession, state, subscribe } from "./lib/store.js";
import { logo, withTransition } from "./lib/ui.js";

const NAV = [
  ["/", "Cook", "sparkles"],
  ["/cookbook", "Cookbook", "book"],
  ["/account", "Me", "user"],
];

// [pattern, module, export]
const ROUTES = [
  [/^\/$/, "./views/discover.js"],
  [/^\/results$/, "./views/results.js"],
  [/^\/recipe\/(\d+)$/, "./views/recipe.js", "renderTemp"],
  [/^\/cookbook$/, "./views/cookbook.js"],
  [/^\/cookbook\/(\d+)$/, "./views/recipe.js", "renderSaved"],
  [/^\/account$/, "./views/account.js"],
];
const PUBLIC = /^\/(welcome|login|signup)$/;

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

  // Sign in first: everything except the welcome/auth screens needs an account.
  if (!state.user && !PUBLIC.test(path)) {
    const next = path === "/" ? "" : `?next=${encodeURIComponent(path)}`;
    history.replaceState({}, "", `/welcome${next}`);
    return render({ transition });
  }
  if (state.user && PUBLIC.test(path)) {
    const next = new URLSearchParams(location.search).get("next");
    history.replaceState({}, "", next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
    return render({ transition });
  }

  let node;
  try {
    if (PUBLIC.test(path)) {
      const mod = await import("./views/welcome.js");
      node = await mod.render({ mode: path === "/login" ? "login" : "signup", query: new URLSearchParams(location.search), navigate });
    } else {
      let match = null, route = null;
      for (const r of ROUTES) { match = r[0].exec(path); if (match) { route = r; break; } }
      if (!route) node = notFound();
      else {
        const mod = await import(route[1]);
        node = await mod[route[2] || "render"]({ params: match.slice(1), query: new URLSearchParams(location.search), navigate });
      }
    }
  } catch (err) {
    console.error(err);
    node = h("section", { class: "empty empty--error view" }, h("h2", { text: "This page didn't load" }), h("p", { text: "Please refresh and try again." }));
  }
  if (seq !== renderSeq) return;
  const update = () => {
    document.body.classList.toggle("signed-out", !state.user);
    mount(app, node);
    updateNav(path);
    window.scrollTo(0, 0);
  };
  if (transition) await withTransition(update); else update();
  const heading = app.querySelector("h1");
  if (heading && document.activeElement === document.body) { heading.setAttribute("tabindex", "-1"); heading.focus({ preventScroll: true }); }
}

function notFound() {
  return h("section", { class: "empty view section" },
    h("div", { class: "empty__art", "aria-hidden": "true", text: "🥄" }),
    h("h1", { style: { "font-size": "2rem" }, text: "Nothing cooking here" }),
    h("p", { text: "That page doesn't exist. Let's get you back to the kitchen." }),
    h("a", { class: "btn btn--primary", href: "/", "data-link": "" }, "Back to cooking"));
}

// ---------------------------------------------------------------- chrome
function updateNav(path) {
  const section = "/" + (path.split("/")[1] || "");
  const active = (href) => href === section || (href === "/" && ["/results", "/recipe"].includes(section));
  for (const a of document.querySelectorAll("#mainnav a, #bottomnav a")) {
    if (active(a.getAttribute("href"))) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  const signedIn = !!state.user;
  $("#mainnav").hidden = !signedIn;
  $("#bottomnav").hidden = !signedIn;
}

function buildChrome() {
  mount($("#brand"), logo(), h("span", { class: "brand__name" }, "Recipe", h("span", { text: "Bot" })));
  const link = (href, label, ic) => h("a", { href, "data-link": "" }, icon(ic), h("span", { text: label }));
  mount($("#mainnav"), NAV.map(([href, label, ic]) => link(href, label, ic)));
  mount($("#bottomnav"), NAV.map(([href, label, ic]) => link(href, label, ic)));
  renderActions();
}

function renderActions() {
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  const themeBtn = h("button", { class: "icon-btn", type: "button", "aria-label": dark ? "Switch to light mode" : "Switch to dark mode",
    onClick: () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      try { localStorage.setItem("rb-theme", next); } catch { /* private mode */ }
      withTransition(() => { document.documentElement.setAttribute("data-theme", next); renderActions(); });
    } }, icon(dark ? "sun" : "moon"));
  mount($("#topActions"), themeBtn);
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
subscribe((what) => { if (what === "session") renderActions(); });

function offlineBanner() {
  let el = null;
  const sync = () => {
    if (!navigator.onLine && !el) { el = h("div", { class: "offline", role: "status", text: "You're offline 📡" }); document.body.append(el); }
    if (navigator.onLine && el) { el.remove(); el = null; }
  };
  window.addEventListener("online", sync); window.addEventListener("offline", sync); sync();
}

// ---------------------------------------------------------------- boot
async function boot() {
  buildChrome();
  await Promise.all([refreshSession(), loadOptions().catch(() => null)]);
  render({ transition: false });
  offlineBanner();
  const secure = location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname);
  if ("serviceWorker" in navigator && secure) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
}

boot();
