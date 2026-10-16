"""Recipe generation with mocked AI responses."""

from __future__ import annotations

import json

import httpx

from .fakes import CHICKEN_FRIED_RICE, LEMON_RICE, TOMATO_RASAM, FakeOpenRouter, completion, recipes_json

GOOD_REQUEST = {"ingredients": ["rice", "lemon"], "servings": 2}


def test_generate_returns_validated_recipes(client):
    res = client.post("/api/recipes/generate", json=GOOD_REQUEST)
    assert res.status_code == 200
    data = res.json()
    assert [r["title"] for r in data["recipes"]] == ["Lemon Rice", "Tomato Rasam"]
    first = data["recipes"][0]
    assert first["total_minutes"] == 20
    assert first["steps"][0].startswith("Heat oil")
    assert first["ingredients"][0] == {"name": "cooked rice", "quantity": 2.0, "unit": "cups", "note": None, "optional": False}
    assert "disclaimer" in data and "not medical" in data["disclaimer"]


def test_server_detects_allergens_from_ingredients_even_if_model_omits_them(make_client):
    recipe = {**LEMON_RICE, "allergens": []}
    client = make_client(FakeOpenRouter([recipes_json(recipe)]))
    allergens = client.post("/api/recipes/generate", json=GOOD_REQUEST).json()["recipes"][0]["possible_allergens"]
    assert "peanut" in allergens and "mustard" in allergens


def test_api_key_sent_only_to_provider_and_never_returned(client, fake):
    res = client.post("/api/recipes/generate", json=GOOD_REQUEST)
    assert fake.requests[0]["headers"]["authorization"] == "Bearer test-key"
    assert "test-key" not in res.text


def test_model_is_configurable(make_client):
    fake = FakeOpenRouter()
    client = make_client(fake, openrouter_model="vendor/custom-model")
    client.post("/api/recipes/generate", json=GOOD_REQUEST)
    assert fake.requests[0]["body"]["model"] == "vendor/custom-model"


def test_user_constraints_are_passed_as_data(client, fake):
    client.post(
        "/api/recipes/generate",
        json={**GOOD_REQUEST, "exclude": ["peanut"], "diets": ["vegan"], "cuisine": "South Indian", "budget": 150},
    )
    user_msg = fake.requests[0]["body"]["messages"][1]["content"]
    constraints = json.loads(user_msg.split("Constraints (JSON):\n", 1)[1])
    assert constraints["exclude"] == ["peanut"]
    assert constraints["dietary_preferences"] == ["vegan"]
    assert constraints["budget"] == {"amount": 150.0, "currency": "INR"}


def test_excluded_ingredient_recipe_is_dropped(make_client):
    client = make_client(FakeOpenRouter([recipes_json(LEMON_RICE, TOMATO_RASAM)]))
    data = client.post("/api/recipes/generate", json={**GOOD_REQUEST, "exclude": ["peanut"]}).json()
    assert [r["title"] for r in data["recipes"]] == ["Tomato Rasam"]
    assert data["dropped"] == 1


def test_diet_violation_is_dropped(make_client):
    client = make_client(FakeOpenRouter([recipes_json(CHICKEN_FRIED_RICE, TOMATO_RASAM)]))
    data = client.post("/api/recipes/generate", json={**GOOD_REQUEST, "diets": ["vegetarian"]}).json()
    assert [r["title"] for r in data["recipes"]] == ["Tomato Rasam"]


def test_all_recipes_violating_constraints_retries_then_422(make_client):
    fake = FakeOpenRouter([recipes_json(CHICKEN_FRIED_RICE), recipes_json(CHICKEN_FRIED_RICE)])
    client = make_client(fake)
    res = client.post("/api/recipes/generate", json={**GOOD_REQUEST, "diets": ["vegetarian"]})
    assert res.status_code == 422
    assert "filters" in res.json()["detail"]
    assert len(fake.requests) == 2
    # second attempt tells the model what was wrong
    assert "rejected" in fake.requests[1]["body"]["messages"][1]["content"]


def test_time_and_budget_notices(make_client):
    client = make_client(FakeOpenRouter([recipes_json(TOMATO_RASAM)]))
    recipe = client.post(
        "/api/recipes/generate", json={**GOOD_REQUEST, "max_total_minutes": 15, "budget": 10, "currency": "INR"}
    ).json()["recipes"][0]
    assert any("15-minute" in n for n in recipe["notices"])
    assert any("budget" in n for n in recipe["notices"])


def test_cost_in_wrong_currency_is_discarded(make_client):
    client = make_client(FakeOpenRouter([recipes_json(LEMON_RICE)]))
    recipe = client.post("/api/recipes/generate", json={**GOOD_REQUEST, "currency": "USD"}).json()["recipes"][0]
    assert recipe["estimated_cost"] is None


def test_remix_request_is_forwarded(client, fake):
    res = client.post(
        "/api/recipes/generate",
        json={"count": 2, "remix": {"base_title": "Lemon Rice", "instruction": "make it spicier"}},
    )
    assert res.status_code == 200
    content = fake.requests[0]["body"]["messages"][1]["content"]
    assert "Adapt the recipe 'Lemon Rice'" in content and "make it spicier" in content


def test_substitutes(client):
    res = client.post("/api/recipes/substitute", json={"recipe_title": "Lemon Rice", "ingredient": "lemon"})
    assert res.status_code == 200
    assert res.json()["substitutes"][0]["name"] == "lime"


def test_substitutes_respect_diet(make_client):
    content = json.dumps({"substitutes": [{"name": "butter"}, {"name": "coconut oil"}]})
    client = make_client(FakeOpenRouter([content]))
    res = client.post("/api/recipes/substitute", json={"recipe_title": "X", "ingredient": "ghee", "diets": ["vegan"]})
    assert [s["name"] for s in res.json()["substitutes"]] == ["coconut oil"]


def test_ask_chef(client):
    res = client.post("/api/ask", json={"question": "Can I use curd instead of cream?"})
    assert res.status_code == 200
    assert "curd" in res.json()["answer"]


def test_legacy_endpoints_still_work(client):
    assert client.get("/suggest", params={"ingredients": "rice eggs soy sauce"}).json()["suggestions"][0] == "Egg Fried Rice"
    assert client.post("/ask", json={"question": "hello chef"}).json()["answer"]
    with client.stream("POST", "/generate", json={"title": "Pancakes"}) as res:
        body = "".join(res.iter_text())
    assert res.status_code == 200
    assert '"text": "# Pancakes\\n"' in body


def test_legacy_stream_hides_provider_error_body(make_client):
    fake = FakeOpenRouter([httpx.Response(500, text="internal secret details")])
    client = make_client(fake)
    with client.stream("POST", "/generate", json={"title": "Pancakes"}) as res:
        body = "".join(res.iter_text())
    assert "secret" not in body and '"error"' in body


def test_quick_suggest_respects_diet_and_exclusions(client):
    veg = client.get("/api/suggest", params={"ingredients": "chicken rice", "diets": "vegetarian"}).json()
    assert all("Chicken" not in m["title"] for m in veg["matches"])
    excl = client.get("/api/suggest", params=[("ingredients", "rice soy sauce"), ("exclude", "soy sauce")]).json()
    assert all("soy sauce" not in m["ingredients"] for m in excl["matches"])


def test_quick_suggest_flags_fallback(client):
    data = client.get("/api/suggest", params={"ingredients": "xyzzy"}).json()
    assert data["fallback"] is True and data["matches"]


def test_completion_helper_shape():
    assert completion("x")["choices"][0]["message"]["content"] == "x"
