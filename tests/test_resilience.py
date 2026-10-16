"""Malformed output, provider failures, timeouts, retries and fallbacks."""

from __future__ import annotations

import json

import httpx
import pytest

from app.llm import LLMBadOutput, extract_json
from app.recipes import parse_recipe_batch

from .fakes import LEMON_RICE, TOMATO_RASAM, FakeOpenRouter, completion, recipes_json

REQ = {"ingredients": ["rice"]}


# ---- JSON extraction / schema validation -----------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        recipes_json(LEMON_RICE),
        recipes_json(LEMON_RICE, fenced=True),
        "Here you go!\n" + recipes_json(LEMON_RICE) + "\nEnjoy!",
        json.dumps([LEMON_RICE]),
        json.dumps(LEMON_RICE),
    ],
)
def test_parse_tolerates_common_wrappers(text):
    assert parse_recipe_batch(text).recipes[0].title == "Lemon Rice"


@pytest.mark.parametrize("text", ["", "not json at all", "{broken json", '{"recipes": []}', '{"recipes": [{"title": "x"}]}'])
def test_parse_rejects_garbage(text):
    with pytest.raises(LLMBadOutput):
        parse_recipe_batch(text)


def test_parse_keeps_valid_recipes_from_partially_invalid_batch():
    bad = {**TOMATO_RASAM, "servings": -3}
    batch = parse_recipe_batch(json.dumps({"recipes": [bad, LEMON_RICE]}))
    assert [r.title for r in batch.recipes] == ["Lemon Rice"]


def test_schema_rejects_absurd_values():
    for broken in (
        {**LEMON_RICE, "steps": []},
        {**LEMON_RICE, "ingredients": []},
        {**LEMON_RICE, "difficulty": "impossible"},
        {**LEMON_RICE, "prep_minutes": 99999},
    ):
        with pytest.raises(LLMBadOutput):
            parse_recipe_batch(json.dumps({"recipes": [broken]}))


def test_extract_json_finds_object_after_braces_in_prose():
    assert extract_json('Note {not json} then {"a": 1}') == {"a": 1}


# ---- endpoint behaviour on bad output ---------------------------------------------


def test_malformed_then_valid_output_recovers(make_client):
    fake = FakeOpenRouter(["Sorry, I can't format that.", recipes_json(LEMON_RICE)])
    res = make_client(fake).post("/api/recipes/generate", json=REQ)
    assert res.status_code == 200
    assert len(fake.requests) == 2


def test_persistently_malformed_output_returns_502(make_client):
    fake = FakeOpenRouter(["nope", "still nope"])
    res = make_client(fake).post("/api/recipes/generate", json=REQ)
    assert res.status_code == 502
    assert "validate" in res.json()["detail"]
    assert "nope" not in res.text


def test_empty_choices_is_bad_output(make_client):
    fake = FakeOpenRouter([{"choices": []}, {"choices": [{"message": {"content": ""}}]}])
    assert make_client(fake).post("/api/recipes/generate", json=REQ).status_code == 502


# ---- provider errors -----------------------------------------------------------------


def test_retries_on_5xx_then_succeeds(make_client):
    fake = FakeOpenRouter([httpx.Response(503), httpx.Response(502), completion(recipes_json(LEMON_RICE))])
    res = make_client(fake).post("/api/recipes/generate", json=REQ)
    assert res.status_code == 200
    assert len(fake.requests) == 3


def test_retries_are_bounded(make_client):
    fake = FakeOpenRouter(default=lambda r: httpx.Response(503))
    res = make_client(fake, openrouter_max_retries=2).post("/api/recipes/generate", json=REQ)
    assert res.status_code == 503
    assert len(fake.requests) == 3  # 1 try + 2 retries


def test_provider_rate_limit_maps_to_429(make_client):
    fake = FakeOpenRouter(default=lambda r: httpx.Response(429, headers={"retry-after": "1"}))
    res = make_client(fake, openrouter_max_retries=1).post("/api/recipes/generate", json=REQ)
    assert res.status_code == 429
    assert res.headers["retry-after"]


def test_timeout_maps_to_504(make_client):
    def boom(request):
        raise httpx.ReadTimeout("slow", request=request)

    res = make_client(FakeOpenRouter(default=boom), openrouter_max_retries=1).post("/api/recipes/generate", json=REQ)
    assert res.status_code == 504
    assert "too long" in res.json()["detail"]


def test_connection_error_maps_to_503(make_client):
    def boom(request):
        raise httpx.ConnectError("down", request=request)

    res = make_client(FakeOpenRouter(default=boom), openrouter_max_retries=0).post("/api/recipes/generate", json=REQ)
    assert res.status_code == 503


def test_invalid_key_is_reported_as_not_configured_without_retry(make_client):
    fake = FakeOpenRouter(default=lambda r: httpx.Response(401, json={"error": {"message": "bad key sk-or-xxx"}}))
    res = make_client(fake).post("/api/recipes/generate", json=REQ)
    assert res.status_code == 503
    assert len(fake.requests) == 1
    assert "sk-or" not in res.text


def test_unavailable_model_falls_back(make_client):
    def handler(request):
        body = json.loads(request.content)
        if body["model"] == "primary/model":
            return httpx.Response(404, json={"error": "No endpoints found"})
        return httpx.Response(200, json=completion(recipes_json(LEMON_RICE), model=body["model"]))

    fake = FakeOpenRouter(default=handler)
    client = make_client(fake, openrouter_model="primary/model", openrouter_fallback_models=["backup/model"])
    res = client.post("/api/recipes/generate", json=REQ)
    assert res.status_code == 200
    assert res.json()["model"] == "backup/model"


def test_response_format_rejection_retries_without_it(make_client):
    def handler(request):
        body = json.loads(request.content)
        if "response_format" in body:
            return httpx.Response(400, json={"error": "response_format unsupported"})
        return httpx.Response(200, json=completion(recipes_json(LEMON_RICE)))

    fake = FakeOpenRouter(default=handler)
    res = make_client(fake, openrouter_max_retries=0).post("/api/recipes/generate", json=REQ)
    assert res.status_code == 200
    assert len(fake.requests) == 2


def test_missing_api_key_returns_503(make_client):
    client = make_client(openrouter_api_key="")
    res = client.post("/api/recipes/generate", json=REQ)
    assert res.status_code == 503
    assert client.get("/api/options").json()["ai_available"] is False
    assert client.get("/readyz").status_code == 503
