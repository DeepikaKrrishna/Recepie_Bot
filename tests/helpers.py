from __future__ import annotations

from fastapi.testclient import TestClient

from .fakes import LEMON_RICE, TOMATO_RASAM

PASSWORD = "correct-horse-battery"


class User:
    """A signed-in test user with their own cookie jar and CSRF token."""

    def __init__(self, client: TestClient, email: str, password: str = PASSWORD):
        self.client = client
        self.email = email
        res = client.post("/api/auth/signup", json={"email": email, "password": password, "display_name": "Cook"})
        assert res.status_code == 201, res.text
        self.csrf = res.json()["csrf_token"]

    @property
    def h(self) -> dict:
        return {"X-CSRF-Token": self.csrf}

    def get(self, url, **kw):
        return self.client.get(url, **kw)

    def post(self, url, **kw):
        return self.client.post(url, headers={**self.h, **kw.pop("headers", {})}, **kw)

    def put(self, url, **kw):
        return self.client.put(url, headers={**self.h, **kw.pop("headers", {})}, **kw)

    def patch(self, url, **kw):
        return self.client.patch(url, headers={**self.h, **kw.pop("headers", {})}, **kw)

    def delete(self, url, **kw):
        return self.client.request("DELETE", url, headers={**self.h, **kw.pop("headers", {})}, **kw)


def recipe_out(base: dict = LEMON_RICE, **extra) -> dict:
    return {
        **base,
        "total_minutes": base["prep_minutes"] + base["cook_minutes"],
        "possible_allergens": [],
        "notices": [],
        "uses_expiring": [],
        **extra,
    }


def save(user: User, base: dict = LEMON_RICE) -> dict:
    res = user.post("/api/recipes", json={"recipe": recipe_out(base)})
    assert res.status_code == 201, res.text
    return res.json()


__all__ = ["User", "PASSWORD", "recipe_out", "save", "LEMON_RICE", "TOMATO_RASAM"]
