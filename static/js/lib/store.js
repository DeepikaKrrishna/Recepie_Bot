// App state + tiny pub/sub. Server data stays authoritative; this is a session cache.
import { api, setCsrf } from "./api.js";

const listeners = new Set();

export const state = {
  user: null,          // { email, display_name, stats }
  prefs: null,         // saved preferences when signed in
  options: null,       // /api/options
  results: null,       // { request, data } from the last generation
  draft: { ingredients: [], exclude: [], dish: "", mood: null, diets: null, cuisine: null, time: "", difficulty: "", servings: null, budget: "", spice: "" },
  pantry: null,        // cached pantry list (signed in)
  shoppingCount: 0,
  online: navigator.onLine,
};

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(what) { for (const fn of listeners) fn(what); }

export function setSession(me) {
  state.user = me?.user || null;
  state.prefs = me?.preferences || null;
  setCsrf(me?.csrf_token || null);
  if (!state.user) { state.pantry = null; state.shoppingCount = 0; }
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

export async function loadPantry(force = false) {
  if (!state.user) return null;
  if (state.pantry && !force) return state.pantry;
  try { state.pantry = await api(`/api/pantry?today=${localToday()}`); } catch { state.pantry = null; }
  emit("pantry");
  return state.pantry;
}

export async function loadShoppingCount() {
  if (!state.user) return;
  try {
    const items = await api("/api/shopping");
    state.shoppingCount = items.filter((i) => !i.checked).length;
    emit("shopping");
  } catch { /* badge is optional */ }
}

export function pantryNames() {
  return (state.pantry?.items || []).map((i) => i.name);
}

export function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
