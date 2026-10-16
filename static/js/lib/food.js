// Food helpers: ingredient → emoji, generative "plate" art, pantry matching
// (mirrors app/kitchen.py so the UI and server agree on what you "have").
import { s } from "./dom.js";

const EMOJI = [
  ["tomato", "🍅"], ["onion", "🧅"], ["garlic", "🧄"], ["chilli", "🌶️"], ["chili", "🌶️"], ["pepper", "🫑"], ["capsicum", "🫑"],
  ["potato", "🥔"], ["aloo", "🥔"], ["carrot", "🥕"], ["corn", "🌽"], ["broccoli", "🥦"], ["cucumber", "🥒"], ["eggplant", "🍆"],
  ["brinjal", "🍆"], ["mushroom", "🍄"], ["spinach", "🥬"], ["palak", "🥬"], ["lettuce", "🥬"], ["cabbage", "🥬"], ["leaf", "🌿"],
  ["leaves", "🌿"], ["coriander", "🌿"], ["mint", "🌿"], ["basil", "🌿"], ["herb", "🌿"], ["pea", "🫛"], ["bean", "🫘"],
  ["dal", "🫘"], ["lentil", "🫘"], ["chana", "🫘"], ["rajma", "🫘"], ["chickpea", "🫘"], ["rice", "🍚"], ["poha", "🍚"],
  ["noodle", "🍜"], ["pasta", "🍝"], ["spaghetti", "🍝"], ["bread", "🍞"], ["pav", "🍞"], ["roti", "🫓"], ["tortilla", "🫓"],
  ["naan", "🫓"], ["flour", "🌾"], ["atta", "🌾"], ["maida", "🌾"], ["rava", "🌾"], ["semolina", "🌾"], ["oat", "🌾"], ["millet", "🌾"],
  ["egg", "🥚"], ["milk", "🥛"], ["curd", "🥛"], ["yogurt", "🥛"], ["dahi", "🥛"], ["cream", "🥛"], ["paneer", "🧀"], ["cheese", "🧀"],
  ["butter", "🧈"], ["ghee", "🧈"], ["chicken", "🍗"], ["mutton", "🍖"], ["lamb", "🍖"], ["beef", "🥩"], ["pork", "🥓"], ["bacon", "🥓"],
  ["fish", "🐟"], ["salmon", "🐟"], ["prawn", "🦐"], ["shrimp", "🦐"], ["crab", "🦀"], ["lemon", "🍋"], ["lime", "🍋"],
  ["coconut", "🥥"], ["mango", "🥭"], ["banana", "🍌"], ["apple", "🍎"], ["avocado", "🥑"], ["pineapple", "🍍"], ["grape", "🍇"],
  ["ginger", "🫚"], ["olive", "🫒"], ["oil", "🫒"], ["salt", "🧂"], ["sugar", "🍬"], ["jaggery", "🍯"], ["honey", "🍯"],
  ["peanut", "🥜"], ["cashew", "🥜"], ["almond", "🥜"], ["nut", "🥜"], ["tofu", "🧊"], ["water", "💧"], ["stock", "🍲"],
  ["broth", "🍲"], ["sauce", "🥫"], ["ketchup", "🥫"], ["tamarind", "🟤"], ["cumin", "🟤"], ["mustard", "🟡"], ["turmeric", "🟡"],
  ["masala", "🟠"], ["cinnamon", "🪵"], ["chocolate", "🍫"], ["cocoa", "🍫"], ["wine", "🍷"],
];

export function emojiFor(name) {
  const n = String(name || "").toLowerCase();
  for (const [word, e] of EMOJI) if (n.includes(word)) return e;
  return "🥄";
}

// Placemat colours per cuisine family.
const MATS = {
  "South Indian": ["#fde7b3", "#e9a23b"], "North Indian": ["#fbd5c4", "#d9572c"], "Kerala": ["#d9efd7", "#4d9a5e"],
  "Chettinad": ["#f6cdb8", "#b5442a"], "Bengali": ["#fbe3a8", "#c98b12"], "Gujarati": ["#fff0b8", "#d6a21d"],
  "Maharashtrian": ["#ffd9bf", "#d8662b"], "Hyderabadi": ["#ead7f0", "#8e4f9c"], "Punjabi": ["#ffd7c7", "#cf4a2a"],
  "Indo-Chinese": ["#ffd6d0", "#c7352b"], "Italian": ["#d8ecd6", "#3f8a4d"], "Mexican": ["#ffdcc2", "#d55c27"],
  "Chinese": ["#ffd5d0", "#c22f26"], "Thai": ["#d7f0e1", "#2e8b5c"], "Japanese": ["#f1e0e6", "#a9466b"],
  "Mediterranean": ["#d7e8f1", "#2f6f8f"], "Middle Eastern": ["#f6e3c4", "#b5782b"], "American": ["#d9e3f3", "#3e5ea8"],
  "French": ["#e3def3", "#5b4d9e"], "Korean": ["#ffd9d4", "#c8412f"],
};
const FALLBACK = [["#fde7b3", "#e9a23b"], ["#d9efd7", "#4d9a5e"], ["#fbd5c4", "#d9572c"], ["#d7e8f1", "#2f6f8f"], ["#ead7f0", "#8e4f9c"]];

function hash(str) {
  let x = 2166136261;
  for (const ch of String(str)) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619); }
  return x >>> 0;
}

export function matColors(recipe) {
  return MATS[recipe?.cuisine] || FALLBACK[hash(recipe?.title || "") % FALLBACK.length];
}

/** Deterministic plate illustration built from the recipe's main ingredients. */
export function plateArt(recipe, { size = 200, label = true } = {}) {
  const [, sauce] = matColors(recipe);
  const seed = hash(recipe?.title || "x");
  const skip = /salt|water|oil|sugar|to taste/i;
  const picks = [];
  for (const ing of recipe?.ingredients || []) {
    if (skip.test(ing.name)) continue;
    const e = emojiFor(ing.name);
    if (e !== "🥄" && !picks.includes(e)) picks.push(e);
    if (picks.length === 6) break;
  }
  if (!picks.length) picks.push("🍲");
  const items = [];
  const n = picks.length;
  picks.forEach((e, i) => {
    const angle = (i / n) * Math.PI * 2 + (seed % 360) * (Math.PI / 180);
    const r = n === 1 ? 0 : 30 + ((seed >> (i * 3)) % 9);
    const fs = n === 1 ? 54 : 26 + ((seed >> i) % 8);
    items.push(s("text", { x: (100 + Math.cos(angle) * r).toFixed(1), y: (100 + Math.sin(angle) * r).toFixed(1), "font-size": fs,
      transform: `rotate(${((seed >> (i + 2)) % 50) - 25} ${(100 + Math.cos(angle) * r).toFixed(1)} ${(100 + Math.sin(angle) * r).toFixed(1)})` }, e));
  });
  const blob = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const rr = 44 + ((seed >> i) % 12);
    blob.push(`${(100 + Math.cos(a) * rr).toFixed(1)},${(100 + Math.sin(a) * rr).toFixed(1)}`);
  }
  return s("svg", { class: "plate", viewBox: "0 0 200 200", width: size, height: size, role: label ? "img" : null,
    "aria-label": label ? `Illustration of ${recipe?.title || "a dish"}` : null, "aria-hidden": label ? null : "true" },
    s("circle", { cx: 100, cy: 104, r: 92, fill: "rgba(60,25,5,.16)" }),
    s("circle", { class: "rim", cx: 100, cy: 100, r: 92 }),
    s("circle", { class: "rim-line", cx: 100, cy: 100, r: 80 }),
    s("circle", { class: "well", cx: 100, cy: 100, r: 70 }),
    s("polygon", { class: "sauce", points: blob.join(" "), fill: sauce }),
    items);
}

// ---- pantry matching (mirror of app/kitchen.py) ----------------------------------------------
const DESCRIPTORS = new Set("fresh freshly chopped finely roughly diced sliced minced grated crushed large medium small big ripe raw cooked boiled peeled whole ground dried dry frozen organic boneless skinless thinly thick optional to taste a few some of for garnish and or cut into pieces piece inch".split(" "));
const ALIASES = { leaves: "leaf", tomatoes: "tomato", potatoes: "potato", chillies: "chilli", chilies: "chilli", chili: "chilli", chile: "chilli",
  dahi: "curd", yoghurt: "yogurt", capsicum: "bell pepper", cilantro: "coriander", dhania: "coriander", jeera: "cumin", haldi: "turmeric",
  pyaz: "onion", aloo: "potato", palak: "spinach", methi: "fenugreek", atta: "wheat flour", maida: "all-purpose flour", besan: "gram flour",
  sooji: "semolina", suji: "semolina", rava: "semolina", brinjal: "eggplant", aubergine: "eggplant", bhindi: "okra", ladyfinger: "okra",
  prawns: "prawn", shrimps: "shrimp", eggs: "egg" };

function singular(w) {
  if (ALIASES[w]) return ALIASES[w];
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("oes")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

export function normalizeName(name) {
  const text = String(name).toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z\s-]/g, " ");
  const joined = text.split(/\s+/).filter((w) => w && !DESCRIPTORS.has(w)).map(singular).join(" ").trim();
  return ALIASES[joined] || joined;
}

export function sameIngredient(a, b) {
  const na = normalizeName(a), nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  return short.length >= 3 && long.endsWith(" " + short);
}

/** Which of a recipe's ingredients are already in the pantry. */
export function pantryCoverage(recipe, pantryNames) {
  const have = [], missing = [];
  for (const ing of recipe.ingredients || []) {
    if (/^(salt|water)$/i.test(ing.name.trim())) { have.push(ing); continue; }
    (pantryNames.some((p) => sameIngredient(ing.name, p)) ? have : missing).push(ing);
  }
  return { have, missing, pct: recipe.ingredients?.length ? Math.round((have.length / recipe.ingredients.length) * 100) : 0 };
}

export const MOODS = [
  ["quick weeknight", "⚡", "Quick weeknight"], ["tiffin box", "🍱", "Tiffin box"], ["comfort food", "🫕", "Comfort food"],
  ["rainy-day snack", "🌧️", "Rainy-day snack"], ["light & healthy", "🥗", "Light & healthy"], ["one-pot", "🍲", "One-pot"],
  ["kid-friendly", "🧒", "Kid-friendly"], ["festive", "🪔", "Festive"], ["party starter", "🎉", "Party starter"], ["date night", "🕯️", "Date night"],
];

export const STAPLES = ["onion", "tomato", "rice", "potato", "paneer", "eggs", "curd", "toor dal", "spinach", "chicken", "atta", "coconut", "lemon", "capsicum", "besan", "poha"];
