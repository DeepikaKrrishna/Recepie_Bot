// Service worker: makes Recipe Bot installable and keeps the app shell and
// recently opened saved recipes available offline (handy with patchy kitchen Wi-Fi).
// Private API responses are cached only for saved recipes and cleared on sign-out.
const VERSION = "rb-v3";
const SHELL = `${VERSION}-shell`;
const API = `${VERSION}-api`;
const ASSETS = [
  "/", "/static/css/app.css", "/static/css/views.css", "/static/js/main.js", "/static/js/theme.js",
  "/static/js/lib/dom.js", "/static/js/lib/icons.js", "/static/js/lib/api.js", "/static/js/lib/store.js",
  "/static/js/lib/ui.js", "/static/js/lib/food.js", "/static/js/lib/format.js", "/static/js/lib/timers.js", "/static/js/lib/cards.js",
  "/static/js/views/discover.js", "/static/js/views/results.js", "/static/js/views/recipe.js", "/static/js/views/cookmode.js",
  "/static/js/views/cookbook.js", "/static/js/views/pantry.js", "/static/js/views/planner.js", "/static/js/views/shopping.js",
  "/static/js/views/account.js", "/static/js/views/auth.js",
  "/static/fonts/fraunces-latin-wght.woff2", "/static/fonts/outfit-latin-wght.woff2", "/static/img/favicon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "clear-api-cache") event.waitUntil(caches.delete(API));
});

const isSavedRecipe = (url) => /^\/api\/recipes(\/\d+)?$/.test(url.pathname);
const isAppRoute = (req, url) => req.mode === "navigate" && !url.pathname.startsWith("/api") && !url.pathname.startsWith("/static");

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  if (isSavedRecipe(url)) {
    // Network first; fall back to the last copy when offline.
    event.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(API).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || Response.json({ detail: "You're offline." }, { status: 503 }))));
    return;
  }
  if (url.pathname.startsWith("/api")) return; // everything else private/dynamic: network only

  if (isAppRoute(req, url)) {
    event.respondWith(fetch(req).catch(() => caches.match("/")));
    return;
  }
  if (url.pathname.startsWith("/static/")) {
    // Stale-while-revalidate for static assets.
    event.respondWith(caches.open(SHELL).then(async (cache) => {
      const hit = await cache.match(req);
      const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});
