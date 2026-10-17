// Formatting helpers.

const FRACTIONS = [[0, ""], [0.125, "⅛"], [0.25, "¼"], [1 / 3, "⅓"], [0.5, "½"], [2 / 3, "⅔"], [0.75, "¾"], [1, ""]];

export function formatQty(q) {
  if (q === null || q === undefined || Number.isNaN(q)) return "";
  if (q >= 20) return String(Math.round(q));
  if (q >= 10) return String(Math.round(q * 2) / 2);
  const whole = Math.floor(q);
  const frac = q - whole;
  for (const [value, glyph] of FRACTIONS) {
    if (Math.abs(frac - value) < 0.04) {
      const w = whole + (value === 1 ? 1 : 0);
      if (!glyph) return String(w || (q > 0 ? "<⅛" : "0"));
      return (w ? `${w} ` : "") + glyph;
    }
  }
  return String(Math.round(q * 10) / 10);
}

export function minutes(m) {
  if (m == null) return "";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
export const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** Local calendar date as YYYY-MM-DD (not UTC). */
export function isoDate(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISO(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

export function mondayOf(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const wd = (x.getDay() + 6) % 7;
  return addDays(x, -wd);
}

export function dayName(d, style = "short") { return d.toLocaleDateString(undefined, { weekday: style }); }
export function shortDate(d) { return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }); }

export function daysLeftLabel(days) {
  if (days == null) return "";
  if (days < 0) return days === -1 ? "expired yesterday" : `expired ${-days} days ago`;
  if (days === 0) return "use today";
  if (days === 1) return "use tomorrow";
  return `${days} days left`;
}

export function money(amount, currency) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount); }
  catch { return `${currency} ${Math.round(amount)}`; }
}

/** Parse "2 kg rice" / "500g paneer" / "6 eggs" into parts. */
export function parseQuick(text) {
  const t = text.trim();
  const m = /^(\d+(?:[.,]\d+)?|½|¼|¾)\s*(kg|g|gm|gms|grams?|l|ml|litres?|liters?|cups?|tbsp|tsp|pcs|pieces?|packets?|bunch(?:es)?|dozen)?\.?\s+(.+)$/i.exec(t);
  if (!m) return { name: t, quantity: null, unit: "" };
  const map = { "½": 0.5, "¼": 0.25, "¾": 0.75 };
  const q = map[m[1]] ?? parseFloat(m[1].replace(",", "."));
  return { name: m[3].trim(), quantity: Number.isFinite(q) ? q : null, unit: (m[2] || "").toLowerCase() };
}
