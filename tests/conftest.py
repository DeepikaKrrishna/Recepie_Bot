from __future__ import annotations

import dataclasses

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

    monkeypatch.setattr(llm_module.OpenRouterClient, "_backoff", staticmethod(instant))


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


def make_settings(**overrides) -> Settings:
    base = Settings(openrouter_api_key="test-key", ai_rate_limit_per_minute=100, openrouter_max_retries=2)
    return dataclasses.replace(base, **overrides)


@pytest.fixture
def fake():
    return FakeOpenRouter()


@pytest.fixture
def make_client():
    clients = []

    def _make(fake: FakeOpenRouter | None = None, **overrides) -> TestClient:
        fake = fake or FakeOpenRouter()
        app = create_app(make_settings(**overrides), llm_transport=fake.transport)
        client = TestClient(app, raise_server_exceptions=False)
        client.__enter__()
        clients.append(client)
        return client

    yield _make
    for c in clients:
        c.__exit__(None, None, None)


@pytest.fixture
def client(make_client, fake):
    return make_client(fake)
