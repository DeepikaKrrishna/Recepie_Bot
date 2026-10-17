"""Cookbook: save, favourite, notes, cook tracking, plus app-shell routes and matching helpers."""

from __future__ import annotations

import pytest

from app.kitchen import matches

from .fakes import TOMATO_RASAM
from .helpers import User, recipe_out, save


@pytest.fixture
def cook(anon):
    return User(anon, "cook@example.com")


def test_save_list_favorite_notes_delete(cook):
    r = save(cook)
    assert r["title"] == "Lemon Rice" and r["recipe"]["steps"]
    save(cook, TOMATO_RASAM)
    assert [x["title"] for x in cook.get("/api/recipes").json()] == ["Tomato Rasam", "Lemon Rice"]
    cook.patch(f"/api/recipes/{r['id']}", json={"favorite": True, "notes": "Add more curry leaves"})
    favs = cook.get("/api/recipes?favorite=true").json()
    assert [x["title"] for x in favs] == ["Lemon Rice"]
    assert cook.get("/api/recipes?q=curry").json()[0]["id"] == r["id"]  # searches notes
    assert cook.delete(f"/api/recipes/{r['id']}").status_code == 204
    assert cook.get(f"/api/recipes/{r['id']}").status_code == 404


def test_saved_recipe_keeps_emoji_and_coverage(cook):
    r = cook.post(
        "/api/recipes", json={"recipe": recipe_out(hero_emoji="🍋", uses_yours=["rice"], also_needs=["curry leaves"])}
    ).json()
    assert r["hero_emoji"] == "🍋"
    assert r["recipe"]["uses_yours"] == ["rice"]
    assert cook.get("/api/recipes").json()[0]["hero_emoji"] == "🍋"


def test_save_rejects_invalid_recipe(cook):
    assert cook.post("/api/recipes", json={"recipe": {"title": "x"}}).status_code == 422
    assert cook.post("/api/recipes", json={"recipe": recipe_out(steps=[])}).status_code == 422


def test_saved_recipe_text_is_stored_as_data(cook):
    evil = recipe_out(title="<img src=x onerror=alert(1)>")
    assert cook.post("/api/recipes", json={"recipe": evil}).json()["title"] == "<img src=x onerror=alert(1)>"


def test_mark_cooked_updates_stats(cook):
    r = save(cook)
    cook.post(f"/api/recipes/{r['id']}/cooked")
    after = cook.post(f"/api/recipes/{r['id']}/cooked").json()
    assert after["cooked_count"] == 2 and after["last_cooked_at"]
    assert cook.get("/api/auth/me").json()["user"]["stats"] == {"saved": 1, "cooked": 2, "best_game_score": 0}


def test_cookbook_capacity(cook, monkeypatch):
    from app.routers import cookbook

    monkeypatch.setattr(cookbook, "MAX_SAVED", 1)
    save(cook)
    assert cook.post("/api/recipes", json={"recipe": recipe_out()}).status_code == 409


@pytest.mark.parametrize(
    "a,b,expected",
    [
        ("Tomatoes", "tomato", True),
        ("curry leaves", "curry leaf", True),
        ("cooked rice", "rice", True),
        ("basmati rice", "rice", True),
        ("rice flour", "rice", False),
        ("coconut milk", "coconut", False),
        ("green chillies", "chilli", True),
        ("egg", "eggplant", False),
        ("dahi", "curd", True),
        ("brinjal", "eggplant", True),
    ],
)
def test_ingredient_matching(a, b, expected):
    assert matches(a, b) is expected


@pytest.mark.parametrize(
    "path", ["/", "/welcome", "/login", "/signup", "/results", "/recipe/1", "/cookbook", "/cookbook/5", "/account"]
)
def test_spa_routes_serve_shell(anon, path):
    res = anon.get(path)
    assert res.status_code == 200 and "<main" in res.text


def test_unknown_api_route_is_json_404(anon):
    res = anon.get("/api/nope")
    assert res.status_code == 404 and res.json()["detail"] == "Not found."
