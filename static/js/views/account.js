// Account: stats, preferences, history, export, password, sign out, delete.
import { api } from "../lib/api.js";
import { countUp, h, mount } from "../lib/dom.js";
import { loadOptions, refreshSession, setSession, state } from "../lib/store.js";
import { busy, button, chipInput, errorToast, modal, toast } from "../lib/ui.js";
import { startGeneration } from "./discover.js";

export async function render({ navigate }) {
  if (!state.user) { navigate("/login?next=/account", { replace: true }); return h("div"); }
  await refreshSession();
  const opts = await loadOptions();
  const u = state.user;
  const p = state.prefs;

  // ---- profile + stats
  const stats = [["saved", "recipes saved", "📖"], ["cooked", "meals cooked", "🍲"], ["rescued", "items rescued", "🛟"]];
  const statEls = stats.map(([k, label, e]) => {
    const b = h("b");
    countUp(b, u.stats[k]);
    return h("div", { class: `bigstat${k === "rescued" ? " bigstat--leaf" : ""}` }, b, h("span", { text: `${e} ${label}` }));
  });
  const profile = h("section", { class: "panel" },
    h("div", { class: "profile" },
      h("div", { class: "avatar", "aria-hidden": "true", text: (u.display_name || u.email)[0].toUpperCase() }),
      h("div", null, h("h1", { style: { "font-size": "2rem", margin: "0" }, text: u.display_name ? `Hi, ${u.display_name}` : "Your kitchen" }),
        h("p", { class: "muted", style: { margin: "0" }, text: `${u.email} · cooking since ${new Date(u.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" })}` }))),
    h("div", { class: "statgrid" }, statEls));

  // ---- preferences
  const prefs = { diets: [...p.diets], exclude: [...p.exclude] };
  const name = h("input", { class: "input", id: "pf-name", maxlength: "60", value: u.display_name || "" });
  const cuisine = h("select", { class: "input", id: "pf-cuisine" }, opts.cuisines.map((c) => h("option", { value: c, selected: c === p.cuisine, text: c })));
  const servings = h("input", { class: "input", id: "pf-serv", type: "number", min: "1", max: "20", value: p.servings });
  const currency = h("select", { class: "input", id: "pf-cur" }, ["INR", "USD", "EUR", "GBP", "AUD", "CAD", "SGD", "AED"].map((c) => h("option", { value: c, selected: c === p.currency, text: c })));
  const retention = h("select", { class: "input", id: "pf-ret" }, [[0, "Don't keep history"], [7, "7 days"], [30, "30 days"], [90, "90 days"], [365, "1 year"]]
    .map(([v, l]) => h("option", { value: String(v), selected: v === p.history_retention_days, text: l })));
  const diets = h("div", { class: "toggles" }, opts.diets.map((d) => h("label", { class: "toggle toggle--leaf" },
    h("input", { type: "checkbox", value: d, checked: prefs.diets.includes(d), onChange: (e) => {
      if (e.target.checked) prefs.diets.push(d); else prefs.diets.splice(prefs.diets.indexOf(d), 1);
    } }), h("span", { text: d }))));
  const exclude = chipInput({ id: "pf-ex", items: prefs.exclude, max: 20, variant: "chip--exclude", label: "Always exclude", placeholder: "e.g. peanuts" });
  const saveBtn = button("Save preferences", { variant: "primary", type: "submit" });
  const prefsForm = h("form", { class: "panel", onSubmit: async (e) => {
    e.preventDefault();
    try {
      busy(saveBtn, true);
      await api("/api/account/preferences", { method: "PUT", body: {
        display_name: name.value.trim(), diets: prefs.diets, cuisine: cuisine.value, servings: Number(servings.value) || 2,
        currency: currency.value, exclude: prefs.exclude, history_retention_days: Number(retention.value) } });
      await refreshSession();
      Object.assign(state.draft, { diets: null, cuisine: null, servings: null, exclude: [], _prefsApplied: false });
      toast("Preferences saved. New searches will use them.", { icon: "✅" });
      loadHistory();
    } catch (err) { errorToast(err); } finally { busy(saveBtn, false); }
  } },
    h("h2", { text: "Kitchen preferences" }),
    h("p", { class: "muted", text: "Used as defaults on Discover. You can always change them per search." }),
    h("div", { class: "grid-2" },
      h("div", { class: "field" }, h("label", { class: "label", for: "pf-name", text: "Display name" }), name),
      h("div", { class: "field" }, h("label", { class: "label", for: "pf-cuisine", text: "Favourite cuisine" }), cuisine),
      h("div", { class: "field" }, h("label", { class: "label", for: "pf-serv", text: "Usual servings" }), servings),
      h("div", { class: "field" }, h("label", { class: "label", for: "pf-cur", text: "Currency" }), currency),
      h("fieldset", { class: "field span-2" }, h("legend", { class: "label", text: "Diet" }), diets),
      h("div", { class: "field span-2" }, h("label", { class: "label", for: "pf-ex", text: "Always exclude" }), exclude.el),
      h("div", { class: "field" }, h("label", { class: "label", for: "pf-ret", text: "Keep search history for" }), retention,
        h("p", { class: "help", text: "Older searches are deleted automatically." }))),
    saveBtn);

  // ---- history
  const historyList = h("div");
  async function loadHistory() {
    try {
      const rows = await api("/api/account/history");
      mount(historyList, rows.length ? h("ul", { class: "history" }, rows.slice(0, 15).map((r) => h("li", null,
        h("div", null, h("strong", { text: (r.request.ingredients || r.request.use_first || []).slice(0, 5).join(", ") || r.request.dish || r.request.remix?.base_title || "Search" }),
          h("div", { class: "muted tiny", text: `${new Date(r.created_at).toLocaleDateString()} · ${r.titles.join(" · ")}` })),
        button("Again", { variant: "ghost", size: "sm", iconName: "refresh", onClick: () => startGeneration(navigate, { count: 3, servings: 2, ...r.request }) }))))
        : h("p", { class: "muted", text: Number(retention.value) ? "No searches yet." : "History is off." }));
    } catch (err) { mount(historyList, h("p", { class: "form-error", text: err.message })); }
  }
  loadHistory();
  const history = h("section", { class: "panel" },
    h("div", { class: "row", style: { "justify-content": "space-between" } }, h("h2", { style: { margin: "0" }, text: "Search history" }),
      button("Clear", { variant: "ghost", size: "sm", iconName: "trash", onClick: async () => {
        try { await api("/api/account/history", { method: "DELETE" }); toast("History cleared", { icon: "🧹" }); loadHistory(); } catch (err) { errorToast(err); }
      } })),
    h("div", { style: { "margin-top": "12px" } }, historyList));

  // ---- security
  const cur = h("input", { class: "input", id: "pw-cur", type: "password", autocomplete: "current-password", maxlength: "128" });
  const nxt = h("input", { class: "input", id: "pw-new", type: "password", autocomplete: "new-password", minlength: "10", maxlength: "128" });
  const security = h("form", { class: "panel", onSubmit: async (e) => {
    e.preventDefault();
    try {
      await api("/api/account/password", { method: "POST", body: { current_password: cur.value, new_password: nxt.value } });
      cur.value = nxt.value = "";
      toast("Password changed. Other devices were signed out.", { icon: "🔐" });
    } catch (err) { errorToast(err); }
  } },
    h("h2", { text: "Security & data" }),
    h("div", { class: "grid-2" },
      h("div", { class: "field" }, h("label", { class: "label", for: "pw-cur", text: "Current password" }), cur),
      h("div", { class: "field" }, h("label", { class: "label", for: "pw-new", text: "New password" }), nxt)),
    h("div", { class: "row" },
      button("Change password", { variant: "dark", type: "submit" }),
      button("Download my data", { variant: "ghost", iconName: "download", onClick: async () => {
        try {
          const data = await api("/api/account/export");
          const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
          const a = h("a", { href: url, download: `recipe-bot-export-${new Date().toISOString().slice(0, 10)}.json` });
          document.body.append(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
        } catch (err) { errorToast(err); }
      } }),
      button("Sign out", { variant: "ghost", iconName: "logout", onClick: () => signOut(navigate) })));

  const danger = h("section", { class: "panel danger-zone" },
    h("h2", { text: "Delete account" }),
    h("p", { class: "muted", text: "Permanently deletes your account, cookbook, pantry, meal plan, shopping list and history. Shared links stop working. This can't be undone." }),
    button("Delete my account…", { variant: "danger", iconName: "trash", onClick: () => deleteModal(navigate) }));

  return h("section", { class: "view", style: { display: "grid", gap: "18px", "padding-top": "24px" } }, profile, prefsForm, history, security, danger);
}

async function signOut(navigate) {
  try { await api("/api/auth/logout", { method: "POST" }); } catch { /* ignore */ }
  navigator.serviceWorker?.controller?.postMessage({ type: "clear-api-cache" });
  setSession(null);
  Object.assign(state, { results: null });
  toast("Signed out. See you soon!", { icon: "👋" });
  navigate("/", { replace: true });
}

function deleteModal(navigate) {
  const pw = h("input", { class: "input", id: "del-pw", type: "password", autocomplete: "current-password" });
  const confirmText = h("input", { class: "input", id: "del-confirm", autocomplete: "off", placeholder: "DELETE" });
  const dlg = modal("Delete your account?", h("form", { onSubmit: async (e) => {
    e.preventDefault();
    try {
      await api("/api/account", { method: "DELETE", body: { password: pw.value, confirm: confirmText.value.trim() } });
      dlg.close();
      navigator.serviceWorker?.controller?.postMessage({ type: "clear-api-cache" });
      setSession(null);
      toast("Your account and data were deleted.", { icon: "🗑️" });
      navigate("/", { replace: true });
    } catch (err) { errorToast(err); }
  } },
    h("p", { text: "Everything you've saved will be permanently deleted." }),
    h("div", { class: "field" }, h("label", { class: "label", for: "del-pw", text: "Your password" }), pw),
    h("div", { class: "field" }, h("label", { class: "label", for: "del-confirm", text: "Type DELETE to confirm" }), confirmText),
    h("div", { class: "row" }, button("Delete everything", { variant: "danger", type: "submit", iconName: "trash" }),
      button("Cancel", { variant: "ghost", onClick: () => dlg.close() }))));
}
