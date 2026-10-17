from __future__ import annotations

import dataclasses
import os

import pytest
from fastapi.testclient import TestClient

from app import llm as llm_module
from app.config import Settings
from app.main import create_app

from .fakes import FakeOpenRouter


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    """Make retry backoff instant in tests."""

    async def instant(*_args, **_kwargs):
        return None

    monkeypatch.setattr(llm_module.ChatClient, "_backoff", staticmethod(instant))


@pytest.fixture(autouse=True)
def _block_real_network(monkeypatch):
    """Fail loudly if anything tries to reach the internet without a mock transport."""
    import httpx

    original = httpx.AsyncClient.__init__

    def guarded(self, *args, **kwargs):
        if kwargs.get("transport") is None:
            raise RuntimeError("Real network access attempted in tests")
        original(self, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", guarded)


TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "sqlite://")


def reset_database(url: str) -> None:
    """Give each test a clean schema. In-memory SQLite is fresh per app already."""
    if url.startswith("sqlite") and url in ("sqlite://", "sqlite:///:memory:"):
        return
    from sqlalchemy import text

    from app.db import make_engine
    from app.models import Base

    engine = make_engine(url)
    with engine.begin() as conn:
        Base.metadata.drop_all(conn)
        conn.execute(text("DROP TABLE IF EXISTS alembic_version"))
    engine.dispose()


def make_settings(**overrides) -> Settings:
    base = Settings(
        ai_api_key="test-key",
        ai_rate_limit_per_minute=100,
        login_rate_limit_per_minute=100,
        ai_max_retries=2,
        database_url=TEST_DATABASE_URL,
    )
    return dataclasses.replace(base, **overrides)


@pytest.fixture
def fake():
    return FakeOpenRouter()


@pytest.fixture
def make_client():
    clients = []

    def _make(fake: FakeOpenRouter | None = None, signed_in: bool = True, **overrides) -> TestClient:
        """A test client. By default it is signed in, since AI endpoints need an account."""
        fake = fake or FakeOpenRouter()
        settings = make_settings(**overrides)
        reset_database(settings.database_url)
        app = create_app(settings, llm_transport=fake.transport, auto_migrate=True)
        client = TestClient(app, raise_server_exceptions=False)
        client.__enter__()
        clients.append(client)
        if signed_in:
            res = client.post("/api/auth/signup", json={"email": "chef@example.com", "password": "correct-horse-battery"})
            assert res.status_code == 201, res.text
            client.headers["X-CSRF-Token"] = res.json()["csrf_token"]
        return client

    yield _make
    for c in clients:
        c.__exit__(None, None, None)


@pytest.fixture
def client(make_client, fake):
    """Signed-in client."""
    return make_client(fake)


@pytest.fixture
def anon(make_client, fake):
    """Signed-out client."""
    return make_client(fake, signed_in=False)
