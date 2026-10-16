"""Run the full app locally against a FAKE AI provider (no API key, no network).

Useful for UI work and demos. Every recipe it returns is canned sample data,
picked to overlap with the ingredients you enter.

    python scripts/run_mock_server.py   # http://127.0.0.1:8000
"""

from __future__ import annotations

import dataclasses
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import httpx  # noqa: E402
import uvicorn  # noqa: E402

from app.config import load_settings  # noqa: E402
from app.main import create_app  # noqa: E402
from tests.fakes import LEMON_RICE, TOMATO_RASAM, FakeOpenRouter, completion  # noqa: E402


def r(title, desc, cuisine, tags, prep, cook, diff, ings, steps, allergens, cost, kcal, tips=()):
    return {
        "title": title,
        "description": desc,
        "cuisine": cuisine,
        "diet_tags": list(tags),
        "prep_minutes": prep,
        "cook_minutes": cook,
        "servings": 2,
        "difficulty": diff,
        "ingredients": [{"name": n, "quantity": q, "unit": u, **({"note": note} if note else {})} for n, q, u, note in ings],
        "steps": steps,
        "allergens": list(allergens),
        "estimated_cost": {"amount": cost, "currency": "INR"},
        "nutrition_per_serving": {"calories": kcal},
        "tips": list(tips),
    }


LIBRARY = [
    LEMON_RICE,
    TOMATO_RASAM,
    r(
        "Palak Paneer",
        "Silky spinach gravy with soft cubes of paneer: a North Indian classic.",
        "North Indian",
        ["vegetarian", "gluten-free"],
        15,
        20,
        "medium",
        [
            ("spinach", 250, "g", "washed"),
            ("paneer", 200, "g", "cubed"),
            ("onion", 1, "medium", "chopped"),
            ("tomato", 1, "medium", None),
            ("garlic", 3, "cloves", None),
            ("ginger", 1, "inch", None),
            ("green chilli", 1, "", None),
            ("cumin", 1, "tsp", None),
            ("garam masala", 0.5, "tsp", None),
            ("cream", 2, "tbsp", "optional"),
            ("oil", 1, "tbsp", None),
            ("salt", None, "", "to taste"),
        ],
        [
            "Blanch the spinach for 2 minutes, plunge into cold water, then blend smooth with the green chilli.",
            "Heat oil, add cumin, then sauté onion, garlic and ginger for 5 minutes until golden.",
            "Add the tomato and cook for 4 minutes until soft.",
            "Stir in the spinach purée, salt and garam masala and simmer for 5 minutes.",
            "Fold in the paneer and cream and simmer for 2 minutes. Serve hot with roti.",
        ],
        ["milk/dairy"],
        180,
        360,
        ["Cold water after blanching keeps the spinach bright green."],
    ),
    r(
        "Masala Omelette",
        "A fluffy, spiced Indian-style omelette loaded with onion, tomato and chilli.",
        "North Indian",
        ["eggetarian", "high-protein"],
        5,
        5,
        "easy",
        [
            ("eggs", 3, "", None),
            ("onion", 0.5, "small", "finely chopped"),
            ("tomato", 0.5, "small", "chopped"),
            ("green chilli", 1, "", "chopped"),
            ("coriander leaves", 2, "tbsp", None),
            ("turmeric", 0.25, "tsp", None),
            ("butter", 1, "tsp", None),
            ("salt", None, "", "to taste"),
        ],
        [
            "Whisk the eggs with turmeric and salt until frothy.",
            "Stir in onion, tomato, chilli and coriander.",
            "Melt butter in a pan on medium heat and pour in the eggs.",
            "Cook for 2 minutes, fold, and cook 1 more minute. Serve with toast.",
        ],
        ["egg", "milk/dairy"],
        50,
        280,
    ),
    r(
        "Vegetable Upma",
        "Comforting South Indian semolina breakfast with crunchy vegetables and curry leaves.",
        "South Indian",
        ["vegetarian", "vegan"],
        10,
        15,
        "easy",
        [
            ("rava", 1, "cup", "roasted"),
            ("onion", 1, "small", None),
            ("carrot", 1, "small", "diced"),
            ("peas", 0.25, "cup", None),
            ("mustard seeds", 1, "tsp", None),
            ("curry leaves", 8, "leaves", None),
            ("ginger", 1, "tsp", "grated"),
            ("green chilli", 1, "", None),
            ("water", 2.5, "cups", "hot"),
            ("oil", 2, "tbsp", None),
            ("salt", None, "", "to taste"),
        ],
        [
            "Dry-roast the rava for 4 minutes until fragrant and set aside.",
            "Heat oil, splutter mustard seeds, then add curry leaves, ginger and chilli.",
            "Add onion, carrot and peas and cook for 5 minutes.",
            "Pour in hot water with salt and bring to a boil.",
            "Stream in the rava while stirring, cover and cook on low for 3 minutes.",
        ],
        ["wheat/gluten", "mustard"],
        60,
        300,
        ["Stir constantly while adding rava to avoid lumps."],
    ),
    r(
        "Chana Masala",
        "Hearty Punjabi chickpea curry with a tangy, spiced tomato-onion masala.",
        "Punjabi",
        ["vegan", "gluten-free", "high-protein"],
        10,
        30,
        "medium",
        [
            ("chickpeas", 2, "cups", "boiled"),
            ("onion", 2, "medium", None),
            ("tomato", 2, "medium", None),
            ("ginger garlic paste", 1, "tbsp", None),
            ("chana masala", 2, "tsp", None),
            ("chilli powder", 1, "tsp", None),
            ("oil", 2, "tbsp", None),
            ("coriander leaves", 2, "tbsp", None),
            ("salt", None, "", "to taste"),
        ],
        [
            "Heat oil and fry the onions for 8 minutes until deep golden.",
            "Add ginger garlic paste and cook for 1 minute.",
            "Add tomatoes and spices and cook for 6 minutes until oil separates.",
            "Add chickpeas and a cup of water and simmer for 15 minutes.",
            "Mash a few chickpeas to thicken, finish with coriander.",
        ],
        [],
        90,
        410,
    ),
    r(
        "Curd Rice",
        "Cooling South Indian curd rice tempered with mustard, ginger and curry leaves.",
        "South Indian",
        ["vegetarian", "gluten-free"],
        5,
        5,
        "easy",
        [
            ("cooked rice", 1.5, "cups", "soft"),
            ("curd", 1, "cup", None),
            ("milk", 0.25, "cup", None),
            ("mustard seeds", 1, "tsp", None),
            ("curry leaves", 6, "leaves", None),
            ("ginger", 1, "tsp", "grated"),
            ("oil", 1, "tsp", None),
            ("salt", None, "", "to taste"),
        ],
        [
            "Mash the rice lightly and mix with curd, milk and salt.",
            "Heat oil, splutter mustard seeds, add curry leaves and ginger for 30 seconds.",
            "Pour the tempering over the rice and mix. Chill for 10 minutes before serving.",
        ],
        ["milk/dairy", "mustard"],
        40,
        290,
    ),
]


def score(recipe, wanted):
    names = " ".join(i["name"] for i in recipe["ingredients"]).lower()
    return sum(1 for w in wanted if w and w.lower().rstrip("s") in names)


def demo_handler(request: httpx.Request) -> httpx.Response:
    body = json.loads(request.content or b"{}")
    msgs = body.get("messages", [])
    system = msgs[0].get("content", "") if msgs else ""
    user = msgs[-1].get("content", "") if msgs else ""
    if '"recipes"' not in system:
        return FakeOpenRouter.smart_default(request)
    try:
        constraints = json.loads(user.split("Constraints (JSON):\n", 1)[1].split("\n\nYour previous", 1)[0])
    except (IndexError, ValueError):
        constraints = {}
    wanted = (constraints.get("available_ingredients") or []) + (constraints.get("use_first_expiring_soon") or [])
    if constraints.get("dish_idea"):
        wanted += re.findall(r"\w+", constraints["dish_idea"])
    n = int(constraints.get("number_of_recipes") or 3)
    ranked = sorted(LIBRARY, key=lambda rec: score(rec, wanted), reverse=True)
    remix = constraints.get("remix_of")
    if remix:
        base = next((x for x in LIBRARY if x["title"].lower() == remix["recipe"].lower()), ranked[0])
        picks = [
            {
                **base,
                "title": f"{base['title']} ({remix['change_requested'][:40]})",
                "description": f"A remix: {remix['change_requested']}.",
            },
            {**base, "title": f"Weeknight {base['title']}", "prep_minutes": max(5, base["prep_minutes"] - 5)},
        ]
    else:
        picks = ranked[:n]
    return httpx.Response(200, json=completion(json.dumps({"recipes": picks}), model="demo/fake-model"))


settings = dataclasses.replace(load_settings(), openrouter_api_key="fake-key-for-local-mock", ai_rate_limit_per_minute=60)
app = create_app(settings, llm_transport=httpx.MockTransport(demo_handler))

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("PORT", "8000")))
