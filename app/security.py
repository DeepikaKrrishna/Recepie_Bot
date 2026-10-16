"""Request-level protections: body size limit, security headers, request logging,
and an in-memory rate limiter for expensive AI endpoints.

The rate limiter is per-process. For multiple instances, replace `RateLimiter`
with a shared store (e.g. Redis); the dependency interface stays the same.
"""

from __future__ import annotations

import json
import logging
import math
import threading
import time
import uuid
from collections import deque

from fastapi import HTTPException, Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .config import Settings

log = logging.getLogger("recipebot.http")


# ---- logging -------------------------------------------------------------------

_STD_ATTRS = set(logging.makeLogRecord({}).__dict__) | {"message", "asctime"}


class JsonFormatter(logging.Formatter):
    """One JSON object per line. Only explicit `extra` fields are included."""

    def format(self, record: logging.LogRecord) -> str:
        data = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key not in _STD_ATTRS and not key.startswith("_"):
                data[key] = value
        if record.exc_info:
            data["exc"] = self.formatException(record.exc_info)
        return json.dumps(data, default=str)


def configure_logging(level: str) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level if level in logging._nameToLevel else "INFO")
    # httpx logs full URLs at INFO; keep it quiet.
    logging.getLogger("httpx").setLevel(logging.WARNING)


# ---- client identity ------------------------------------------------------------


def client_ip(scope_or_request, trust_proxy: bool) -> str:
    scope = scope_or_request.scope if isinstance(scope_or_request, Request) else scope_or_request
    if trust_proxy:
        for name, value in scope.get("headers", []):
            if name == b"x-forwarded-for":
                first = value.decode("latin-1").split(",")[0].strip()
                if first:
                    return first[:64]
    client = scope.get("client")
    return client[0] if client else "unknown"


# ---- middleware ------------------------------------------------------------------


class SecurityMiddleware:
    """Pure ASGI middleware (works with streaming responses).

    - Rejects bodies larger than `max_request_bytes` (413), whether or not
      Content-Length is sent.
    - Adds security headers and an X-Request-ID.
    - Logs one structured line per request (method, path, status, latency).
      Query strings and bodies are never logged.
    """

    def __init__(self, app: ASGIApp, settings: Settings):
        self.app = app
        self.settings = settings
        csp = (
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
            "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; "
            "form-action 'self'; frame-ancestors 'none'"
        )
        self.headers = [
            (b"content-security-policy", csp.encode()),
            (b"x-content-type-options", b"nosniff"),
            (b"x-frame-options", b"DENY"),
            (b"referrer-policy", b"strict-origin-when-cross-origin"),
            (b"permissions-policy", b"camera=(), geolocation=(), microphone=(self)"),
            (b"cross-origin-opener-policy", b"same-origin"),
        ]
        if settings.is_production:
            self.headers.append((b"strict-transport-security", b"max-age=31536000; includeSubDomains"))

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        limit = self.settings.max_request_bytes
        request_id = uuid.uuid4().hex[:16]
        start = time.perf_counter()
        status_holder = {"status": 500}

        for name, value in scope.get("headers", []):
            if name == b"content-length":
                try:
                    too_big = int(value) > limit
                except ValueError:
                    too_big = True
                if too_big:
                    await self._reject(send, 413, "Request body too large.", request_id)
                    self._log(scope, 413, start, request_id)
                    return

        has_length = any(name == b"content-length" for name, _ in scope.get("headers", []))
        if not has_length and scope.get("method") in ("POST", "PUT", "PATCH"):
            # Chunked upload: buffer up to the limit so we can answer 413 cleanly.
            buffered: list[Message] = []
            total = 0
            while True:
                message = await receive()
                if message["type"] != "http.request":
                    buffered.append(message)
                    break
                total += len(message.get("body", b""))
                if total > limit:
                    await self._reject(send, 413, "Request body too large.", request_id)
                    self._log(scope, 413, start, request_id)
                    return
                buffered.append(message)
                if not message.get("more_body", False):
                    break
            upstream = receive

            async def replay() -> Message:
                return buffered.pop(0) if buffered else await upstream()

            receive = replay

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise _BodyTooLarge()
            return message

        response_started = False

        async def send_wrapper(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
                status_holder["status"] = message["status"]
                headers = list(message.get("headers", []))
                existing = {k.lower() for k, _ in headers}
                headers += [(k, v) for k, v in self.headers if k not in existing]
                headers.append((b"x-request-id", request_id.encode()))
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, limited_receive, send_wrapper)
        except _BodyTooLarge:
            if not response_started:
                await self._reject(send, 413, "Request body too large.", request_id)
            status_holder["status"] = 413
        finally:
            self._log(scope, status_holder["status"], start, request_id)

    def _log(self, scope: Scope, status: int, start: float, request_id: str) -> None:
        path = scope.get("path", "")
        if path.startswith("/static/"):
            return
        log.info(
            "request",
            extra={
                "request_id": request_id,
                "method": scope.get("method"),
                "path": path,
                "status": status,
                "ms": round((time.perf_counter() - start) * 1000, 1),
            },
        )

    async def _reject(self, send: Send, status: int, detail: str, request_id: str) -> None:
        body = json.dumps({"detail": detail}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                    (b"x-request-id", request_id.encode()),
                    *self.headers,
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})


class _BodyTooLarge(Exception):
    pass


# ---- rate limiting -----------------------------------------------------------------


class RateLimiter:
    """Sliding-window limiter: at most `limit` hits per `window` seconds per key."""

    def __init__(self, limit: int, window: float = 60.0, max_keys: int = 50_000):
        self.limit = limit
        self.window = window
        self.max_keys = max_keys
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str, now: float | None = None) -> tuple[bool, int]:
        """Record a hit. Returns (allowed, retry_after_seconds)."""
        now = time.monotonic() if now is None else now
        with self._lock:
            if len(self._hits) > self.max_keys:
                self._prune(now)
            q = self._hits.setdefault(key, deque())
            while q and now - q[0] >= self.window:
                q.popleft()
            if len(q) >= self.limit:
                return False, max(1, math.ceil(self.window - (now - q[0])))
            q.append(now)
            return True, 0

    def _prune(self, now: float) -> None:
        for key in [k for k, q in self._hits.items() if not q or now - q[-1] >= self.window]:
            del self._hits[key]

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


def rate_limit_dependency(limiter: RateLimiter, settings: Settings, bucket: str):
    async def _check(request: Request) -> None:
        allowed, retry_after = limiter.hit(f"{bucket}:{client_ip(request, settings.trust_proxy)}")
        if not allowed:
            raise HTTPException(
                status_code=429,
                detail="Too many requests. Please wait a moment and try again.",
                headers={"Retry-After": str(retry_after)},
            )

    return _check
