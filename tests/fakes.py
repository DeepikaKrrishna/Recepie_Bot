"""Fake OpenRouter transport for tests and offline UI development.

No network calls, no API key needed. Responses are canned and clearly fake.
"""

from __future__ import annotations

import json
from collections.abc import Callable

import httpx

LEMON_RICE = {
    "title": "Lemon Rice",
    "description": "Tangy South Indian tempered rice, ready in minutes with leftover rice.",
    "cuisine": "South Indian",
    "diet_tags": ["vegetarian", "vegan"],
    "prep_minutes": 10,
    "cook_minutes": 10,
    "servings": 2,
    "difficulty": "easy",
    "ingredients": [
        {"name": "cooked rice", "quantity": 2, "unit": "cups"},
        {"name": "lemon", "quantity": 1, "unit": None, "note": "juiced"},
        {"name": "peanuts", "quantity": 2, "unit": "tbsp", "optional": True},
        {"name": "mustard seeds", "quantity": 1, "unit": "tsp"},
        {"name": "curry leaves", "quantity": 10, "unit": "leaves"},
        {"name": "turmeric", "quantity": 0.25, "unit": "tsp"},
        {"name": "oil", "quantity": 1.5, "unit": "tbsp"},
        {"name": "salt", "quantity": None, "unit": None, "note": "to taste"},
    ],
    "steps": [
        "Heat oil in a pan and add mustard seeds; let them splutter.",
        "Add peanuts and curry leaves and fry until the peanuts are golden.",
        "Stir in turmeric, then add the rice and salt and mix gently.",
        "Turn off the heat, add lemon juice, mix and serve.",
    ],
    "allergens": ["peanut", "mustard"],
    "estimated_cost": {"amount": 60, "currency": "INR"},
    "nutrition_per_serving": {"calories": 340, "protein_g": 7, "carbs_g": 55, "fat_g": 11},
    "tips": ["Day-old rice works best; fresh rice can turn mushy."],
}

TOMATO_RASAM = {
    "title": "Tomato Rasam",
    "description": "A peppery, tangy South Indian soup to sip or pour over rice.",
    "cuisine": "South Indian",
    "diet_tags": ["vegetarian", "vegan", "gluten-free"],
    "prep_minutes": 10,
    "cook_minutes": 20,
    "servings": 2,
    "difficulty": "easy",
    "ingredients": [
        {"name": "tomatoes", "quantity": 2, "unit": "medium", "note": "chopped"},
        {"name": "tamarind", "quantity": 1, "unit": "tsp", "note": "paste"},
        {"name": "black pepper", "quantity": 1, "unit": "tsp", "note": "crushed"},
        {"name": "cumin", "quantity": 1, "unit": "tsp"},
        {"name": "garlic", "quantity": 3, "unit": "cloves", "note": "crushed"},
        {"name": "coriander leaves", "quantity": 2, "unit": "tbsp"},
    ],
    "steps": [
        "Simmer tomatoes and tamarind in 2 cups of water for 10 minutes.",
        "Add crushed pepper, cumin and garlic and simmer for another 5 minutes.",
        "Finish with coriander leaves and serve hot.",
    ],
    "allergens": [],
    "estimated_cost": {"amount": 40, "currency": "INR"},
    "nutrition_per_serving": {"calories": 70},
    "tips": [],
}

CHICKEN_FRIED_RICE = {
    **LEMON_RICE,
    "title": "Chicken Fried Rice",
    "diet_tags": [],
    "ingredients": [{"name": "chicken", "quantity": 200, "unit": "g"}, {"name": "cooked rice", "quantity": 2, "unit": "cups"}],
}


def completion(content: str, model: str = "fake/model") -> dict:
    return {"model": model, "choices": [{"message": {"role": "assistant", "content": content}}]}


def recipes_json(*recipes: dict, fenced: bool = False) -> str:
    text = json.dumps({"recipes": list(recipes)})
    return f"Sure! Here are your recipes:\n```json\n{text}\n```" if fenced else text


class FakeOpenRouter:
    """Callable MockTransport handler that records requests and replays responses.

    `responses` items may be: an httpx.Response, a dict (sent as 200 JSON),
    a str (wrapped as a chat completion), or an Exception (raised).
    When the queue is empty the `default` is used.
    """

    def __init__(self, responses: list | None = None, default: Callable[[httpx.Request], httpx.Response] | None = None):
        self.responses = list(responses or [])
        self.requests: list[dict] = []
        self.default = default or self.smart_default

    def __call__(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content or b"{}")
        self.requests.append({"headers": dict(request.headers), "body": body, "url": str(request.url)})
        if self.responses:
            item = self.responses.pop(0)
            if isinstance(item, Exception):
                raise item
            if isinstance(item, httpx.Response):
                return item
            if isinstance(item, str):
                return httpx.Response(200, json=completion(item))
            return httpx.Response(200, json=item)
        return self.default(request)

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self)

    @staticmethod
    def smart_default(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content or b"{}")
        system = body.get("messages", [{}])[0].get("content", "")
        if body.get("stream"):
            chunks = [
                'data: {"choices":[{"delta":{"content":"# Pancakes\\n"}}]}',
                'data: {"choices":[{"delta":{"content":"Mix and cook."}}]}',
                "data: [DONE]",
            ]
            return httpx.Response(200, text="\n\n".join(chunks) + "\n\n", headers={"content-type": "text/event-stream"})
        if '"substitutes"' in system:
            content = json.dumps(
                {
                    "substitutes": [
                        {"name": "lime", "ratio": "1:1", "notes": "Slightly more floral; works well."},
                        {"name": "raw mango, grated", "ratio": "2 tbsp per lemon", "notes": "Classic tangy alternative."},
                    ]
                }
            )
        elif '"recipes"' in system:
            content = recipes_json(LEMON_RICE, TOMATO_RASAM, fenced=True)
        else:
            content = (
                "Yes. Whisk the curd until smooth first and add it off the heat so it doesn't split.\n"
                "- Use full-fat curd\n- Stir in a little besan to stabilise it"
            )
        return httpx.Response(200, json=completion(content))
