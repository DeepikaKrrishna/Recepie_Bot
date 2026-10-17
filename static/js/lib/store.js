// App state + tiny pub/sub. The server is authoritative; this is a session cache.
import { api, setCsrf } from "./api.js";

const listeners = new Set();

export const state = {
  user: null,     // { email, display_name, stats }
  options: null,  // /api/options
  results: null,  // { request, data, promise }
  draft: { ingredients: [], exclude: [], dish: "", mood: null, diets: [], cuisine: "Any", time: "", difficulty: "", servings: 2, spice: "" },
};

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(what) { for (const fn of listeners) fn(what); }

export function setSession(me) {
  state.user = me?.user || null;
  setCsrf(me?.csrf_token || null);
  if (!state.user) state.results = null;
  emit("session");
}

export async function refreshSession() {
  try { setSession(await api("/api/auth/me")); } catch { setSession(null); }
  return state.user;
}

export async function loadOptions() {
  if (!state.options) state.options = await api("/api/options");
  return state.options;
}

export function bestScore() {
  let local = 0;
  try { local = Number(localStorage.getItem("rb-best") || 0); } catch { /* storage blocked */ }
  return Math.max(local, state.user?.stats?.best_game_score || 0);
}

export function saveBest(score) {
  try { if (score > Number(localStorage.getItem("rb-best") || 0)) localStorage.setItem("rb-best", String(score)); } catch { /* ignore */ }
  if (state.user && score > (state.user.stats?.best_game_score || 0)) {
    state.user.stats.best_game_score = score;
    api("/api/account/game-score", { method: "POST", body: { score } }).catch(() => {});
    return true;
  }
  return false;
}
