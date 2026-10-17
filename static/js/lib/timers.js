// Kitchen timers: detected from step text, shown in a floating dock that survives
// navigation, with a chime, vibration and a tab-title alert when done.
import { $, clear, h, s } from "./dom.js";
import { icon } from "./icons.js";
import { toast } from "./ui.js";

const timers = [];
let tick = null;
let audio = null;
const baseTitle = document.title;

/** Find durations like "10 minutes", "1-2 min", "1 hour", "30 secs" in a step. */
export function detectTimers(text) {
  const out = [];
  const re = /(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/gi;
  let m;
  while ((m = re.exec(text))) {
    const value = parseFloat(m[2] || m[1]);
    const unit = m[3].toLowerCase();
    const mult = unit.startsWith("h") ? 3600 : unit.startsWith("m") ? 60 : 1;
    const seconds = Math.round(value * mult);
    if (seconds >= 10 && seconds <= 6 * 3600 && !out.some((t) => t.seconds === seconds)) out.push({ seconds, label: m[0] });
  }
  return out;
}

export function fmt(sec) {
  const v = Math.max(0, Math.ceil(sec));
  const hh = Math.floor(v / 3600), mm = Math.floor((v % 3600) / 60), ss = v % 60;
  return hh ? `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${mm}:${String(ss).padStart(2, "0")}`;
}

export function startTimer(label, seconds) {
  const t = { id: Math.random().toString(36).slice(2), label, total: seconds, end: Date.now() + seconds * 1000, paused: null, done: false };
  timers.push(t);
  primeAudio();
  render();
  if (!tick) tick = setInterval(update, 500);
  toast(`Timer set: ${fmt(seconds)} for ${label}`, { icon: "⏱️", timeout: 2500 });
}

function remaining(t) { return t.paused != null ? t.paused : (t.end - Date.now()) / 1000; }

function primeAudio() {
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); } catch { audio = null; }
}

function chime() {
  if (!audio) return;
  const now = audio.currentTime;
  [0, 0.25, 0.5, 1.0, 1.25, 1.5].forEach((offset, i) => {
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = "sine"; o.frequency.value = i % 3 === 2 ? 1046 : 880;
    g.gain.setValueAtTime(0.0001, now + offset);
    g.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.22);
    o.connect(g).connect(audio.destination); o.start(now + offset); o.stop(now + offset + 0.25);
  });
}

function update() {
  let anyDone = false;
  for (const t of timers) {
    if (!t.done && t.paused == null && remaining(t) <= 0) {
      t.done = true;
      chime();
      navigator.vibrate?.([300, 120, 300, 120, 300]);
      toast(`⏰ ${t.label}: time's up!`, { icon: "🔔", timeout: 8000 });
    }
    anyDone ||= t.done;
  }
  document.title = anyDone ? "⏰ Time's up! · Recipe Bot" : timers.length ? `${fmt(remaining(timers[0]))} · ${baseTitle}` : baseTitle;
  render();
  if (!timers.length) { clearInterval(tick); tick = null; document.title = baseTitle; }
}

function remove(id) {
  const i = timers.findIndex((t) => t.id === id);
  if (i >= 0) timers.splice(i, 1);
  update();
}

function render() {
  const dock = $("#timers");
  if (!dock) return;
  // Update in place where possible to keep animations smooth.
  const ids = new Set(timers.map((t) => t.id));
  for (const el of [...dock.children]) if (!ids.has(el.dataset.id)) el.remove();
  for (const t of timers) {
    let el = dock.querySelector(`[data-id="${t.id}"]`);
    const C = 2 * Math.PI * 14;
    if (!el) {
      el = h("div", { class: "timer", dataset: { id: t.id }, role: "timer", "aria-label": `Timer for ${t.label}` },
        s("svg", { class: "ring", viewBox: "0 0 34 34" },
          s("circle", { class: "track", cx: 17, cy: 17, r: 14 }),
          s("circle", { class: "bar", cx: 17, cy: 17, r: 14, "stroke-dasharray": C.toFixed(2) })),
        h("div", { style: { flex: "1" } }, h("div", { class: "timer__time" }), h("div", { class: "timer__label", text: t.label })),
        h("button", { class: "icon-btn timer__pause", type: "button", "aria-label": "Pause or resume", onClick: () => {
          if (t.done) return;
          if (t.paused != null) { t.end = Date.now() + t.paused * 1000; t.paused = null; } else t.paused = remaining(t);
          update();
        } }),
        h("button", { class: "icon-btn", type: "button", "aria-label": "Dismiss timer", onClick: () => remove(t.id) }, icon("x")));
      dock.append(el);
    }
    const left = remaining(t);
    el.classList.toggle("timer--done", t.done);
    el.querySelector(".timer__time").textContent = t.done ? "Done!" : fmt(left);
    el.querySelector(".bar").setAttribute("stroke-dashoffset", (C * (1 - Math.max(0, left) / t.total)).toFixed(2));
    const pause = el.querySelector(".timer__pause");
    const want = t.paused != null ? "play" : "pause";
    if (pause.dataset.icon !== want) { clear(pause).append(icon(want)); pause.dataset.icon = want; }
    pause.hidden = t.done;
  }
}
