// Cook Mode: full-screen, one step at a time, hands-free.
// Swipe / arrow keys / voice ("next", "back", "repeat", "timer", "done"), read-aloud,
// auto-detected timers, screen wake lock, and a confetti finish that records the cook.
import { api } from "../lib/api.js";
import { clear, h, mount } from "../lib/dom.js";
import { formatQty } from "../lib/format.js";
import { icon } from "../lib/icons.js";
import { detectTimers, startTimer } from "../lib/timers.js";
import { state } from "../lib/store.js";
import { button, confetti, toast } from "../lib/ui.js";

export function openCookMode(recipe, { servings = recipe.servings, savedId = () => null } = {}) {
  const factor = servings / recipe.servings;
  const total = recipe.steps.length + 1; // 0 = get ready
  let index = 0, speaking = false, listening = false, rec = null, wakeLock = null;
  const opener = document.activeElement;

  const dots = h("div", { class: "cookmode__dots", "aria-hidden": "true" }, Array.from({ length: total + 1 }, () => h("i")));
  const stage = h("div", { class: "cookmode__stage", "aria-live": "polite" });
  const prev = button("Back", { variant: "ghost", iconName: "chevronLeft", onClick: () => go(index - 1) });
  const next = button("Next", { variant: "sun", onClick: () => go(index + 1) });
  const listenBadge = h("span", { class: "listening", hidden: true }, h("i"), "Say “next”");

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
        h("div", { class: "cookmode__title", text: `${recipe.hero_emoji || "🍳"} ${recipe.title}` }),
        listenBadge, speakBtn, micBtn),
      dots),
    stage,
    h("div", { class: "cookmode__nav" }, prev, h("p", { class: "cookmode__hint", text: "Swipe or use ← →" }), next));

  function stepNode(i, dir) {
    if (i === 0) {
      return h("div", { class: `cstep cstep--${dir}` },
        h("p", { class: "cstep__num", text: `Get ready · ${servings} serving${servings > 1 ? "s" : ""}` }),
        h("p", { class: "cstep__text", style: { "font-size": "clamp(1.5rem, 4vw, 2.4rem)" }, text: "Line up your ingredients 🧺" }),
        h("ul", { class: "pills", style: { "justify-content": "center", "margin-top": "22px", "max-width": "780px" } },
          recipe.ingredients.map((ing) => h("li", { class: "pill", style: { background: "#241d36", color: "#fff3e4", "border-color": "#000", "font-size": "1rem", padding: "8px 14px" } },
            ing.quantity != null ? h("b", { style: { color: "#ffc93c" }, text: `${formatQty(ing.quantity * factor)}${ing.unit ? " " + ing.unit : ""}` }) : null,
            ing.name))));
    }
    const text = recipe.steps[i - 1];
    return h("div", { class: `cstep cstep--${dir}` },
      h("p", { class: "cstep__num", text: `Step ${i} of ${recipe.steps.length}` }),
      h("p", { class: "cstep__text", text }),
      detectTimers(text).map((t) => h("button", { class: "timer-chip", type: "button", onClick: () => startTimer(`Step ${i}`, t.seconds) }, icon("timer"), `Start ${t.label} timer`)));
  }

  function doneNode() {
    confetti();
    const id = savedId();
    if (id) api(`/api/recipes/${id}/cooked`, { method: "POST" }).then(() => { if (state.user) state.user.stats.cooked += 1; }).catch(() => {});
    return h("div", { class: "cookmode__done cstep--next" },
      h("div", { style: { "font-size": "5rem" }, "aria-hidden": "true", text: recipe.hero_emoji || "🎉" }),
      h("h2", { text: "Dinner is served!" }),
      h("p", { style: { opacity: ".85", "font-size": "1.1rem" }, text: `You cooked ${recipe.title}. Enjoy every bite!` }),
      !id ? h("p", { class: "tiny", style: { opacity: ".75" }, text: "Tip: save it to your cookbook to track how often you cook it." }) : null,
      h("div", { class: "row", style: { "justify-content": "center", "margin-top": "18px" } }, button("Back to recipe", { variant: "sun", onClick: close })));
  }

  function go(i, announce = true) {
    if (i < 0 || i > total) return;
    const dir = i >= index ? "next" : "prev";
    index = i;
    [...dots.children].forEach((d, k) => { d.className = k < index ? "done" : k === index ? "on" : ""; });
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
      if (/\b(next|continue)\b/.test(said)) go(index + 1);
      else if (/\b(back|previous)\b/.test(said)) go(index - 1);
      else if (/\b(repeat|again|read)\b/.test(said)) speak();
      else if (/\btimer\b/.test(said)) {
        const t = index > 0 && index <= recipe.steps.length ? detectTimers(recipe.steps[index - 1])[0] : null;
        if (t) startTimer(`Step ${index}`, t.seconds); else toast("No timer in this step", { icon: "⏱️" });
      } else if (/\b(finish|finished|done|exit|close)\b/.test(said)) go(total);
    };
    rec.onerror = (ev) => { if (ev.error === "not-allowed") { toast("Microphone access was blocked.", { icon: "🎙️" }); listening = false; } };
    rec.onend = () => {
      if (listening && root.isConnected) { try { rec.start(); } catch { /* already started */ } return; }
      micBtn.setAttribute("aria-pressed", "false");
      listenBadge.hidden = true;
    };
    rec.start();
    toast("Hands-free on! Say “next”, “back”, “repeat” or “timer”.", { icon: "🎙️" });
  }

  async function lockScreen() { try { wakeLock = await navigator.wakeLock?.request("screen"); } catch { wakeLock = null; } }
  const onVisible = () => { if (document.visibilityState === "visible" && root.isConnected) lockScreen(); };
  const onKey = (e) => {
    if (e.key === "ArrowRight" || (e.key === " " && e.target === document.body)) { e.preventDefault(); go(index + 1); }
    else if (e.key === "ArrowLeft") go(index - 1);
    else if (e.key === "Escape") close();
  };
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
