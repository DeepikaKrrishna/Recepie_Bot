// Chef Run: a tiny endless-runner to play while the AI cooks up recipes.
// Pot-bot runs along the kitchen counter. Tap / click / Space / ↑ to jump (hold for higher).
// Dodge flames, knives and hot pans; grab ingredients for +10.
import { h } from "./dom.js";

const HAZARDS = [
  { e: "🔥", w: 30, h: 34 },
  { e: "🔪", w: 24, h: 40 },
  { e: "🍳", w: 36, h: 28 },
];
const GOODIES = ["🍅", "🧅", "🥕", "🌶️", "🧄", "🍋", "🥔", "🧀", "🥚", "🌽"];

export function chefRun({ best = 0, onGameOver } = {}) {
  const canvas = h("canvas", { tabindex: "0", role: "img", "aria-label": "Chef Run mini game. Press Space or tap to jump over hazards and collect ingredients." });
  const scoreEl = h("span", { text: "Score 0" });
  const bestEl = h("span", { text: `Best ${best}` });
  const readySlot = h("div", { class: "game__ready", hidden: true });
  const live = h("p", { class: "sr-only", "aria-live": "polite" });
  const el = h("div", { class: "game" }, canvas, h("div", { class: "game__hud", "aria-hidden": "true" }, scoreEl, bestEl), readySlot, live);
  const ctx = canvas.getContext("2d");

  let W = 600, H = 260, ground = 210, dpr = 1;
  let state = "idle"; // idle | running | over
  let speed = 330, distance = 0, bonus = 0, score = 0, tSpawn = 0, tGoodie = 0, last = 0, t = 0, overAt = 0;
  let hazards = [], goodies = [], pops = [], clouds = [];
  const player = { x: 74, y: 0, vy: 0, w: 46, h: 40, grounded: true, squash: 0, holding: false };

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth || 600; H = canvas.clientHeight || 260;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ground = H - 44;
    if (player.grounded) player.y = ground;
    if (!clouds.length) clouds = Array.from({ length: 4 }, (_, i) => ({ x: (i + 0.3) * W / 3.5, y: 30 + (i % 2) * 34, s: 0.6 + (i % 3) * 0.25 }));
  }

  function reset() {
    state = "running"; speed = 330; distance = 0; bonus = 0; score = 0; tSpawn = 0.6; tGoodie = 1.2;
    hazards = []; goodies = []; pops = [];
    player.y = ground; player.vy = 0; player.grounded = true;
  }

  function jumpStart() {
    if (state === "idle") { reset(); jump(); return; }
    if (state === "over") { if (performance.now() - overAt > 450) { reset(); jump(); } return; }
    jump();
  }
  function jump() {
    if (!player.grounded) return;
    player.vy = -840; player.grounded = false; player.holding = true; player.squash = -0.18;
  }
  function jumpEnd() {
    player.holding = false;
    if (player.vy < -340) player.vy = -340; // short hop when released early
  }

  function update(dt) {
    t += dt;
    for (const c of clouds) { c.x -= (state === "running" ? speed * 0.08 : 12) * c.s * dt; if (c.x < -80) c.x = W + 40; }
    if (state !== "running") return;
    speed = Math.min(820, speed + 11 * dt);
    distance += speed * dt;

    // player physics
    player.vy += (player.holding && player.vy < 0 ? 1900 : 2600) * dt;
    player.y += player.vy * dt;
    if (player.y >= ground) {
      if (!player.grounded) player.squash = 0.22;
      player.y = ground; player.vy = 0; player.grounded = true;
    }
    player.squash *= 0.86;

    // spawning
    tSpawn -= dt;
    if (tSpawn <= 0) {
      const type = HAZARDS[Math.floor(Math.random() * HAZARDS.length)];
      hazards.push({ ...type, x: W + 30 });
      const minGap = 0.62 + 230 / speed, maxGap = minGap + 0.9;
      tSpawn = minGap + Math.random() * (maxGap - minGap);
      if (Math.random() < 0.18 && speed > 450) hazards.push({ ...HAZARDS[0], x: W + 30 + type.w + 6 }); // double flame
    }
    tGoodie -= dt;
    if (tGoodie <= 0) {
      goodies.push({ e: GOODIES[Math.floor(Math.random() * GOODIES.length)], x: W + 40, y: ground - 70 - Math.random() * 70, r: 15 });
      tGoodie = 0.9 + Math.random() * 1.4;
    }

    for (const o of hazards) o.x -= speed * dt;
    for (const g of goodies) g.x -= speed * dt;
    hazards = hazards.filter((o) => o.x > -60);
    goodies = goodies.filter((g) => g.x > -40 && !g.taken);
    for (const p of pops) { p.y -= 40 * dt; p.life -= dt; }
    pops = pops.filter((p) => p.life > 0);

    // collisions (forgiving boxes)
    const px = player.x + 8, py = player.y - player.h + 8, pw = player.w - 16, ph = player.h - 10;
    for (const o of hazards) {
      if (px < o.x + o.w - 6 && px + pw > o.x + 6 && py + ph > ground - o.h + 8) { gameOver(); return; }
    }
    for (const g of goodies) {
      const cx = player.x + player.w / 2, cy = player.y - player.h / 2;
      if (Math.hypot(cx - g.x, cy - g.y) < g.r + 22) {
        g.taken = true; bonus += 10;
        pops.push({ x: g.x, y: g.y, life: 0.7, text: "+10" });
        navigator.vibrate?.(8);
      }
    }
    score = Math.floor(distance / 12) + bonus;
    scoreEl.textContent = `Score ${score}`;
  }

  function gameOver() {
    state = "over"; overAt = performance.now();
    navigator.vibrate?.([30, 40, 30]);
    if (score > best) { best = score; bestEl.textContent = `Best ${best}`; }
    live.textContent = `Ouch! You scored ${score}. Press Space or tap to try again.`;
    onGameOver?.(score);
  }

  // ---- drawing ------------------------------------------------------------------
  const dark = () => document.documentElement.getAttribute("data-theme") === "dark";

  function roundRect(x, y, w, hh, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hh, r); ctx.arcTo(x + w, y + hh, x, y + hh, r);
    ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function drawPlayer() {
    const ink = "#1f1a2e";
    const s = player.squash;
    const w = player.w * (1 + s), hh = player.h * (1 - s);
    const x = player.x - (w - player.w) / 2, y = player.y - hh;
    const run = state === "running" && player.grounded ? Math.sin(t * 22) : 0;
    ctx.lineWidth = 2.5; ctx.strokeStyle = ink;
    // legs
    ctx.fillStyle = ink;
    ctx.fillRect(x + 10, y + hh - 2 + Math.max(0, run) * 4, 6, 7);
    ctx.fillRect(x + w - 16, y + hh - 2 + Math.max(0, -run) * 4, 6, 7);
    // body
    ctx.fillStyle = "#fffdf8"; roundRect(x, y + 8, w, hh - 8, 13); ctx.fill(); ctx.stroke();
    // handles
    ctx.fillStyle = ink; roundRect(x - 7, y + 15, 9, 6, 3); ctx.fill(); roundRect(x + w - 2, y + 15, 9, 6, 3); ctx.fill();
    // lid (pops when airborne)
    const lift = player.grounded ? Math.max(0, Math.sin(t * 8)) * 1.5 : 7;
    ctx.fillStyle = "#ff7a3d"; ctx.beginPath(); ctx.ellipse(x + w / 2, y + 9 - lift, w / 2 + 3, 7, 0, Math.PI, 0); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#ffc93c"; roundRect(x + w / 2 - 5, y - 1 - lift, 10, 6, 3); ctx.fill(); ctx.stroke();
    // face
    const blink = Math.sin(t * 1.7) > 0.985;
    ctx.fillStyle = ink;
    if (state === "over") {
      ctx.lineWidth = 2;
      for (const ex of [x + w / 2 - 9, x + w / 2 + 9]) { ctx.beginPath(); ctx.moveTo(ex - 3, y + 20); ctx.lineTo(ex + 3, y + 26); ctx.moveTo(ex + 3, y + 20); ctx.lineTo(ex - 3, y + 26); ctx.stroke(); }
    } else {
      for (const ex of [x + w / 2 - 9, x + w / 2 + 9]) { ctx.beginPath(); ctx.ellipse(ex, y + 23, 3, blink ? 0.6 : 4, 0, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.fillStyle = "rgba(255,90,126,.55)";
    ctx.beginPath(); ctx.arc(x + 9, y + 29, 3.5, 0, Math.PI * 2); ctx.arc(x + w - 9, y + 29, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.beginPath();
    if (state === "over") ctx.arc(x + w / 2, y + 34, 4, Math.PI, 0); else ctx.arc(x + w / 2, y + 28, 4, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    // steam while running
    if (state === "running") {
      ctx.strokeStyle = "rgba(120,110,140,.55)"; ctx.lineWidth = 2.5; ctx.lineCap = "round";
      for (let i = 0; i < 2; i++) {
        const k = (t * 1.6 + i * 0.5) % 1;
        ctx.globalAlpha = 1 - k; ctx.beginPath();
        ctx.moveTo(x + w / 2 - 6 + i * 12, y - 6 - k * 22); ctx.quadraticCurveTo(x + w / 2 - 12 + i * 12, y - 12 - k * 22, x + w / 2 - 6 + i * 12, y - 18 - k * 22);
        ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
  }

  function emoji(e, x, y, size) {
    ctx.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#000"; // colour emoji still take their alpha from fillStyle
    ctx.globalAlpha = 1;
    ctx.fillText(e, x, y);
  }

  function draw() {
    const d = dark();
    ctx.clearRect(0, 0, W, H);
    // clouds of steam in the sky
    ctx.fillStyle = d ? "rgba(255,255,255,.08)" : "rgba(255,255,255,.85)";
    for (const c of clouds) {
      ctx.beginPath(); ctx.arc(c.x, c.y, 16 * c.s, 0, Math.PI * 2); ctx.arc(c.x + 18 * c.s, c.y - 8 * c.s, 20 * c.s, 0, Math.PI * 2);
      ctx.arc(c.x + 40 * c.s, c.y, 15 * c.s, 0, Math.PI * 2); ctx.fill();
    }
    // counter top
    ctx.fillStyle = d ? "#3b2f55" : "#ffd7a8"; ctx.fillRect(0, ground, W, H - ground);
    ctx.fillStyle = d ? "#000" : "#1f1a2e"; ctx.fillRect(0, ground, W, 2.5);
    ctx.fillStyle = d ? "rgba(255,255,255,.07)" : "rgba(31,26,46,.08)";
    const off = (distance * 1) % 40;
    for (let x = -off; x < W; x += 40) ctx.fillRect(x, ground + 12, 22, 4);
    for (let x = -((distance * 0.6) % 70); x < W; x += 70) ctx.fillRect(x + 30, ground + 28, 14, 4);
    // goodies + hazards
    for (const g of goodies) emoji(g.e, g.x, g.y + Math.sin(t * 5 + g.x * 0.05) * 4, 30);
    for (const o of hazards) emoji(o.e, o.x + o.w / 2, ground - o.h / 2 + 2, Math.max(o.w, o.h) + 4);
    drawPlayer();
    // pops
    ctx.font = '700 18px "Fredoka", system-ui, sans-serif'; ctx.textAlign = "center";
    for (const p of pops) { ctx.globalAlpha = Math.max(0, p.life / 0.7); ctx.fillStyle = "#1f1a2e"; ctx.fillText(p.text, p.x, p.y); }
    ctx.globalAlpha = 1;
    // overlays
    if (state !== "running") {
      ctx.fillStyle = d ? "#fff3e4" : "#1f1a2e"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = '700 22px "Fredoka", system-ui, sans-serif';
      const msg = state === "idle" ? "Tap or press Space to play!" : `Ouch! Score ${score}`;
      ctx.fillText(msg, W / 2, H * 0.36);
      ctx.font = '500 15px "Outfit", system-ui, sans-serif';
      ctx.fillText(state === "idle" ? "Jump the flames & knives · grab ingredients" : "Tap or press Space to try again", W / 2, H * 0.36 + 28);
    }
  }

  function frame(now) {
    if (!canvas.isConnected) { cleanup(); return; }
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    update(dt);
    draw();
    raf = requestAnimationFrame(frame);
  }

  // ---- input --------------------------------------------------------------------
  const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "") || document.activeElement?.isContentEditable;
  function onKeyDown(e) {
    if (typing() || e.repeat) return;
    if (e.code === "Space" || e.key === "ArrowUp" || e.key === "w") { e.preventDefault(); jumpStart(); }
  }
  function onKeyUp(e) { if (e.code === "Space" || e.key === "ArrowUp" || e.key === "w") jumpEnd(); }
  canvas.addEventListener("pointerdown", (e) => { e.preventDefault(); canvas.focus({ preventScroll: true }); jumpStart(); });
  canvas.addEventListener("pointerup", jumpEnd);
  canvas.addEventListener("pointercancel", jumpEnd);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  let raf = 0;
  function cleanup() {
    cancelAnimationFrame(raf);
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("keyup", onKeyUp);
    ro.disconnect();
  }

  requestAnimationFrame(() => { resize(); raf = requestAnimationFrame(frame); });

  return {
    el,
    readySlot,
    isPlaying: () => state === "running",
    state: () => state,
    stop: cleanup,
    // test hook
    _debug: { jumpStart, get score() { return score; }, get state() { return state; } },
  };
}
