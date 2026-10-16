"""Input validation, limits, rate limiting, headers, health and static serving."""

from __future__ import annotations

import pytest

from app.security import RateLimiter

# ---- validation ----------------------------------------------------------------------


@pytest.mark.parametrize(
    "payload",
    [
        {},  # no subject
        {"ingredients": []},
        {"ingredients": ["rice"], "servings": 0},
        {"ingredients": ["rice"], "servings": 500},
        {"ingredients": ["rice"], "count": 50},
        {"ingredients": ["x" * 61]},
        {"ingredients": ["rice"] * 31},
        {"ingredients": ["rice"], "cuisine": "Martian"},
        {"ingredients": ["rice"], "diets": ["carnivore-only"]},
        {"ingredients": ["rice"], "budget": -5},
        {"ingredients": ["rice"], "currency": "rupees"},
        {"ingredients": ["rice"], "unexpected_field": True},
        {"ingredients": ["rice"], "exclude": ["Rice"]},
    ],
)
def test_generate_rejects_invalid_input(client, fake, payload):
    res = client.post("/api/recipes/generate", json=payload)
    assert res.status_code == 422
    assert fake.requests == []  # never reaches the AI provider


def test_validation_errors_do_not_echo_input(client):
    res = client.post("/api/recipes/generate", json={"ingredients": ["<script>alert(1)</script>" * 5]})
    assert res.status_code == 422
    assert "<script>" not in res.text


def test_ingredients_are_cleaned_and_deduplicated(client, fake):
    client.post("/api/recipes/generate", json={"ingredients": ["  Rice ", "rice", "to\x00mato"]})
    content = fake.requests[0]["body"]["messages"][1]["content"]
    assert '"available_ingredients": ["Rice", "tomato"]' in content


def test_ask_requires_reasonable_length(client):
    assert client.post("/api/ask", json={"question": "x"}).status_code == 422
    assert client.post("/api/ask", json={"question": "q" * 501}).status_code == 422


def test_suggest_query_length_limited(client):
    assert client.get("/api/suggest", params={"ingredients": "a" * 501}).status_code == 422


def test_malformed_json_body(client):
    res = client.post("/api/recipes/generate", content=b"{not json", headers={"content-type": "application/json"})
    assert res.status_code == 422


# ---- body size -------------------------------------------------------------------------


def test_oversized_body_rejected_by_content_length(client, fake):
    res = client.post("/api/ask", content=b'{"question": "' + b"a" * 40_000 + b'"}', headers={"content-type": "application/json"})
    assert res.status_code == 413
    assert fake.requests == []


def test_oversized_chunked_body_rejected(client, fake):
    def chunks():
        yield b'{"question": "'
        for _ in range(40):
            yield b"a" * 1000
        yield b'"}'

    res = client.post("/api/ask", content=chunks(), headers={"content-type": "application/json"})
    assert res.status_code == 413
    assert fake.requests == []


# ---- rate limiting ------------------------------------------------------------------------


def test_ai_endpoints_are_rate_limited(make_client):
    client = make_client(ai_rate_limit_per_minute=2)
    body = {"question": "How long to boil an egg?"}
    assert client.post("/api/ask", json=body).status_code == 200
    assert client.post("/api/ask", json=body).status_code == 200
    blocked = client.post("/api/ask", json=body)
    assert blocked.status_code == 429
    assert int(blocked.headers["retry-after"]) >= 1
    # the limit is shared across AI endpoints
    assert client.post("/api/recipes/generate", json={"ingredients": ["rice"]}).status_code == 429
    # non-AI endpoints are unaffected
    assert client.get("/healthz").status_code == 200


def test_rate_limiter_window_slides():
    limiter = RateLimiter(limit=2, window=60)
    assert limiter.hit("a", now=0)[0]
    assert limiter.hit("a", now=1)[0]
    allowed, retry = limiter.hit("a", now=2)
    assert not allowed and retry == 58
    assert limiter.hit("b", now=2)[0]  # separate key
    assert limiter.hit("a", now=61)[0]  # first hit expired


def test_forwarded_for_ignored_unless_trusted(make_client):
    client = make_client(ai_rate_limit_per_minute=1)
    body = {"question": "How long to boil an egg?"}
    assert client.post("/api/ask", json=body, headers={"x-forwarded-for": "1.1.1.1"}).status_code == 200
    # spoofing a different IP must not bypass the limit when TRUST_PROXY is off
    assert client.post("/api/ask", json=body, headers={"x-forwarded-for": "2.2.2.2"}).status_code == 429


def test_forwarded_for_used_when_trusted(make_client):
    client = make_client(ai_rate_limit_per_minute=1, trust_proxy=True)
    body = {"question": "How long to boil an egg?"}
    assert client.post("/api/ask", json=body, headers={"x-forwarded-for": "1.1.1.1"}).status_code == 200
    assert client.post("/api/ask", json=body, headers={"x-forwarded-for": "2.2.2.2"}).status_code == 200


# ---- headers / CORS ------------------------------------------------------------------------


def test_security_headers_present(client):
    res = client.get("/")
    csp = res.headers["content-security-policy"]
    assert "script-src 'self'" in csp and "unsafe-inline" not in csp
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["x-frame-options"] == "DENY"
    assert res.headers["x-request-id"]
    assert "strict-transport-security" not in res.headers


def test_hsts_and_docs_in_production(make_client):
    client = make_client(app_env="production")
    assert "max-age" in client.get("/healthz").headers["strict-transport-security"]
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404


def test_cors_closed_by_default(client):
    res = client.options("/api/ask", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in res.headers


def test_cors_allows_configured_origin_without_credentials(make_client):
    client = make_client(allowed_origins=["https://app.example"])
    res = client.options("/api/ask", headers={"Origin": "https://app.example", "Access-Control-Request-Method": "POST"})
    assert res.headers["access-control-allow-origin"] == "https://app.example"
    assert "access-control-allow-credentials" not in res.headers


# ---- health & static -------------------------------------------------------------------------


def test_health_endpoints(client):
    assert client.get("/healthz").json() == {"status": "ok"}
    ready = client.get("/readyz").json()
    assert ready["status"] == "ready"
    assert ready["checks"] == {"database": True, "recipe_dataset": True, "llm_configured": True}
    assert "key" not in str(ready).lower()


def test_frontend_and_legal_pages_served(client):
    assert "Recipe Bot" in client.get("/").text
    assert client.head("/").status_code == 200
    assert "Privacy notice" in client.get("/privacy").text
    assert "Terms of use" in client.get("/terms").text
    assert client.get("/static/js/main.js").status_code == 200
    assert client.get("/sw.js").headers["service-worker-allowed"] == "/"
    assert client.get("/manifest.webmanifest").json()["name"] == "Recipe Bot"


def test_frontend_never_parses_html_strings():
    """All UI text is rendered via DOM APIs, so AI or user text can't inject markup."""
    from pathlib import Path

    js_dir = Path(__file__).resolve().parent.parent / "static" / "js"
    files = list(js_dir.rglob("*.js"))
    assert len(files) > 10
    for f in files:
        code = f.read_text()
        for banned in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function"):
            assert banned not in code, f"{banned} found in {f.name}"
        assert "openrouter" not in code.lower(), f"provider reference in {f.name}"


def test_settings_repr_hides_key():
    from app.config import Settings

    assert "super-secret" not in repr(Settings(openrouter_api_key="super-secret"))


def test_no_secrets_committed_in_tree():
    """Guard against re-adding provider keys to tracked source files."""
    import re
    from pathlib import Path

    root = Path(__file__).resolve().parent.parent
    pattern = re.compile(r"sk-or-v1-[A-Za-z0-9]{20,}")
    for path in root.rglob("*"):
        scanned = {".py", ".js", ".html", ".md", ".yml", ".yaml", ".toml", ".txt", ".example"}
        if path.is_file() and ".git" not in path.parts and path.suffix in scanned:
            assert not pattern.search(path.read_text(errors="ignore")), f"possible key in {path}"
