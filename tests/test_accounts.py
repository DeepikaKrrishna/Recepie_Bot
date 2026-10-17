"""Signup, login, sessions, CSRF, authorization, game score, export and account deletion."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.models import SavedRecipe, UserSession

from .helpers import PASSWORD, User, save


@pytest.fixture
def alice(anon):
    return User(anon, "alice@example.com")


@pytest.fixture
def bob(anon):
    # Separate TestClient = separate cookie jar, same app + database.
    return User(TestClient(anon.app), "bob@example.com")


# ---- signup / login ------------------------------------------------------------------


def test_signup_sets_secure_session_cookie(anon):
    res = anon.post("/api/auth/signup", json={"email": "New@Example.com ", "password": PASSWORD, "display_name": "Deepika"})
    assert res.status_code == 201
    body = res.json()
    assert body["user"]["email"] == "new@example.com" and body["user"]["display_name"] == "Deepika"
    assert body["csrf_token"]
    cookie = res.headers["set-cookie"]
    assert "rb_session=" in cookie and "HttpOnly" in cookie and "samesite=lax" in cookie.lower()


def test_production_cookie_is_secure_and_host_prefixed(make_client):
    client = make_client(app_env="production", signed_in=False)
    res = client.post("/api/auth/signup", json={"email": "p@example.com", "password": PASSWORD})
    cookie = res.headers["set-cookie"]
    assert cookie.startswith("__Host-rb_session=") and "Secure" in cookie and "Path=/" in cookie


@pytest.mark.parametrize(
    "email,password",
    [
        ("not-an-email", PASSWORD),
        ("a@b.co", "short"),
        ("a@b.co", "password123"),
        ("chef@example.com", "chef"),
        ("a@b.co", "x" * 129),
    ],
)
def test_signup_validation(anon, email, password):
    assert anon.post("/api/auth/signup", json={"email": email, "password": password}).status_code == 422


def test_duplicate_email_rejected(anon, alice):
    res = TestClient(anon.app).post("/api/auth/signup", json={"email": "ALICE@example.com", "password": PASSWORD})
    assert res.status_code == 409


def test_password_is_hashed_with_argon2(anon, alice):
    from app.models import User as U

    with anon.app.state.sessionmaker() as db:
        stored = db.scalar(select(U.password_hash))
    assert stored.startswith("$argon2id$") and PASSWORD not in stored


def test_session_token_stored_hashed(anon, alice):
    raw = anon.cookies.get("rb_session")
    with anon.app.state.sessionmaker() as db:
        ids = db.scalars(select(UserSession.id)).all()
    assert raw not in ids and len(ids[0]) == 64


def test_login_logout_flow(anon, alice):
    fresh = TestClient(anon.app)
    assert fresh.get("/api/auth/me").json() == {"user": None}
    bad = fresh.post("/api/auth/login", json={"email": "alice@example.com", "password": "wrong-password!"})
    unknown = fresh.post("/api/auth/login", json={"email": "nobody@example.com", "password": "wrong-password!"})
    assert bad.status_code == unknown.status_code == 401
    assert bad.json() == unknown.json()  # no account enumeration
    assert fresh.post("/api/auth/login", json={"email": "Alice@Example.com", "password": PASSWORD}).status_code == 200
    assert fresh.get("/api/auth/me").json()["user"]["email"] == "alice@example.com"
    assert fresh.post("/api/auth/logout").status_code == 204
    assert fresh.get("/api/auth/me").json() == {"user": None}


def test_login_is_rate_limited(make_client):
    client = make_client(login_rate_limit_per_minute=3, signed_in=False)
    for _ in range(3):
        client.post("/api/auth/login", json={"email": "x@example.com", "password": "nope-nope-nope"})
    res = client.post("/api/auth/login", json={"email": "x@example.com", "password": "nope-nope-nope"})
    assert res.status_code == 429 and res.headers["retry-after"]


def test_expired_session_is_rejected(anon, alice):
    from app.models import utcnow

    with anon.app.state.sessionmaker() as db:
        for s in db.scalars(select(UserSession)).all():
            s.expires_at = utcnow().replace(year=2000)
        db.commit()
    assert anon.get("/api/auth/me").json() == {"user": None}
    assert anon.get("/api/recipes").status_code == 401


# ---- CSRF / origin / signed-out ---------------------------------------------------------------


def test_mutations_require_csrf_token(anon, alice):
    rid = save(alice)["id"]
    assert anon.patch(f"/api/recipes/{rid}", json={"favorite": True}).status_code == 403
    assert anon.patch(f"/api/recipes/{rid}", json={"favorite": True}, headers={"X-CSRF-Token": "forged"}).status_code == 403
    assert alice.patch(f"/api/recipes/{rid}", json={"favorite": True}).status_code == 200


def test_cross_site_origin_blocked(anon, alice):
    rid = save(alice)["id"]
    assert (
        alice.patch(f"/api/recipes/{rid}", json={"favorite": True}, headers={"Origin": "https://evil.example"}).status_code == 403
    )
    res = anon.post(
        "/api/auth/login", json={"email": "alice@example.com", "password": PASSWORD}, headers={"Origin": "https://evil.example"}
    )
    assert res.status_code == 403
    res = alice.post("/api/recipes/generate", json={"ingredients": ["rice"]}, headers={"Origin": "https://evil.example"})
    assert res.status_code == 403


def test_signed_out_users_get_nothing_private(anon):
    for url in ("/api/recipes", "/api/account/export"):
        assert anon.get(url).status_code == 401, url
    assert anon.post("/api/recipes/generate", json={"ingredients": ["rice"]}).status_code == 401
    assert anon.post("/api/recipes/substitute", json={"recipe_title": "x", "ingredient": "y"}).status_code == 401


# ---- authorization between users ------------------------------------------------------------


def test_users_cannot_access_each_others_recipes(alice, bob):
    rid = save(alice)["id"]
    assert bob.get(f"/api/recipes/{rid}").status_code == 404
    assert bob.patch(f"/api/recipes/{rid}", json={"favorite": True}).status_code == 404
    assert bob.post(f"/api/recipes/{rid}/cooked").status_code == 404
    assert bob.delete(f"/api/recipes/{rid}").status_code == 404
    assert bob.get("/api/recipes").json() == []
    assert alice.get(f"/api/recipes/{rid}").json()["favorite"] is False


# ---- profile / password / game ------------------------------------------------------------------


def test_profile_update(alice):
    assert alice.put("/api/account/profile", json={"display_name": "Deepika"}).json()["user"]["display_name"] == "Deepika"


def test_game_score_keeps_best(alice):
    assert alice.post("/api/account/game-score", json={"score": 120}).json() == {"best": 120, "new_best": True}
    assert alice.post("/api/account/game-score", json={"score": 80}).json() == {"best": 120, "new_best": False}
    assert alice.post("/api/account/game-score", json={"score": -5}).status_code == 422
    assert alice.post("/api/account/game-score", json={"score": 10**9}).status_code == 422
    assert alice.get("/api/auth/me").json()["user"]["stats"]["best_game_score"] == 120


def test_password_change_revokes_other_sessions(anon, alice):
    other = TestClient(anon.app)
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


# ---- export / delete ------------------------------------------------------------------------------


def test_export_contains_only_own_data(alice, bob):
    save(alice)
    save(bob)
    data = alice.get("/api/account/export").json()
    assert data["account"]["email"] == "alice@example.com"
    assert len(data["saved_recipes"]) == 1
    assert "password" not in str(data).lower()


def test_account_deletion_removes_everything(anon, alice, bob):
    save(alice)
    save(bob)
    assert alice.delete("/api/account", json={"password": PASSWORD, "confirm": "nope"}).status_code == 422
    assert alice.delete("/api/account", json={"password": "wrong-password", "confirm": "DELETE"}).status_code == 401
    assert alice.delete("/api/account", json={"password": PASSWORD, "confirm": "DELETE"}).status_code == 204
    assert alice.get("/api/auth/me").json() == {"user": None}
    with anon.app.state.sessionmaker() as db:
        assert db.scalar(select(func.count()).select_from(SavedRecipe)) == 1  # only Bob's
    assert (
        TestClient(anon.app).post("/api/auth/login", json={"email": "alice@example.com", "password": PASSWORD}).status_code == 401
    )
    assert len(bob.get("/api/recipes").json()) == 1
