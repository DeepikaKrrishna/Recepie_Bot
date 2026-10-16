"""Ingredient utilities: name normalisation, pantry matching, aisle categories and
quantity consolidation for shopping lists. Pure functions, no I/O."""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass

DESCRIPTORS = {
    "fresh",
    "freshly",
    "chopped",
    "finely",
    "roughly",
    "diced",
    "sliced",
    "minced",
    "grated",
    "crushed",
    "large",
    "medium",
    "small",
    "big",
    "ripe",
    "raw",
    "cooked",
    "boiled",
    "peeled",
    "whole",
    "ground",
    "dried",
    "dry",
    "frozen",
    "organic",
    "boneless",
    "skinless",
    "thinly",
    "thick",
    "optional",
    "to",
    "taste",
    "a",
    "few",
    "some",
    "of",
    "for",
    "garnish",
    "and",
    "or",
    "cut",
    "into",
    "pieces",
    "piece",
    "inch",
}

# Irregular plurals and Indian/English synonyms that should match each other.
ALIASES = {
    "leaves": "leaf",
    "tomatoes": "tomato",
    "potatoes": "potato",
    "chillies": "chilli",
    "chilies": "chilli",
    "chili": "chilli",
    "chile": "chilli",
    "dahi": "curd",
    "yoghurt": "yogurt",
    "capsicum": "bell pepper",
    "coriander": "coriander",
    "cilantro": "coriander",
    "dhania": "coriander",
    "jeera": "cumin",
    "haldi": "turmeric",
    "pyaz": "onion",
    "aloo": "potato",
    "palak": "spinach",
    "methi": "fenugreek",
    "atta": "wheat flour",
    "maida": "all-purpose flour",
    "besan": "gram flour",
    "sooji": "semolina",
    "suji": "semolina",
    "rava": "semolina",
    "brinjal": "eggplant",
    "aubergine": "eggplant",
    "bhindi": "okra",
    "ladyfinger": "okra",
    "prawns": "prawn",
    "shrimps": "shrimp",
    "eggs": "egg",
}


def singular(word: str) -> str:
    if word in ALIASES:
        return ALIASES[word]
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 4 and word.endswith("oes"):
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith(("ss", "us", "is")):
        return word[:-1]
    return word


def normalize_name(name: str) -> str:
    text = re.sub(r"\(.*?\)", " ", name.lower())
    text = re.sub(r"[^a-z\s-]", " ", text)
    words = [singular(w) for w in text.split() if w not in DESCRIPTORS]
    joined = " ".join(words).strip()
    return ALIASES.get(joined, joined)


def matches(a: str, b: str) -> bool:
    """True when two ingredient names refer to the same thing (loosely)."""
    na, nb = normalize_name(a), normalize_name(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    # The head noun comes last in English names: "basmati rice" is rice, "rice flour" is not.
    short, long_ = sorted((na, nb), key=len)
    return len(short) >= 3 and long_.endswith(" " + short)


def find_match(name: str, candidates: Iterable[str]) -> str | None:
    for c in candidates:
        if matches(name, c):
            return c
    return None


# ---- aisle categories ------------------------------------------------------------------

CATEGORIES: list[tuple[str, list[str]]] = [
    (
        "Meat & Seafood",
        [
            "chicken",
            "mutton",
            "lamb",
            "beef",
            "pork",
            "fish",
            "prawn",
            "shrimp",
            "crab",
            "salmon",
            "tuna",
            "keema",
            "bacon",
            "sausage",
        ],
    ),
    ("Dairy & Eggs", ["egg", "milk", "curd", "yogurt", "paneer", "cheese", "butter", "ghee", "cream", "khoa", "buttermilk"]),
    (
        "Grains & Pulses",
        [
            "rice",
            "dal",
            "lentil",
            "chana",
            "rajma",
            "flour",
            "semolina",
            "poha",
            "oat",
            "millet",
            "quinoa",
            "pasta",
            "noodle",
            "bean",
            "chickpea",
            "moong",
            "toor",
            "urad",
            "masoor",
            "vermicelli",
        ],
    ),
    (
        "Spices & Herbs",
        [
            "cumin",
            "turmeric",
            "chilli powder",
            "garam masala",
            "masala",
            "coriander powder",
            "mustard seed",
            "fenugreek seed",
            "pepper",
            "cardamom",
            "clove",
            "cinnamon",
            "bay leaf",
            "asafoetida",
            "hing",
            "curry leaf",
            "saffron",
            "salt",
            "spice",
            "seed",
            "oregano",
            "basil",
            "thyme",
            "mint",
            "dill",
            "parsley",
        ],
    ),
    (
        "Oils & Sauces",
        [
            "oil",
            "sauce",
            "vinegar",
            "ketchup",
            "tamarind",
            "jaggery",
            "sugar",
            "honey",
            "paste",
            "stock",
            "broth",
            "syrup",
            "mayonnaise",
        ],
    ),
    ("Bakery", ["bread", "bun", "pav", "tortilla", "pita", "roti", "naan"]),
    (
        "Produce",
        [
            "onion",
            "tomato",
            "potato",
            "garlic",
            "ginger",
            "chilli",
            "coriander",
            "spinach",
            "carrot",
            "cabbage",
            "cauliflower",
            "pea",
            "okra",
            "eggplant",
            "lemon",
            "lime",
            "coconut",
            "bell pepper",
            "cucumber",
            "beetroot",
            "radish",
            "mushroom",
            "banana",
            "apple",
            "mango",
            "avocado",
            "lettuce",
            "gourd",
            "pumpkin",
            "corn",
            "broccoli",
            "fenugreek",
            "leaf",
            "spring onion",
            "drumstick",
        ],
    ),
]
CATEGORY_NAMES = [c for c, _ in CATEGORIES] + ["Other"]


def categorize(name: str) -> str:
    n = normalize_name(name) or name.lower()
    for category, words in CATEGORIES:
        for w in words:
            if re.search(rf"(?<![a-z]){re.escape(w)}", n):
                return category
    return "Other"


# ---- quantities ----------------------------------------------------------------------------

UNIT_ALIASES = {
    "tablespoon": "tbsp",
    "tablespoons": "tbsp",
    "tbs": "tbsp",
    "tbsps": "tbsp",
    "teaspoon": "tsp",
    "teaspoons": "tsp",
    "tsps": "tsp",
    "cups": "cup",
    "grams": "g",
    "gram": "g",
    "gm": "g",
    "gms": "g",
    "kilogram": "kg",
    "kilograms": "kg",
    "kgs": "kg",
    "litre": "l",
    "liter": "l",
    "litres": "l",
    "liters": "l",
    "millilitre": "ml",
    "milliliter": "ml",
    "millilitres": "ml",
    "milliliters": "ml",
    "pieces": "piece",
    "pcs": "piece",
    "cloves": "clove",
    "leaves": "leaf",
    "pinches": "pinch",
    "sprigs": "sprig",
    "nos": "piece",
    "no": "piece",
}
CONVERT = {"kg": ("g", 1000.0), "l": ("ml", 1000.0)}


def normalize_unit(unit: str | None) -> str:
    u = (unit or "").strip().lower().rstrip(".")
    return UNIT_ALIASES.get(u, u)


@dataclass
class Line:
    name: str
    quantity: float | None
    unit: str
    sources: list[str]


def consolidate(items: Iterable[tuple[str, float | None, str | None, str]]) -> list[Line]:
    """Merge (name, quantity, unit, source) rows with the same ingredient and unit."""
    merged: dict[tuple[str, str], Line] = {}
    for name, qty, unit, source in items:
        u = normalize_unit(unit)
        if u in CONVERT and qty is not None:
            u, factor = CONVERT[u]
            qty = qty * factor
        key = (normalize_name(name) or name.lower(), u)
        line = merged.get(key)
        if line is None:
            # Display the unit as written ("leaves"), but merge on the normalised form ("leaf").
            shown = u if u in ("g", "ml", "kg", "l") else (unit or "").strip().lower()
            merged[key] = Line(name=name.strip(), quantity=qty, unit=shown, sources=[source] if source else [])
        else:
            line.quantity = None if (line.quantity is None or qty is None) else line.quantity + qty
            if source and source not in line.sources:
                line.sources.append(source)
    for line in merged.values():
        if line.quantity is not None:
            if normalize_unit(line.unit) == "g" and line.quantity >= 1000:
                line.quantity, line.unit = line.quantity / 1000, "kg"
            elif normalize_unit(line.unit) == "ml" and line.quantity >= 1000:
                line.quantity, line.unit = line.quantity / 1000, "l"
            line.quantity = round(line.quantity, 2)
    return list(merged.values())
