// Food helpers: ingredient → emoji, generative "plate" art, moods and staples.
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

// Placemat colours (bright, juicy) per cuisine family; [mat, sauce].
const MATS = {
  "South Indian": ["#ffe08a", "#ff9f1c"], "North Indian": ["#ffc2a8", "#ff6b35"], "Kerala": ["#bff0d8", "#2ec4b6"],
  "Chettinad": ["#ffb8a3", "#e84a2f"], "Bengali": ["#ffe9a3", "#f2b300"], "Gujarati": ["#fff3a3", "#f4c20d"],
  "Maharashtrian": ["#ffcfa3", "#ff7a3d"], "Hyderabadi": ["#e4d4ff", "#9b7bff"], "Punjabi": ["#ffc6b3", "#ff5a3d"],
  "Indo-Chinese": ["#ffc4cf", "#ff3d6e"], "Italian": ["#c9f2c9", "#4fc46a"], "Mexican": ["#ffd1a6", "#ff7a3d"],
  "Chinese": ["#ffc4c4", "#ff4d4d"], "Thai": ["#c4f2df", "#2ec48f"], "Japanese": ["#ffd6e5", "#ff5a7e"],
  "Mediterranean": ["#c8e6ff", "#3d9bff"], "Middle Eastern": ["#ffe3b8", "#e09a2b"], "American": ["#cfe0ff", "#5a7dff"],
  "French": ["#e6dcff", "#8b6bff"], "Korean": ["#ffcfd6", "#ff4a68"],
};
const FALLBACK = [["#ffe08a", "#ff9f1c"], ["#bff0d8", "#2ec4b6"], ["#ffc2a8", "#ff6b35"], ["#c8e6ff", "#3d9bff"], ["#e4d4ff", "#9b7bff"], ["#ffc4cf", "#ff3d6e"]];

function hash(str) {
  let x = 2166136261;
  for (const ch of String(str)) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619); }
  return x >>> 0;
}

export function matColors(recipe) {
  return MATS[recipe?.cuisine] || FALLBACK[hash(recipe?.title || "") % FALLBACK.length];
}

/** Deterministic plate illustration: the dish's emoji in the middle, its ingredients around it. */
export function plateArt(recipe, { size = 200, label = true } = {}) {
  const [, sauce] = matColors(recipe);
  const seed = hash(recipe?.title || "x");
  const skip = /salt|water|oil|sugar|to taste/i;
  const ring = [];
  for (const ing of recipe?.ingredients || []) {
    if (skip.test(ing.name)) continue;
    const e = emojiFor(ing.name);
    if (e !== "🥄" && !ring.includes(e) && e !== recipe?.hero_emoji) ring.push(e);
    if (ring.length === 6) break;
  }
  const hero = recipe?.hero_emoji || (ring.length ? null : "🍲");
  const items = [];
  const n = ring.length;
  ring.forEach((e, i) => {
    const angle = (i / n) * Math.PI * 2 + (seed % 360) * (Math.PI / 180);
    const r = hero ? 48 : n === 1 ? 0 : 32 + ((seed >> (i * 3)) % 9);
    const fs = hero ? 22 : n === 1 ? 56 : 27 + ((seed >> i) % 8);
    const x = (100 + Math.cos(angle) * r).toFixed(1), y = (100 + Math.sin(angle) * r).toFixed(1);
    items.push(s("text", { x, y, "font-size": fs, transform: `rotate(${((seed >> (i + 2)) % 50) - 25} ${x} ${y})` }, e));
  });
  if (hero) items.push(s("text", { x: 100, y: 102, "font-size": 62 }, hero));
  const blob = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const rr = 44 + ((seed >> i) % 12);
    blob.push(`${(100 + Math.cos(a) * rr).toFixed(1)},${(100 + Math.sin(a) * rr).toFixed(1)}`);
  }
  return s("svg", { class: "plate", viewBox: "0 0 200 200", width: size, height: size, role: label ? "img" : null,
    "aria-label": label ? `Illustration of ${recipe?.title || "a dish"}` : null, "aria-hidden": label ? null : "true" },
    s("circle", { cx: 106, cy: 106, r: 90, fill: "#1f1a2e" }),
    s("circle", { class: "rim", cx: 100, cy: 100, r: 90 }),
    s("circle", { class: "rim-line", cx: 100, cy: 100, r: 78 }),
    s("circle", { class: "well", cx: 100, cy: 100, r: 68 }),
    s("polygon", { class: "sauce", points: blob.join(" "), fill: sauce }),
    items);
}

export const MOODS = [
  ["quick weeknight", "⚡", "Quick weeknight"], ["tiffin box", "🍱", "Tiffin box"], ["comfort food", "🫕", "Comfort food"],
  ["rainy-day snack", "🌧️", "Rainy-day snack"], ["light & healthy", "🥗", "Light & healthy"], ["one-pot", "🍲", "One-pot"],
  ["kid-friendly", "🧒", "Kid-friendly"], ["festive", "🪔", "Festive"], ["party starter", "🎉", "Party starter"], ["date night", "🕯️", "Date night"],
];

export const STAPLES = ["onion", "tomato", "rice", "potato", "paneer", "eggs", "curd", "chicken", "spinach", "toor dal",
  "atta", "bread", "pasta", "cheese", "lemon", "capsicum", "carrot", "mushroom", "besan", "poha", "coconut", "garlic"];
