// Sign in / sign up.
import { api } from "../lib/api.js";
import { h } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { setSession, state } from "../lib/store.js";
import { busy, button, mascot, toast } from "../lib/ui.js";

function safeNext(query) {
  const next = query.get("next") || "/";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/api") ? next : "/";
}

function passwordField(id, label, autocomplete) {
  const input = h("input", { class: "input", id, type: "password", required: true, minlength: autocomplete === "new-password" ? "10" : null, maxlength: "128", autocomplete });
  const toggle = h("button", { class: "icon-btn icon-btn--plain", type: "button", "aria-label": "Show password", "aria-pressed": "false",
    style: { position: "absolute", right: "4px", top: "3px" }, onClick: () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      toggle.setAttribute("aria-pressed", String(show));
      toggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
    } }, icon("eye"));
  return { input, el: h("div", { class: "field" }, h("label", { class: "label", for: id, text: label }), h("div", { style: { position: "relative" } }, input, toggle)) };
}

function strength(pw) {
  let score = 0;
  if (pw.length >= 10) score++;
  if (pw.length >= 14) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score++;
  return score;
}

function layout(title, sub, form, footer) {
  return h("section", { class: "auth view" },
    h("div", { class: "auth__art", "aria-hidden": "true" }, h("div", { style: { position: "relative" } }, mascot({ size: 300 }))),
    h("div", { class: "panel" }, h("p", { class: "eyebrow", text: "Recipe Bot" }), h("h1", { style: { "font-size": "2.4rem" }, text: title }),
      h("p", { class: "muted", text: sub }), form, h("p", { class: "muted tiny", style: { "margin-top": "16px" } }, footer)));
}

export async function renderLogin({ query, navigate }) {
  if (state.user) { navigate(safeNext(query), { replace: true }); return h("div"); }
  const email = h("input", { class: "input", id: "email", type: "email", required: true, autocomplete: "email", maxlength: "254" });
  const pw = passwordField("password", "Password", "current-password");
  const err = h("p", { class: "form-error", role: "alert", hidden: true });
  const submit = button("Sign in", { variant: "primary", size: "lg", type: "submit", class: "btn btn--primary btn--lg btn--block" });
  const form = h("form", { novalidate: true, onSubmit: async (e) => {
    e.preventDefault();
    err.hidden = true;
    if (!email.value || !pw.input.value) { err.textContent = "Enter your email and password."; err.hidden = false; return; }
    try {
      busy(submit, true, "Signing in…");
      setSession(await api("/api/auth/login", { method: "POST", body: { email: email.value, password: pw.input.value } }));
      toast(`Welcome back${state.user.display_name ? ", " + state.user.display_name : ""}!`, { icon: "👋" });
      navigate(safeNext(query), { replace: true });
    } catch (ex) { err.textContent = ex.message; err.hidden = false; busy(submit, false, "Sign in"); pw.input.select(); }
  } }, h("div", { class: "field" }, h("label", { class: "label", for: "email", text: "Email" }), email), pw.el, err, submit);
  return layout("Welcome back", "Your cookbook, pantry and plan are waiting.", form,
    ["New here? ", h("a", { href: `/signup${location.search}`, "data-link": "" }, "Create a free account")]);
}

export async function renderSignup({ query, navigate }) {
  if (state.user) { navigate(safeNext(query), { replace: true }); return h("div"); }
  const name = h("input", { class: "input", id: "name", autocomplete: "given-name", maxlength: "60", placeholder: "What should we call you?" });
  const email = h("input", { class: "input", id: "email", type: "email", required: true, autocomplete: "email", maxlength: "254" });
  const pw = passwordField("password", "Password (10+ characters)", "new-password");
  const meter = h("div", { class: "match__bar", style: { height: "6px", "margin-top": "8px" }, "aria-hidden": "true" }, h("i", { style: { "--w": "0%" } }));
  const meterLabel = h("p", { class: "help", "aria-live": "polite" });
  pw.input.addEventListener("input", () => {
    const sc = strength(pw.input.value);
    meter.firstChild.style.setProperty("--w", `${(sc / 4) * 100}%`);
    meterLabel.textContent = pw.input.value ? ["Too short", "Okay", "Good", "Strong", "Excellent"][sc] : "";
  });
  pw.el.append(meter, meterLabel);
  const err = h("p", { class: "form-error", role: "alert", hidden: true });
  const submit = button("Create account", { variant: "primary", size: "lg", type: "submit", class: "btn btn--primary btn--lg btn--block" });
  const form = h("form", { novalidate: true, onSubmit: async (e) => {
    e.preventDefault();
    err.hidden = true;
    if (pw.input.value.length < 10) { err.textContent = "Use at least 10 characters for your password."; err.hidden = false; pw.input.focus(); return; }
    try {
      busy(submit, true, "Creating…");
      setSession(await api("/api/auth/signup", { method: "POST", body: { email: email.value, password: pw.input.value, display_name: name.value.trim() } }));
      toast("Account created. Let's cook!", { icon: "🎉" });
      navigate(safeNext(query), { replace: true });
    } catch (ex) { err.textContent = ex.message; err.hidden = false; busy(submit, false, "Create account"); }
  } },
    h("div", { class: "field" }, h("label", { class: "label", for: "name", text: "Name (optional)" }), name),
    h("div", { class: "field" }, h("label", { class: "label", for: "email", text: "Email" }), email),
    pw.el, err, submit,
    h("p", { class: "help", style: { "margin-top": "12px" } }, "By signing up you agree to the ", h("a", { href: "/terms" }, "terms"), " and ", h("a", { href: "/privacy" }, "privacy notice"), "."));
  return layout("Join the kitchen", "Save recipes, track your pantry, plan your week. Free.", form,
    ["Already have an account? ", h("a", { href: `/login${location.search}`, "data-link": "" }, "Sign in")]);
}
