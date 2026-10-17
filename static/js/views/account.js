// Me: profile, stats, password, export, sign out, delete account.
import { api } from "../lib/api.js";
import { countUp, h } from "../lib/dom.js";
import { refreshSession, setSession, state } from "../lib/store.js";
import { busy, button, errorToast, modal, toast } from "../lib/ui.js";

export async function render({ navigate }) {
  await refreshSession();
  const u = state.user;
  const stats = [["saved", "recipes saved"], ["cooked", "meals cooked"], ["best_game_score", "best Chef Run score"]];
  const statEls = stats.map(([k, label]) => {
    const b = h("b");
    countUp(b, u.stats[k] || 0);
    return h("div", { class: "bigstat" }, b, h("span", { text: label }));
  });
  const profile = h("section", { class: "card" },
    h("div", { class: "profile" },
      h("div", { class: "avatar", "aria-hidden": "true", text: (u.display_name || u.email)[0].toUpperCase() }),
      h("div", null, h("h1", { style: { "font-size": "2.2rem", margin: "0" }, text: u.display_name ? `Hi, ${u.display_name}!` : "Your kitchen" }),
        h("p", { class: "muted", style: { margin: "0" }, text: `${u.email} · cooking since ${new Date(u.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" })}` }))),
    h("div", { class: "statgrid" }, statEls));

  const name = h("input", { class: "input", id: "pf-name", maxlength: "60", value: u.display_name || "" });
  const saveName = button("Save", { variant: "sun", type: "submit" });
  const nameForm = h("form", { class: "card", onSubmit: async (e) => {
    e.preventDefault();
    try { busy(saveName, true); await api("/api/account/profile", { method: "PUT", body: { display_name: name.value.trim() } }); await refreshSession(); toast("Name updated ✨", { icon: "👍" }); }
    catch (err) { errorToast(err); } finally { busy(saveName, false); }
  } }, h("label", { class: "label", for: "pf-name", text: "Display name" }), h("div", { class: "row" }, h("div", { class: "grow" }, name), saveName));

  const cur = h("input", { class: "input", id: "pw-cur", type: "password", autocomplete: "current-password", maxlength: "128" });
  const nxt = h("input", { class: "input", id: "pw-new", type: "password", autocomplete: "new-password", maxlength: "128" });
  const security = h("form", { class: "card", onSubmit: async (e) => {
    e.preventDefault();
    try {
      await api("/api/account/password", { method: "POST", body: { current_password: cur.value, new_password: nxt.value } });
      cur.value = nxt.value = "";
      toast("Password changed. Other devices were signed out.", { icon: "🔐" });
    } catch (err) { errorToast(err); }
  } },
    h("h2", { text: "🔐 Security & data" }),
    h("div", { class: "grid-2" },
      h("div", { class: "field" }, h("label", { class: "label", for: "pw-cur", text: "Current password" }), cur),
      h("div", { class: "field" }, h("label", { class: "label", for: "pw-new", text: "New password" }), nxt)),
    h("div", { class: "row" },
      button("Change password", { variant: "sun", type: "submit" }),
      button("Download my data", { variant: "ghost", iconName: "download", onClick: async () => {
        try {
          const data = await api("/api/account/export");
          const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
          const a = h("a", { href: url, download: `recipe-bot-${new Date().toISOString().slice(0, 10)}.json` });
          document.body.append(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
        } catch (err) { errorToast(err); }
      } }),
      button("Sign out", { variant: "ghost", iconName: "logout", onClick: () => signOut(navigate) })));

  const danger = h("section", { class: "card danger-zone" },
    h("h2", { text: "Delete account" }),
    h("p", { class: "muted", text: "Permanently deletes your account and cookbook. This can't be undone." }),
    button("Delete my account…", { variant: "danger", iconName: "trash", onClick: () => deleteModal(navigate) }));

  return h("section", { class: "view", style: { display: "grid", gap: "20px", "padding-top": "18px" } }, profile, nameForm, security, danger);
}

async function signOut(navigate) {
  try { await api("/api/auth/logout", { method: "POST" }); } catch { /* ignore */ }
  navigator.serviceWorker?.controller?.postMessage({ type: "clear-api-cache" });
  setSession(null);
  toast("Signed out. See you soon! 👋", { icon: "🍳" });
  navigate("/welcome", { replace: true });
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
      navigate("/welcome", { replace: true });
    } catch (err) { errorToast(err); }
  } },
    h("p", { text: "Your cookbook will be permanently deleted." }),
    h("div", { class: "field" }, h("label", { class: "label", for: "del-pw", text: "Your password" }), pw),
    h("div", { class: "field" }, h("label", { class: "label", for: "del-confirm", text: "Type DELETE to confirm" }), confirmText),
    h("div", { class: "row" }, button("Delete everything", { variant: "danger", type: "submit", iconName: "trash" }),
      button("Cancel", { variant: "ghost", onClick: () => dlg.close() }))));
}
