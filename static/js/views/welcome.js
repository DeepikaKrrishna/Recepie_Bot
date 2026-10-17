// Welcome: the landing + sign up / sign in. The rest of the app needs an account.
import { api } from "../lib/api.js";
import { h, mount } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { setSession, state } from "../lib/store.js";
import { busy, button, mascot, toast, withTransition } from "../lib/ui.js";

const FALLING = ["🍅", "🧅", "🥕", "🌶️", "🧄", "🍋", "🥚", "🧀", "🥔", "🌿"];

function strength(pw) {
  let score = 0;
  if (pw.length >= 10) score++;
  if (pw.length >= 14) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score++;
  return score;
}

function passwordField(id, label, autocomplete) {
  const input = h("input", { class: "input", id, type: "password", required: true, maxlength: "128", autocomplete });
  const toggle = h("button", { class: "icon-btn", type: "button", "aria-label": "Show password", "aria-pressed": "false", onClick: () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    toggle.setAttribute("aria-pressed", String(show));
    toggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
  } }, icon("eye"));
  return { input, el: h("div", { class: "field" }, h("label", { class: "label", for: id, text: label }), h("div", { class: "pw-wrap" }, input, toggle)) };
}

export async function render({ mode = "signup", navigate, query }) {
  const next = query.get("next");
  const go = () => navigate(next && next.startsWith("/") && !next.startsWith("//") ? next : "/", { replace: true });

  // ---- hero
  const stage = h("div", { class: "landing__stage", "aria-hidden": "true" },
    FALLING.map((e, i) => h("span", { class: "falling", style: { left: `${8 + ((i * 37) % 84)}%`, "animation-delay": `${(i * 0.37).toFixed(2)}s` }, text: e })),
    h("div", { class: "landing__pot" }, mascot({ size: 260 })));

  const hero = h("div", null,
    h("span", { class: "eyebrow", text: "🍳 Your AI sous-chef" }),
    h("h1", null, "Turn your fridge into a ", h("span", { class: "mark", text: "feast" }), "."),
    h("p", { class: "landing__lede", text: "Type what you have. Get real, tasty recipes in seconds, cook hands-free step by step, and keep the winners in your cookbook." }),
    stage,
    h("div", { class: "perks" },
      ["⚡ Recipes in seconds", "👩‍🍳 Hands-free Cook Mode", "🎮 Mini game while you wait", "❤️ Your own cookbook"].map((p) => h("span", { class: "pill pill--sun", text: p }))));

  // ---- auth card
  const card = h("section", { class: "card auth-card", "aria-labelledby": "authTitle" });
  let current = mode;

  function drawForm() {
    const isSignup = current === "signup";
    const tabs = h("div", { class: "tabs", role: "tablist", "aria-label": "Account" },
      [["signup", "Create account"], ["login", "Sign in"]].map(([m, l]) => h("button", { type: "button", role: "tab", "aria-selected": String(m === current),
        onClick: () => { if (m !== current) { current = m; history.replaceState({}, "", `/${m === "login" ? "login" : "signup"}${location.search}`); withTransition(drawForm); } } }, l)));
    const name = isSignup ? h("input", { class: "input", id: "name", autocomplete: "given-name", maxlength: "60", placeholder: "What should we call you?" }) : null;
    const email = h("input", { class: "input", id: "email", type: "email", required: true, autocomplete: "email", maxlength: "254", placeholder: "you@example.com" });
    const pw = passwordField("password", isSignup ? "Password (10+ characters)" : "Password", isSignup ? "new-password" : "current-password");
    const meterBar = h("i");
    const meterLabel = h("p", { class: "help", "aria-live": "polite" });
    if (isSignup) {
      pw.input.addEventListener("input", () => {
        const sc = strength(pw.input.value);
        meterBar.style.setProperty("--w", `${(sc / 4) * 100}%`);
        meterLabel.textContent = pw.input.value ? ["Too short", "Okay", "Good", "Strong 💪", "Chef's kiss 🤌"][sc] : "";
      });
      pw.el.append(h("div", { class: "meter", "aria-hidden": "true" }, meterBar), meterLabel);
    }
    const err = h("p", { class: "form-error", role: "alert", hidden: true });
    const submit = button(isSignup ? "Let's cook! 🍳" : "Sign in", { variant: "primary", size: "lg", type: "submit", class: "btn btn--primary btn--lg btn--block" });
    const form = h("form", { novalidate: true, onSubmit: async (e) => {
      e.preventDefault();
      err.hidden = true;
      if (!email.value.trim() || !pw.input.value) { err.textContent = "Enter your email and password."; err.hidden = false; return; }
      if (isSignup && pw.input.value.length < 10) { err.textContent = "Use at least 10 characters for your password."; err.hidden = false; pw.input.focus(); return; }
      try {
        busy(submit, true, isSignup ? "Setting up your kitchen…" : "Signing in…");
        const me = await api(isSignup ? "/api/auth/signup" : "/api/auth/login", { method: "POST",
          body: isSignup ? { email: email.value, password: pw.input.value, display_name: name.value.trim() } : { email: email.value, password: pw.input.value } });
        setSession(me);
        toast(isSignup ? `Welcome to the kitchen${state.user.display_name ? ", " + state.user.display_name : ""}! 🎉` : `Welcome back${state.user.display_name ? ", " + state.user.display_name : ""}! 👋`, { icon: "🍳" });
        go();
      } catch (ex) {
        err.textContent = ex.message; err.hidden = false;
        busy(submit, false, isSignup ? "Let's cook! 🍳" : "Sign in");
      }
    } },
      isSignup ? h("div", { class: "field" }, h("label", { class: "label", for: "name", text: "Your name (optional)" }), name) : null,
      h("div", { class: "field" }, h("label", { class: "label", for: "email", text: "Email" }), email),
      pw.el, err, submit,
      isSignup ? h("p", { class: "help", style: { "margin-top": "12px" } }, "By signing up you agree to the ", h("a", { href: "/terms" }, "terms"), " and ", h("a", { href: "/privacy" }, "privacy notice"), ".") : null);
    mount(card, tabs, h("h2", { id: "authTitle", text: isSignup ? "Join the kitchen" : "Welcome back, chef" }),
      h("p", { class: "muted", text: isSignup ? "Free, takes 10 seconds." : "Your cookbook is waiting." }), form);
  }
  drawForm();

  return h("section", { class: "landing view" }, hero, card);
}
