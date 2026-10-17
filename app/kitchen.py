"""Ingredient name normalisation and matching. Pure functions, no I/O."""

from __future__ import annotations

import re
from collections.abc import Iterable

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
