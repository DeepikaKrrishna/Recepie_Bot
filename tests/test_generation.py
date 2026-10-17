"""Recipe generation with mocked AI responses."""

from __future__ import annotations

import json

from .fakes import CHICKEN_FRIED_RICE, LEMON_RICE, TOMATO_RASAM, FakeOpenRouter, recipes_json

GOOD_REQUEST = {"ingredients": ["rice", "lemon"], "servings": 2}


def test_generate_requires_sign_in(anon, fake):
    res = anon.post("/api/recipes/generate", json=GOOD_REQUEST)
    assert res.status_code == 401
    assert fake.requests == []  # never reaches the AI provider


def test_generate_returns_validated_recipes(client):
    res = client.post("/api/recipes/generate", json=GOOD_REQUEST)
    assert res.status_code == 200
    data = res.json()
    assert [r["title"] for r in data["recipes"]] == ["Lemon Rice", "Tomato Rasam"]
    first = data["recipes"][0]
    assert first["total_minutes"] == 20
    assert first["steps"][0].startswith("Heat oil")
    assert first["ingredients"][0] == {"name": "cooked rice", "quantity": 2.0, "unit": "cups", "note": None, "optional": False}
    assert "not medical" in data["disclaimer"]
    assert "estimated_cost" not in first


def test_coverage_shows_which_ingredients_are_used_and_what_else_is_needed(client):
    first = client.post("/api/recipes/generate", json={"ingredients": ["rice", "lemon", "peanuts"]}).json()["recipes"][0]
    assert first["uses_yours"] == ["rice", "lemon", "peanuts"]
    # staples (oil, salt, turmeric, mustard seeds) don't count as missing; optional items are skipped
    assert first["also_needs"] == ["curry leaves"]


def test_recipes_using_more_of_your_ingredients_come_first(make_client):
    client = make_client(FakeOpenRouter([recipes_json(TOMATO_RASAM, LEMON_RICE)]))
    titles = [r["title"] for r in client.post("/api/recipes/generate", json={"ingredients": ["rice", "lemon"]}).json()["recipes"]]
    assert titles == ["Lemon Rice", "Tomato Rasam"]


def test_server_detects_allergens_from_ingredients_even_if_model_omits_them(make_client):
    recipe = {**LEMON_RICE, "allergens": []}
    client = make_client(FakeOpenRouter([recipes_json(recipe)]))
    allergens = client.post("/api/recipes/generate", json=GOOD_REQUEST).json()["recipes"][0]["possible_allergens"]
    assert "peanut" in allergens and "mustard" in allergens


def test_api_key_sent_only_to_provider_and_never_returned(client, fake):
    res = client.post("/api/recipes/generate", json=GOOD_REQUEST)
    assert fake.requests[0]["headers"]["authorization"] == "Bearer test-key"
    assert "test-key" not in res.text


def test_groq_is_the_default_provider(make_client):
    from app.config import Settings

    s = Settings()
    assert s.ai_base_url == "https://api.groq.com/openai/v1" and s.ai_model == "llama-3.3-70b-versatile"
    fake = FakeOpenRouter()
    client = make_client(fake)
    client.post("/api/recipes/generate", json=GOOD_REQUEST)
    assert fake.requests[0]["url"] == "https://api.groq.com/openai/v1/chat/completions"
    assert fake.requests[0]["body"]["response_format"] == {"type": "json_object"}


def test_provider_settings_from_env(monkeypatch):
    from app.config import load_settings

    for var in ("AI_API_KEY", "AI_PROVIDER", "AI_BASE_URL", "AI_MODEL", "GROQ_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "g-key")
    s = load_settings()
    assert s.ai_provider == "gemini" and s.ai_api_key == "g-key" and "generativelanguage" in s.ai_base_url
    monkeypatch.delenv("GEMINI_API_KEY")
    monkeypatch.setenv("GROQ_API_KEY", "gq-key")
    monkeypatch.setenv("AI_MODEL", "llama-3.1-8b-instant")
    s = load_settings()
    assert (s.ai_provider, s.ai_api_key, s.ai_model) == ("groq", "gq-key", "llama-3.1-8b-instant")


def test_model_is_configurable(make_client):
    fake = FakeOpenRouter()
    client = make_client(fake, ai_model="vendor/custom-model")
    client.post("/api/recipes/generate", json=GOOD_REQUEST)
    assert fake.requests[0]["body"]["model"] == "vendor/custom-model"


def test_prompt_asks_for_real_tasty_dishes_and_passes_constraints_as_data(client, fake):
    client.post(
        "/api/recipes/generate",
        json={
            **GOOD_REQUEST,
            "exclude": ["peanut"],
            "diets": ["vegan"],
            "cuisine": "South Indian",
            "occasion": "tiffin box",
            "spice": "mild",
        },
    )
    system = fake.requests[0]["body"]["messages"][0]["content"]
    assert "real, well-known dishes" in system and "Balance flavour" in system and "sensory cue" in system
    user_msg = fake.requests[0]["body"]["messages"][1]["content"]
    constraints = json.loads(user_msg.split("Constraints (JSON):\n", 1)[1])
    assert constraints["exclude"] == ["peanut"]
    assert constraints["dietary_preferences"] == ["vegan"]
    assert constraints["occasion"] == "tiffin box" and constraints["spice_level"] == "mild"


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
    assert "rejected" in fake.requests[1]["body"]["messages"][1]["content"]


def test_time_notice(make_client):
    client = make_client(FakeOpenRouter([recipes_json(TOMATO_RASAM)]))
    recipe = client.post("/api/recipes/generate", json={**GOOD_REQUEST, "max_total_minutes": 15}).json()["recipes"][0]
    assert any("15-minute" in n for n in recipe["notices"])


def test_remix_request_is_forwarded(client, fake):
    res = client.post(
        "/api/recipes/generate", json={"count": 2, "remix": {"base_title": "Lemon Rice", "instruction": "make it spicier"}}
    )
    assert res.status_code == 200
    content = fake.requests[0]["body"]["messages"][1]["content"]
    assert "Rework the recipe 'Lemon Rice'" in content and "make it spicier" in content


def test_substitutes(client):
    res = client.post("/api/recipes/substitute", json={"recipe_title": "Lemon Rice", "ingredient": "lemon"})
    assert res.status_code == 200
    assert res.json()["substitutes"][0]["name"] == "lime"


def test_substitutes_respect_diet(make_client):
    content = json.dumps({"substitutes": [{"name": "butter"}, {"name": "coconut oil"}]})
    client = make_client(FakeOpenRouter([content]))
    res = client.post("/api/recipes/substitute", json={"recipe_title": "X", "ingredient": "ghee", "diets": ["vegan"]})
    assert [s["name"] for s in res.json()["substitutes"]] == ["coconut oil"]


def test_removed_endpoints_are_gone(client):
    for method, url in [
        ("post", "/api/ask"),
        ("get", "/api/suggest?ingredients=rice"),
        ("post", "/generate"),
        ("get", "/api/pantry"),
        ("get", "/api/shopping"),
        ("get", "/api/plan?start=2026-10-12"),
    ]:
        assert getattr(client, method)(url).status_code in (404, 405), url
