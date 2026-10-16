"""Cookbook, sharing, pantry/expiry, rescue mode, planner and shopping list."""

from __future__ import annotations

import datetime as dt

import pytest
from fastapi.testclient import TestClient

from app.kitchen import categorize, consolidate, matches

from .fakes import LEMON_RICE, TOMATO_RASAM, FakeOpenRouter, recipes_json
from .helpers import User, recipe_out, save

TODAY = dt.date.today()


@pytest.fixture
def cook(client):
    return User(client, "cook@example.com")


# ---- cookbook -----------------------------------------------------------------------------


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


def test_save_rejects_invalid_recipe(cook):
    assert cook.post("/api/recipes", json={"recipe": {"title": "x"}}).status_code == 422
    bad = recipe_out(steps=[])
    assert cook.post("/api/recipes", json={"recipe": bad}).status_code == 422


def test_saved_recipe_text_is_stored_as_data(cook):
    evil = recipe_out(title="<img src=x onerror=alert(1)>")
    r = cook.post("/api/recipes", json={"recipe": evil}).json()
    assert r["title"] == "<img src=x onerror=alert(1)>"  # stored verbatim; the UI renders it as text


def test_mark_cooked_updates_stats(cook):
    r = save(cook)
    cook.post(f"/api/recipes/{r['id']}/cooked")
    after = cook.post(f"/api/recipes/{r['id']}/cooked").json()
    assert after["cooked_count"] == 2 and after["last_cooked_at"]
    assert cook.get("/api/auth/me").json()["user"]["stats"] == {"saved": 1, "cooked": 2, "rescued": 0}


def test_share_link_lifecycle(client, cook):
    r = save(cook)
    cook.patch(f"/api/recipes/{r['id']}", json={"notes": "private note"})
    share = cook.post(f"/api/recipes/{r['id']}/share").json()
    assert share["path"] == f"/r/{share['share_id']}"
    assert cook.post(f"/api/recipes/{r['id']}/share").json() == share  # idempotent

    public = TestClient(client.app).get(f"/api/shared/{share['share_id']}")
    assert public.status_code == 200
    body = public.json()
    assert body["title"] == "Lemon Rice" and "private note" not in public.text and "cook@" not in public.text
    assert public.headers["x-robots-tag"] == "noindex"

    friend = User(TestClient(client.app), "friend@example.com")
    copy = friend.post(f"/api/shared/{share['share_id']}/save")
    assert copy.status_code == 201 and copy.json()["id"] != r["id"]

    cook.delete(f"/api/recipes/{r['id']}/share")
    assert TestClient(client.app).get(f"/api/shared/{share['share_id']}").status_code == 404
    assert client.get("/api/shared/not-a-real-share-id").status_code == 404
    assert client.get("/api/shared/x").status_code == 404


# ---- pantry ------------------------------------------------------------------------------------


def test_pantry_crud_categories_and_expiry_status(cook):
    soon = (TODAY + dt.timedelta(days=2)).isoformat()
    later = (TODAY + dt.timedelta(days=20)).isoformat()
    gone = (TODAY - dt.timedelta(days=1)).isoformat()
    cook.post(
        "/api/pantry/bulk",
        json={
            "items": [
                {"name": "Paneer", "quantity": 200, "unit": "g", "expires_on": soon},
                {"name": "toor dal", "expires_on": later},
                {"name": "milk", "expires_on": gone},
                {"name": "salt"},
            ]
        },
    )
    data = cook.get(f"/api/pantry?today={TODAY.isoformat()}").json()
    names = [i["name"] for i in data["items"]]
    assert names == ["milk", "Paneer", "toor dal", "salt"]  # soonest first, undated last
    by = {i["name"]: i for i in data["items"]}
    assert by["Paneer"]["status"] == "soon" and by["Paneer"]["days_left"] == 2
    assert by["milk"]["status"] == "expired"
    assert by["toor dal"]["status"] == "ok" and by["salt"]["status"] == "none"
    assert by["Paneer"]["category"] == "Dairy & Eggs" and by["toor dal"]["category"] == "Grains & Pulses"
    assert {i["name"] for i in data["expiring"]} == {"Paneer", "milk"}

    pid = by["Paneer"]["id"]
    patched = cook.patch(f"/api/pantry/{pid}", json={"quantity": 100, "clear_expiry": True}).json()
    assert patched["quantity"] == 100 and patched["expires_on"] is None
    assert cook.delete(f"/api/pantry/{pid}").status_code == 204


@pytest.mark.parametrize(
    "payload",
    [
        {"name": ""},
        {"name": "x" * 61},
        {"name": "rice", "quantity": -1},
        {"name": "rice", "category": "Weapons"},
        {"name": "rice", "expires_on": "1800-01-01"},
        {"name": "rice", "extra": 1},
    ],
)
def test_pantry_validation(cook, payload):
    assert cook.post("/api/pantry", json=payload).status_code == 422


def test_pantry_capacity(cook, monkeypatch):
    from app.routers import pantry

    monkeypatch.setattr(pantry, "MAX_ITEMS", 2)
    cook.post("/api/pantry/bulk", json={"items": [{"name": "a"}, {"name": "b"}]})
    assert cook.post("/api/pantry", json={"name": "c"}).status_code == 409


def test_consume_counts_rescued_items(cook):
    soon = (TODAY + dt.timedelta(days=1)).isoformat()
    later = (TODAY + dt.timedelta(days=30)).isoformat()
    items = cook.post(
        "/api/pantry/bulk", json={"items": [{"name": "spinach", "expires_on": soon}, {"name": "rice", "expires_on": later}]}
    ).json()
    res = cook.post("/api/pantry/consume", json={"ids": [i["id"] for i in items], "today": TODAY.isoformat()}).json()
    assert res == {"removed": 2, "rescued": 1, "rescued_total": 1}
    assert cook.get("/api/pantry").json()["items"] == []


# ---- rescue mode / generation options --------------------------------------------------------


def test_rescue_mode_ranks_recipes_using_expiring_items(make_client):
    fake = FakeOpenRouter([recipes_json(TOMATO_RASAM, LEMON_RICE)])
    client = make_client(fake)
    res = client.post(
        "/api/recipes/generate", json={"use_first": ["curry leaves", "lemon"], "occasion": "Tiffin Box", "spice": "mild"}
    )
    assert res.status_code == 200
    recipes = res.json()["recipes"]
    assert recipes[0]["title"] == "Lemon Rice"
    assert recipes[0]["uses_expiring"] == ["curry leaves", "lemon"]
    prompt = fake.requests[0]["body"]["messages"][1]["content"]
    assert "Food-waste rescue" in prompt and '"occasion": "tiffin box"' in prompt and '"spice_level": "mild"' in prompt


def test_generate_rejects_unknown_occasion_and_spice(client):
    assert client.post("/api/recipes/generate", json={"ingredients": ["rice"], "occasion": "heist"}).status_code == 422
    assert client.post("/api/recipes/generate", json={"ingredients": ["rice"], "spice": "nuclear"}).status_code == 422


# ---- planner + shopping ------------------------------------------------------------------------


def monday() -> dt.date:
    return TODAY - dt.timedelta(days=TODAY.weekday())


def test_plan_set_move_swap_delete(cook):
    a, b = save(cook)["id"], save(cook, TOMATO_RASAM)["id"]
    start = monday()
    d0, d1 = start.isoformat(), (start + dt.timedelta(days=1)).isoformat()
    e1 = cook.put("/api/plan", json={"day": d0, "slot": "lunch", "recipe_id": a, "servings": 4}).json()
    e2 = cook.put("/api/plan", json={"day": d1, "slot": "dinner", "recipe_id": b}).json()
    # replacing the same slot updates instead of duplicating
    cook.put("/api/plan", json={"day": d0, "slot": "lunch", "recipe_id": a, "servings": 3})
    week = cook.get(f"/api/plan?start={start.isoformat()}").json()
    assert len(week["entries"]) == 2 and week["entries"][0]["servings"] == 3
    # move e1 onto e2's slot → swap
    moved = cook.post(f"/api/plan/{e1['id']}/move", json={"day": d1, "slot": "dinner"}).json()
    assert (moved["day"], moved["slot"]) == (d1, "dinner")
    week = {(e["day"], e["slot"]): e["recipe"]["title"] for e in cook.get(f"/api/plan?start={start}").json()["entries"]}
    assert week == {(d1, "dinner"): "Lemon Rice", (d0, "lunch"): "Tomato Rasam"}
    assert cook.delete(f"/api/plan/{e2['id']}").status_code == 204
    assert cook.put("/api/plan", json={"day": d0, "slot": "brunch", "recipe_id": a}).status_code == 422


def test_deleting_recipe_removes_its_plan_entries(cook):
    rid = save(cook)["id"]
    cook.put("/api/plan", json={"day": monday().isoformat(), "slot": "lunch", "recipe_id": rid})
    cook.delete(f"/api/recipes/{rid}")
    assert cook.get(f"/api/plan?start={monday()}").json()["entries"] == []


def test_shopping_list_from_plan_scales_merges_and_skips_pantry(cook):
    a = save(cook)["id"]  # Lemon Rice, serves 2: 2 cups rice, 1 lemon...
    start = monday()
    cook.put("/api/plan", json={"day": start.isoformat(), "slot": "lunch", "recipe_id": a, "servings": 4})
    cook.put(
        "/api/plan", json={"day": (start + dt.timedelta(days=2)).isoformat(), "slot": "dinner", "recipe_id": a, "servings": 2}
    )
    cook.post("/api/pantry", json={"name": "Salt"})
    cook.post("/api/pantry", json={"name": "oil"})
    res = cook.post("/api/shopping/from-plan", json={"start": start.isoformat()}).json()
    items = {i["name"].lower(): i for i in res["items"]}
    assert items["cooked rice"]["quantity"] == 6.0 and items["cooked rice"]["unit"] == "cups"  # (4/2*2) + 2
    assert items["lemon"]["quantity"] == 3.0
    assert "salt" not in items and "oil" not in items
    assert set(res["skipped_in_pantry"]) == {"salt", "oil"}
    assert items["mustard seeds"]["category"] == "Spices & Herbs"
    # running it again merges into existing unchecked lines instead of duplicating
    again = cook.post("/api/shopping/from-plan", json={"start": start.isoformat()}).json()
    assert len(again["items"]) == len(res["items"])
    assert {i["name"].lower(): i for i in again["items"]}["lemon"]["quantity"] == 6.0


def test_shopping_from_empty_plan(cook):
    assert cook.post("/api/shopping/from-plan", json={"start": monday().isoformat()}).status_code == 422


def test_shopping_check_clear_and_move_to_pantry(cook):
    cook.post(
        "/api/shopping/bulk",
        json={"items": [{"name": "Onions", "quantity": 2}, {"name": "onion", "quantity": 1}, {"name": "milk", "unit": "l"}]},
    )
    items = cook.get("/api/shopping").json()
    assert len(items) == 2 and next(i for i in items if i["name"] == "Onions")["quantity"] == 3
    onion = next(i for i in items if i["name"] == "Onions")
    cook.patch(f"/api/shopping/{onion['id']}", json={"checked": True})
    assert cook.post("/api/shopping/to-pantry").json() == {"moved": 1}
    assert [p["name"] for p in cook.get("/api/pantry").json()["items"]] == ["Onions"]
    assert [i["name"] for i in cook.get("/api/shopping").json()] == ["milk"]
    milk = cook.get("/api/shopping").json()[0]
    cook.patch(f"/api/shopping/{milk['id']}", json={"checked": True})
    assert cook.delete("/api/shopping?checked_only=true").status_code == 204
    assert cook.get("/api/shopping").json() == []


# ---- pure helpers ------------------------------------------------------------------------------


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


def test_categorize_and_consolidate():
    assert categorize("mustard seeds") == "Spices & Herbs" and categorize("eggs") == "Dairy & Eggs"
    lines = consolidate([("rice", 500, "grams", "A"), ("Rice", 0.75, "kg", "B"), ("salt", None, "", "A")])
    rice = next(x for x in lines if x.name.lower() == "rice")
    assert (rice.quantity, rice.unit, rice.sources) == (1.25, "kg", ["A", "B"])


# ---- app shell routes ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        "/",
        "/pantry",
        "/plan",
        "/shopping",
        "/cookbook",
        "/cookbook/5",
        "/account",
        "/login",
        "/signup",
        "/r/abcdefgh12",
        "/recipe/1",
        "/results",
    ],
)
def test_spa_routes_serve_shell(client, path):
    res = client.get(path)
    assert res.status_code == 200 and "<main" in res.text


def test_unknown_api_route_is_json_404(client):
    res = client.get("/api/nope")
    assert res.status_code == 404 and res.json()["detail"] == "Not found."


def test_consolidate_keeps_written_unit_but_merges_plurals():
    lines = consolidate([("curry leaves", 10, "leaves", "A"), ("curry leaf", 20, "leaf", "B"), ("garlic", 3, "cloves", "A")])
    curry = next(x for x in lines if x.name == "curry leaves")
    assert (curry.quantity, curry.unit) == (30, "leaves")
