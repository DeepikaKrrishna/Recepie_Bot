// Cook Mode: full-screen, step-by-step, hands-free cooking.
// Swipe / arrow keys / voice ("next", "back", "repeat", "timer", "done"), read-aloud,
// auto-detected timers, screen wake lock, and a celebratory finish that updates
// cook stats and lets you tick off pantry items you used up.
import { api } from "../lib/api.js";
import { clear, h, mount } from "../lib/dom.js";
import { sameIngredient } from "../lib/food.js";
import { formatQty } from "../lib/format.js";
import { icon } from "../lib/icons.js";
import { detectTimers, startTimer } from "../lib/timers.js";
import { loadPantry, localToday, state } from "../lib/store.js";
import { button, confetti, errorToast, toast } from "../lib/ui.js";

export function openCookMode(recipe, { servings = recipe.servings, savedId = () => null } = {}) {
  const factor = servings / recipe.servings;
  const total = recipe.steps.length + 1; // 0 = mise en place
  let index = 0;
  let speaking = false;
  let listening = false;
  let rec = null;
  let wakeLock = null;
  const opener = document.activeElement;

  const progress = h("i", { style: { "--w": "0%" } });
  const counter = h("span", { class: "tiny", style: { opacity: ".8" } });
  const stage = h("div", { class: "cookmode__stage", "aria-live": "polite" });
  const prev = button("Back", { variant: "ghost", iconName: "chevronLeft", onClick: () => go(index - 1) });
  const next = button("Next", { variant: "primary", onClick: () => go(index + 1) });
  next.append(icon("chevronRight"));
  const listenBadge = h("span", { class: "listening", hidden: true }, h("i"), "Listening: say “next”");

  const speakBtn = h("button", { class: "icon-btn", type: "button", "aria-pressed": "false", "aria-label": "Read steps aloud", title: "Read aloud", onClick: () => {
    speaking = !speaking;
    speakBtn.setAttribute("aria-pressed", String(speaking));
    if (speaking) speak(); else window.speechSynthesis?.cancel();
  } }, icon("volume"));
  if (!("speechSynthesis" in window)) speakBtn.hidden = true;

  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micBtn = h("button", { class: "icon-btn", type: "button", "aria-pressed": "false", "aria-label": "Hands-free voice control", title: "Voice control", onClick: toggleVoice }, icon("mic"));
  if (!Rec) micBtn.hidden = true;

  const root = h("div", { class: "cookmode", role: "dialog", "aria-modal": "true", "aria-label": `Cook mode: ${recipe.title}` },
    h("div", null,
      h("div", { class: "cookmode__top" },
        h("button", { class: "icon-btn", type: "button", "aria-label": "Exit cook mode", onClick: close }, icon("x")),
        h("div", { class: "cookmode__title", text: recipe.title }),
        listenBadge, counter, speakBtn, micBtn),
      h("div", { class: "cookmode__progress" }, progress)),
    stage,
    h("div", null,
      h("div", { class: "cookmode__nav" }, prev, h("p", { class: "cookmode__hint", text: "Swipe or use ← → keys" }), next)));

  function stepNode(i, dir) {
    if (i === 0) {
      return h("div", { class: `cstep cstep--${dir}` },
        h("p", { class: "cstep__num", text: `Mise en place · ${servings} servings` }),
        h("p", { class: "cstep__text", style: { "font-size": "clamp(1.4rem, 4vw, 2.2rem)" }, text: "Get everything ready first" }),
        h("ul", { class: "pills", style: { "justify-content": "center", "margin-top": "20px", "max-width": "760px" } },
          recipe.ingredients.map((ing) => h("li", { class: "pill", style: { background: "rgba(255,255,255,.08)", color: "#fbefe2", "font-size": "1rem", padding: "8px 14px" } },
            ing.quantity != null ? h("b", { style: { color: "#ffc145" }, text: `${formatQty(ing.quantity * factor)}${ing.unit ? " " + ing.unit : ""}` }) : null,
            ing.name))));
    }
    const text = recipe.steps[i - 1];
    return h("div", { class: `cstep cstep--${dir}` },
      h("p", { class: "cstep__num", text: `Step ${i} of ${recipe.steps.length}` }),
      h("p", { class: "cstep__text", text }),
      detectTimers(text).map((t) => h("button", { class: "timer-chip", type: "button", onClick: () => startTimer(`Step ${i}`, t.seconds) }, icon("timer"), `Start ${t.label} timer`)));
  }

  function doneNode() {
    const pantryBox = h("div");
    const node = h("div", { class: "cookmode__done cstep--next" },
      h("div", { style: { "font-size": "4rem" }, "aria-hidden": "true", text: "🎉" }),
      h("h2", { text: "Dinner is served!" }),
      h("p", { style: { opacity: ".85" }, text: `You cooked ${recipe.title}. Enjoy every bite.` }),
      pantryBox,
      h("div", { class: "row", style: { "justify-content": "center", "margin-top": "16px" } }, button("Close", { variant: "primary", onClick: close })));
    finish(pantryBox);
    return node;
  }

  async function finish(box) {
    confetti();
    if (!state.user) return;
    try {
      const id = savedId();
      if (id) await api(`/api/recipes/${id}/cooked`, { method: "POST" });
    } catch { /* stats are best-effort */ }
    const pantry = await loadPantry(true);
    const used = (pantry?.items || []).filter((p) => recipe.ingredients.some((ing) => sameIngredient(ing.name, p.name)));
    if (!used.length) return;
    const checks = used.map((p) => ({ p, box: h("input", { type: "checkbox", checked: p.status === "soon" || p.status === "expired" }) }));
    mount(box, h("div", { class: "panel", style: { "margin-top": "14px" } },
      h("h3", { style: { "font-family": "var(--font-body)" }, text: "Used anything up?" }),
      h("p", { class: "tiny", style: { opacity: ".8" }, text: "Tick what's finished and we'll clear it from your pantry. Items near expiry count as rescued." }),
      checks.map(({ p, box: cb }) => h("label", null, cb, `${p.name}`, p.status === "soon" ? h("span", { class: "pill pill--warn", text: "expiring" }) : null)),
      button("Update pantry", { variant: "leaf", size: "sm", iconName: "check", onClick: async (e) => {
        const ids = checks.filter((c) => c.box.checked).map((c) => c.p.id);
        if (!ids.length) { clear(box); return; }
        const btn = e.currentTarget;
        try {
          btn.disabled = true;
          const res = await api("/api/pantry/consume", { method: "POST", body: { ids, today: localToday() } });
          state.pantry = null;
          mount(box, h("p", { class: "callout callout--leaf", style: { color: "var(--ink)", "margin-top": "14px" },
            text: res.rescued ? `🛟 ${res.rescued} item${res.rescued > 1 ? "s" : ""} rescued from waste! That's ${res.rescued_total} so far.` : `Pantry updated: ${res.removed} item${res.removed > 1 ? "s" : ""} cleared.` }));
        } catch (err) { errorToast(err); btn.disabled = false; }
      } })));
  }

  function go(i, announce = true) {
    if (i < 0) return;
    if (i > total) return;
    const dir = i >= index ? "next" : "prev";
    index = i;
    progress.style.setProperty("--w", `${Math.round((Math.min(index, total) / total) * 100)}%`);
    counter.textContent = index === 0 ? "Prep" : index <= recipe.steps.length ? `${index}/${recipe.steps.length}` : "Done";
    prev.disabled = index === 0;
    next.hidden = index >= total;
    clear(next).append(index === recipe.steps.length ? "Finish" : "Next", icon(index === recipe.steps.length ? "check" : "chevronRight"));
    mount(stage, index >= total ? doneNode() : stepNode(index, dir));
    if (announce && speaking) speak();
  }

  function speak() {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const text = index === 0 ? `Let's cook ${recipe.title}. First, get your ingredients ready.`
      : index <= recipe.steps.length ? `Step ${index}. ${recipe.steps[index - 1]}` : "All done. Enjoy your meal!";
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-IN"; u.rate = 0.98;
    synth.speak(u);
  }

  function toggleVoice() {
    if (listening) { listening = false; rec?.stop(); return; }
    listening = true;
    micBtn.setAttribute("aria-pressed", "true");
    listenBadge.hidden = false;
    rec = new Rec();
    rec.lang = "en-IN"; rec.continuous = true; rec.interimResults = false;
    rec.onresult = (ev) => {
      const said = ev.results[ev.results.length - 1][0].transcript.toLowerCase();
      if (/\b(next|continue|done with (this|that))\b/.test(said)) go(index + 1);
      else if (/\b(back|previous|go back)\b/.test(said)) go(index - 1);
      else if (/\b(repeat|again|read)\b/.test(said)) speak();
      else if (/\btimer\b/.test(said)) {
        const t = index > 0 && index <= recipe.steps.length ? detectTimers(recipe.steps[index - 1])[0] : null;
        if (t) startTimer(`Step ${index}`, t.seconds); else toast("No timer in this step", { icon: "⏱️" });
      } else if (/\b(finish|finished|exit|close|stop cooking)\b/.test(said)) go(total);
    };
    rec.onerror = (ev) => { if (ev.error === "not-allowed") { toast("Microphone access was blocked.", { icon: "🎙️" }); listening = false; } };
    rec.onend = () => {
      if (listening && root.isConnected) { try { rec.start(); } catch { /* already started */ } return; }
      micBtn.setAttribute("aria-pressed", "false");
      listenBadge.hidden = true;
    };
    rec.start();
    toast("Hands-free on. Say “next”, “back”, “repeat” or “timer”.", { icon: "🎙️" });
  }

  async function lockScreen() {
    try { wakeLock = await navigator.wakeLock?.request("screen"); } catch { wakeLock = null; }
  }
  const onVisible = () => { if (document.visibilityState === "visible" && root.isConnected) lockScreen(); };

  const onKey = (e) => {
    if (e.key === "ArrowRight" || (e.key === " " && e.target === document.body)) { e.preventDefault(); go(index + 1); }
    else if (e.key === "ArrowLeft") go(index - 1);
    else if (e.key === "Escape") close();
  };

  // swipe
  let sx = null;
  stage.addEventListener("pointerdown", (e) => { sx = e.clientX; });
  stage.addEventListener("pointerup", (e) => {
    if (sx == null) return;
    const dx = e.clientX - sx; sx = null;
    if (Math.abs(dx) > 60) go(index + (dx < 0 ? 1 : -1));
  });

  function close() {
    listening = false;
    rec?.stop();
    window.speechSynthesis?.cancel();
    wakeLock?.release?.().catch(() => {});
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("visibilitychange", onVisible);
    document.documentElement.style.removeProperty("overflow");
    root.remove();
    opener?.focus?.();
  }

  document.body.append(root);
  document.documentElement.style.setProperty("overflow", "hidden");
  document.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onVisible);
  lockScreen();
  go(0, false);
  next.focus();
}
