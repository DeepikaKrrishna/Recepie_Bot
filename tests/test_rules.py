"""Keyword safety rules (diet conflicts, exclusions, allergen hints)."""

from __future__ import annotations

import pytest

from app.recipes import DIET_HARD_RULES, find_terms


@pytest.mark.parametrize(
    "text, terms, expected",
    [
        ("2 eggs, beaten", ["egg"], ["egg"]),
        ("1 eggplant", ["egg"], []),
        ("coconut milk", DIET_HARD_RULES["vegan"], []),
        ("peanut butter", ["butter"], []),
        ("butter", ["butter"], ["butter"]),
        ("nutmeg, coconut", ["nut"], []),
        ("chicken stock", DIET_HARD_RULES["vegetarian"], ["chicken", "chicken stock"]),
        ("vegetable stock", DIET_HARD_RULES["vegetarian"], []),
        ("Tomatoes", ["tomato"], ["tomato"]),
        ("graham crackers", ["ham"], []),
        ("onion, garlic", DIET_HARD_RULES["jain"], ["garlic", "onion"]),
        ("gluten-free pasta", ["pasta"], []),
        ("rava, ghee", DIET_HARD_RULES["gluten-free"], ["rava"]),
    ],
)
def test_find_terms(text, terms, expected):
    assert find_terms(text, terms) == sorted(expected)
