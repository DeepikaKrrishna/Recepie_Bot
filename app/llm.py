"""OpenRouter chat-completions client.

- API key stays server-side and is never logged.
- Bounded retries with exponential backoff for timeouts, 429 and 5xx.
- Falls through to configured fallback models when a model is unavailable.
- Errors are mapped to a small set of safe, user-presentable exceptions; provider
  response bodies are never forwarded to the browser.
- Prompts are never logged (they may contain user data).
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass

import httpx

from .config import Settings

log = logging.getLogger("recipebot.llm")


class LLMError(Exception):
    """Base error. `public_message` is safe to show users."""

    status_code = 502
    public_message = "The recipe service returned an unexpected response. Please try again."


class LLMNotConfigured(LLMError):
    status_code = 503
    public_message = "Recipe generation is not configured on this server."


class LLMTimeout(LLMError):
    status_code = 504
    public_message = "The recipe service took too long to respond. Please try again."


class LLMRateLimited(LLMError):
    status_code = 429
    public_message = "The recipe service is busy right now. Please wait a minute and try again."


class LLMUnavailable(LLMError):
    status_code = 503
    public_message = "The AI model is temporarily unavailable. Please try again shortly."


class LLMBadOutput(LLMError):
    status_code = 502
    public_message = "The AI returned a recipe we couldn't validate. Please try again."


class NoSuitableRecipes(LLMError):
    status_code = 422
    public_message = (
        "We couldn't find recipes that fit all of your filters (for example, excluded ingredients or "
        "dietary preferences). Try relaxing a filter and generate again."
    )


@dataclass
class Completion:
    content: str
    model: str


_RETRYABLE = {408, 425, 429, 500, 502, 503, 504}
_MODEL_UNAVAILABLE = {404}
MAX_CONTENT_CHARS = 60_000


class OpenRouterClient:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self.settings = settings
        self._transport = transport
        self._client: httpx.AsyncClient | None = None

    # -- lifecycle --------------------------------------------------------------
    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            s = self.settings
            self._client = httpx.AsyncClient(
                base_url=s.openrouter_base_url,
                timeout=httpx.Timeout(s.openrouter_timeout_seconds, connect=10.0),
                transport=self._transport,
                headers={
                    "HTTP-Referer": s.app_public_url,
                    "X-Title": s.app_title,
                    "Content-Type": "application/json",
                },
            )
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    def _auth(self) -> dict[str, str]:
        if not self.settings.llm_configured:
            raise LLMNotConfigured()
        return {"Authorization": f"Bearer {self.settings.openrouter_api_key}"}

    # -- non-streaming ----------------------------------------------------------
    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        json_mode: bool = False,
        max_tokens: int = 2500,
        temperature: float = 0.6,
    ) -> Completion:
        headers = self._auth()
        last_error: LLMError = LLMUnavailable()
        for model in self.settings.models:
            payload: dict = {
                "model": model,
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": temperature,
            }
            if json_mode:
                payload["response_format"] = {"type": "json_object"}
            try:
                return await self._post_with_retries(model, payload, headers)
            except (LLMUnavailable, LLMTimeout) as exc:
                last_error = exc
                log.warning("model_failed", extra={"model": model, "error": type(exc).__name__})
                continue
        raise last_error

    async def _post_with_retries(self, model: str, payload: dict, headers: dict) -> Completion:
        retries = self.settings.openrouter_max_retries
        attempt = -1
        while attempt < retries:
            attempt += 1
            try:
                res = await self._http().post("/chat/completions", json=payload, headers=headers)
            except httpx.TimeoutException:
                if attempt < retries:
                    await self._backoff(attempt)
                    continue
                raise LLMTimeout() from None
            except httpx.HTTPError:
                if attempt < retries:
                    await self._backoff(attempt)
                    continue
                raise LLMUnavailable() from None

            if res.status_code == 200:
                return self._parse_completion(res, model)

            log.warning("provider_status", extra={"model": model, "status": res.status_code, "attempt": attempt})
            if res.status_code in (401, 403):
                # Bad or revoked key: an operator problem, not something to retry.
                raise LLMNotConfigured()
            if res.status_code in _MODEL_UNAVAILABLE:
                raise LLMUnavailable()
            if res.status_code == 400 and payload.get("response_format"):
                # Some models reject response_format; retry once without it.
                payload = {k: v for k, v in payload.items() if k != "response_format"}
                attempt -= 1  # format downgrade does not consume a retry
                continue
            if res.status_code in _RETRYABLE and attempt < retries:
                await self._backoff(attempt, res.headers.get("retry-after"))
                continue
            if res.status_code == 429:
                raise LLMRateLimited()
            if res.status_code >= 500 or res.status_code in _RETRYABLE:
                raise LLMUnavailable()
            raise LLMError()
        raise LLMUnavailable()

    @staticmethod
    def _parse_completion(res: httpx.Response, model: str) -> Completion:
        try:
            body = res.json()
        except ValueError:
            raise LLMBadOutput() from None
        if isinstance(body, dict) and body.get("error"):
            # OpenRouter occasionally returns 200 with an error object.
            raise LLMUnavailable()
        try:
            content = body["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            raise LLMBadOutput() from None
        if not isinstance(content, str) or not content.strip() or len(content) > MAX_CONTENT_CHARS:
            raise LLMBadOutput()
        return Completion(content=content, model=str(body.get("model") or model))

    @staticmethod
    async def _backoff(attempt: int, retry_after: str | None = None) -> None:
        delay = min(8.0, 0.5 * (2**attempt)) + random.uniform(0, 0.25)
        if retry_after:
            try:
                delay = min(10.0, max(delay, float(retry_after)))
            except ValueError:
                pass
        await asyncio.sleep(delay)

    # -- streaming (legacy /generate endpoint) ---------------------------------
    async def stream(self, messages: list[dict[str, str]], max_tokens: int = 2000) -> AsyncIterator[str]:
        headers = self._auth()
        payload = {"model": self.settings.openrouter_model, "messages": messages, "stream": True, "max_tokens": max_tokens}
        try:
            async with self._http().stream("POST", "/chat/completions", json=payload, headers=headers) as res:
                if res.status_code != 200:
                    log.warning("provider_status", extra={"status": res.status_code, "stream": True})
                    if res.status_code == 429:
                        raise LLMRateLimited()
                    if res.status_code in (401, 403):
                        raise LLMNotConfigured()
                    raise LLMUnavailable()
                async for line in res.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line[6:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                        text = chunk.get("choices", [{}])[0].get("delta", {}).get("content") or ""
                    except (ValueError, AttributeError, IndexError):
                        continue
                    if text:
                        yield text
        except httpx.TimeoutException:
            raise LLMTimeout() from None
        except httpx.HTTPError:
            raise LLMUnavailable() from None


# ---- JSON extraction ---------------------------------------------------------

_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)


def extract_json(text: str) -> object:
    """Pull the first JSON object/array out of a model response.

    Handles markdown code fences and leading/trailing chatter. Raises
    LLMBadOutput when nothing parseable is found.
    """
    candidates = [m.group(1) for m in _FENCE.finditer(text)] + [text]
    decoder = json.JSONDecoder()
    for candidate in candidates:
        candidate = candidate.strip()
        for i, ch in enumerate(candidate):
            if ch in "{[":
                try:
                    obj, _ = decoder.raw_decode(candidate[i:])
                    return obj
                except ValueError:
                    continue
    raise LLMBadOutput()
