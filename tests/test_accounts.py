"""Signup, login, sessions, CSRF, authorization, export and account deletion."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.models import PantryItem, SavedRecipe, UserSession

from .helpers import PASSWORD, User, save


@pytest.fixture
def alice(client):
    return User(client, "alice@example.com")


@pytest.fixture
def bob(client):
    # Separate TestClient = separate cookie jar, same app + database.
    return User(TestClient(client.app), "bob@example.com")


# ---- signup / login ------------------------------------------------------------------


def test_signup_sets_secure_session_cookie(client):
    res = client.post("/api/auth/signup", json={"email": "New@Example.com ", "password": PASSWORD})
    assert res.status_code == 201
    body = res.json()
    assert body["user"]["email"] == "new@example.com"
    assert body["csrf_token"]
    cookie = res.headers["set-cookie"]
    assert "rb_session=" in cookie and "HttpOnly" in cookie and "samesite=lax" in cookie.lower()
    assert "password" not in res.text.lower().replace("password_", "")


def test_production_cookie_is_secure_and_host_prefixed(make_client):
    client = make_client(app_env="production")
    res = client.post("/api/auth/signup", json={"email": "p@example.com", "password": PASSWORD})
    cookie = res.headers["set-cookie"]
    assert cookie.startswith("__Host-rb_session=") and "Secure" in cookie and "Path=/" in cookie


@pytest.mark.parametrize(
    "email,password,status",
    [
        ("not-an-email", PASSWORD, 422),
        ("a@b.co", "short", 422),
        ("a@b.co", "password123", 422),
        ("chef@example.com", "chef", 422),
        ("a@b.co", "x" * 129, 422),
    ],
)
def test_signup_validation(client, email, password, status):
    assert client.post("/api/auth/signup", json={"email": email, "password": password}).status_code == status


def test_duplicate_email_rejected(client, alice):
    res = TestClient(client.app).post("/api/auth/signup", json={"email": "ALICE@example.com", "password": PASSWORD})
    assert res.status_code == 409


def test_password_is_hashed_with_argon2(client, alice):
    with client.app.state.sessionmaker() as db:
        from app.models import User as U

        stored = db.scalar(select(U.password_hash))
    assert stored.startswith("$argon2id$") and PASSWORD not in stored


def test_session_token_stored_hashed(client, alice):
    raw = client.cookies.get("rb_session")
    with client.app.state.sessionmaker() as db:
        ids = db.scalars(select(UserSession.id)).all()
    assert raw not in ids and len(ids[0]) == 64


def test_login_logout_flow(client, alice):
    fresh = TestClient(client.app)
    assert fresh.get("/api/auth/me").json() == {"user": None}
    bad = fresh.post("/api/auth/login", json={"email": "alice@example.com", "password": "wrong-password!"})
    unknown = fresh.post("/api/auth/login", json={"email": "nobody@example.com", "password": "wrong-password!"})
    assert bad.status_code == unknown.status_code == 401
    assert bad.json() == unknown.json()  # no account enumeration
    ok = fresh.post("/api/auth/login", json={"email": "Alice@Example.com", "password": PASSWORD})
    assert ok.status_code == 200
    assert fresh.get("/api/auth/me").json()["user"]["email"] == "alice@example.com"
    assert fresh.post("/api/auth/logout").status_code == 204
    assert fresh.get("/api/auth/me").json() == {"user": None}


def test_login_is_rate_limited(make_client):
    client = make_client(login_rate_limit_per_minute=3)
    for _ in range(3):
        client.post("/api/auth/login", json={"email": "x@example.com", "password": "nope-nope-nope"})
    res = client.post("/api/auth/login", json={"email": "x@example.com", "password": "nope-nope-nope"})
    assert res.status_code == 429 and res.headers["retry-after"]


def test_expired_session_is_rejected(client, alice):
    from app.models import utcnow

    with client.app.state.sessionmaker() as db:
        for s in db.scalars(select(UserSession)).all():
            s.expires_at = utcnow().replace(year=2000)
        db.commit()
    assert client.get("/api/auth/me").json() == {"user": None}
    assert client.get("/api/recipes").status_code == 401


# ---- CSRF / origin ---------------------------------------------------------------------------


def test_mutations_require_csrf_token(client, alice):
    assert client.post("/api/pantry", json={"name": "rice"}).status_code == 403
    assert client.post("/api/pantry", json={"name": "rice"}, headers={"X-CSRF-Token": "forged"}).status_code == 403
    assert alice.post("/api/pantry", json={"name": "rice"}).status_code == 201


def test_cross_site_origin_blocked(client, alice):
    res = alice.post("/api/pantry", json={"name": "rice"}, headers={"Origin": "https://evil.example"})
    assert res.status_code == 403
    res = client.post(
        "/api/auth/login", json={"email": "alice@example.com", "password": PASSWORD}, headers={"Origin": "https://evil.example"}
    )
    assert res.status_code == 403


def test_same_origin_allowed(client, alice):
    res = alice.post("/api/pantry", json={"name": "rice"}, headers={"Origin": "http://testserver"})
    assert res.status_code == 201


def test_anonymous_cannot_read_private_data(client):
    for url in (
        "/api/recipes",
        "/api/pantry",
        "/api/shopping",
        "/api/plan?start=2026-10-12",
        "/api/account/history",
        "/api/account/export",
    ):
        assert client.get(url).status_code == 401, url


# ---- authorization between users ------------------------------------------------------------


def test_users_cannot_access_each_others_data(alice, bob):
    recipe = save(alice)
    item = alice.post("/api/pantry", json={"name": "paneer"}).json()
    shop = alice.post("/api/shopping", json={"name": "milk"}).json()[0]

    rid, pid, sid = recipe["id"], item["id"], shop["id"]
    assert bob.get(f"/api/recipes/{rid}").status_code == 404
    assert bob.patch(f"/api/recipes/{rid}", json={"favorite": True}).status_code == 404
    assert bob.delete(f"/api/recipes/{rid}").status_code == 404
    assert bob.post(f"/api/recipes/{rid}/share").status_code == 404
    assert bob.patch(f"/api/pantry/{pid}", json={"name": "x"}).status_code == 404
    assert bob.delete(f"/api/pantry/{pid}").status_code == 404
    assert bob.patch(f"/api/shopping/{sid}", json={"checked": True}).status_code == 404
    assert bob.put("/api/plan", json={"day": "2026-10-12", "slot": "lunch", "recipe_id": rid}).status_code == 404
    assert bob.post("/api/pantry/consume", json={"ids": [pid]}).json()["removed"] == 0
    assert bob.get("/api/recipes").json() == []
    assert bob.get("/api/pantry").json()["items"] == []
    # Alice's data is untouched
    assert alice.get(f"/api/recipes/{rid}").json()["favorite"] is False
    assert len(alice.get("/api/pantry").json()["items"]) == 1


def test_cannot_plan_with_someone_elses_entry(alice, bob):
    rid = save(alice)["id"]
    entry = alice.put("/api/plan", json={"day": "2026-10-12", "slot": "lunch", "recipe_id": rid}).json()
    assert bob.post(f"/api/plan/{entry['id']}/move", json={"day": "2026-10-13", "slot": "lunch"}).status_code == 404
    assert bob.delete(f"/api/plan/{entry['id']}").status_code == 404


# ---- preferences / password / history ----------------------------------------------------------------


def test_preferences_round_trip(alice):
    res = alice.put(
        "/api/account/preferences",
        json={
            "diets": ["Vegetarian"],
            "cuisine": "south indian",
            "servings": 4,
            "currency": "INR",
            "exclude": ["Peanut", "peanut"],
            "history_retention_days": 7,
            "display_name": "Alice",
        },
    )
    assert res.status_code == 200
    me = alice.get("/api/auth/me").json()
    assert me["preferences"] == {
        "diets": ["vegetarian"],
        "cuisine": "South Indian",
        "servings": 4,
        "currency": "INR",
        "exclude": ["peanut"],
        "history_retention_days": 7,
    }
    assert me["user"]["display_name"] == "Alice"


def test_password_change_revokes_other_sessions(client, alice):
    other = TestClient(client.app)
    other.post("/api/auth/login", json={"email": "alice@example.com", "password": PASSWORD})
    assert other.get("/api/auth/me").json()["user"]
    assert (
        alice.post(
            "/api/account/password", json={"current_password": "nope-nope-nope", "new_password": "a-new-strong-password"}
        ).status_code
        == 401
    )
    assert (
        alice.post(
            "/api/account/password", json={"current_password": PASSWORD, "new_password": "a-new-strong-password"}
        ).status_code
        == 204
    )
    assert other.get("/api/auth/me").json() == {"user": None}
    assert alice.get("/api/auth/me").json()["user"]
    assert (
        TestClient(client.app)
        .post("/api/auth/login", json={"email": "alice@example.com", "password": "a-new-strong-password"})
        .status_code
        == 200
    )


def test_generation_history_recorded_and_retention(client, alice):
    alice.post("/api/recipes/generate", json={"ingredients": ["rice"]})
    hist = alice.get("/api/account/history").json()
    assert hist[0]["titles"] == ["Lemon Rice", "Tomato Rasam"]
    assert hist[0]["request"]["ingredients"] == ["rice"]
    # retention 0 = off: clears and stops recording
    alice.put("/api/account/preferences", json={"history_retention_days": 0})
    assert alice.get("/api/account/history").json() == []
    alice.post("/api/recipes/generate", json={"ingredients": ["rice"]})
    assert alice.get("/api/account/history").json() == []


def test_expired_history_is_purged(client, alice):
    from app.models import GenerationHistory, utcnow

    alice.post("/api/recipes/generate", json={"ingredients": ["rice"]})
    with client.app.state.sessionmaker() as db:
        for h in db.scalars(select(GenerationHistory)).all():
            h.expires_at = utcnow().replace(year=2000)
        db.commit()
    assert alice.get("/api/account/history").json() == []


def test_anonymous_generation_not_recorded(client):
    from app.models import GenerationHistory

    client.post("/api/recipes/generate", json={"ingredients": ["rice"]})
    with client.app.state.sessionmaker() as db:
        assert db.scalar(select(func.count()).select_from(GenerationHistory)) == 0


# ---- export / delete ------------------------------------------------------------------------------------


def test_export_contains_only_own_data(alice, bob):
    save(alice)
    alice.post("/api/pantry", json={"name": "rice", "expires_on": "2026-10-20"})
    save(bob)
    data = alice.get("/api/account/export").json()
    assert data["account"]["email"] == "alice@example.com"
    assert len(data["saved_recipes"]) == 1 and data["pantry"][0]["expires_on"] == "2026-10-20"
    assert "password" not in str(data).lower()


def test_account_deletion_removes_everything(client, alice, bob):
    rid = save(alice)["id"]
    alice.post("/api/pantry", json={"name": "rice"})
    alice.put("/api/plan", json={"day": "2026-10-12", "slot": "lunch", "recipe_id": rid})
    alice.post("/api/shopping", json={"name": "milk"})
    save(bob)

    assert alice.delete("/api/account", json={"password": PASSWORD, "confirm": "nope"}).status_code == 422
    assert alice.delete("/api/account", json={"password": "wrong-password", "confirm": "DELETE"}).status_code == 401
    assert alice.delete("/api/account", json={"password": PASSWORD, "confirm": "DELETE"}).status_code == 204

    assert alice.get("/api/auth/me").json() == {"user": None}
    with client.app.state.sessionmaker() as db:
        assert db.scalar(select(func.count()).select_from(SavedRecipe)) == 1  # only Bob's
        assert db.scalar(select(func.count()).select_from(PantryItem)) == 0
    assert (
        TestClient(client.app).post("/api/auth/login", json={"email": "alice@example.com", "password": PASSWORD}).status_code
        == 401
    )
    assert len(bob.get("/api/recipes").json()) == 1
