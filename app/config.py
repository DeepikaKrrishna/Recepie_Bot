"""Application settings, read once from environment variables.

The AI provider is any OpenAI-compatible chat-completions API. Groq is the default
(fast, free tier). The key lives only on the server: it is never sent to the browser,
logged, or included in error messages.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

# Groq retired the Llama 3.x models on 16 Aug 2026; gpt-oss is its recommended replacement.
PROVIDERS = {
    "groq": ("https://api.groq.com/openai/v1", "openai/gpt-oss-120b"),
    "gemini": ("https://generativelanguage.googleapis.com/v1beta/openai", "gemini-2.5-flash"),
    "openrouter": ("https://openrouter.ai/api/v1", "meta-llama/llama-3.3-70b-instruct:free"),
}
# Tried automatically when the primary model is unavailable and AI_FALLBACK_MODELS is unset.
DEFAULT_FALLBACKS = {"groq": ["openai/gpt-oss-20b"]}


def _csv(value: str | None) -> list[str]:
    return [v.strip() for v in (value or "").split(",") if v.strip()]


def _bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _int(value: str | None, default: int, lo: int, hi: int) -> int:
    try:
        return max(lo, min(hi, int(value))) if value not in (None, "") else default
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    app_env: str = "development"
    log_level: str = "INFO"
    allowed_origins: list[str] = field(default_factory=list)
    trust_proxy: bool = False

    ai_provider: str = "groq"
    ai_api_key: str = field(default="", repr=False)  # repr=False: never printed
    ai_base_url: str = PROVIDERS["groq"][0]
    ai_model: str = PROVIDERS["groq"][1]
    ai_fallback_models: list[str] = field(default_factory=list)
    ai_timeout_seconds: int = 45
    ai_max_retries: int = 2
    app_public_url: str = "http://localhost:8000"
    app_title: str = "Recipe Bot"

    ai_rate_limit_per_minute: int = 8
    max_request_bytes: int = 16384

    database_url: str = field(default=f"sqlite:///{BASE_DIR / 'recipebot.sqlite3'}", repr=False)
    session_days: int = 30
    login_rate_limit_per_minute: int = 8

    static_dir: Path = BASE_DIR / "static"

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"

    @property
    def cookie_secure(self) -> bool:
        return self.is_production

    @property
    def llm_configured(self) -> bool:
        return bool(self.ai_api_key)

    @property
    def models(self) -> list[str]:
        return [self.ai_model, *[m for m in self.ai_fallback_models if m != self.ai_model]]


def load_settings() -> Settings:
    load_dotenv(BASE_DIR / ".env")
    env = os.environ
    provider = env.get("AI_PROVIDER", "").strip().lower()
    key = env.get("AI_API_KEY", "").strip()
    # Provider-specific key names are accepted too, so a pasted .env "just works".
    for name, var in (("groq", "GROQ_API_KEY"), ("gemini", "GEMINI_API_KEY"), ("openrouter", "OPENROUTER_API_KEY")):
        if not key and env.get(var, "").strip():
            key, provider = env[var].strip(), provider or name
    provider = provider if provider in PROVIDERS else "groq"
    base_url, model = PROVIDERS[provider]
    return Settings(
        app_env=env.get("APP_ENV", "development"),
        log_level=env.get("LOG_LEVEL", "INFO").upper(),
        allowed_origins=_csv(env.get("ALLOWED_ORIGINS")),
        trust_proxy=_bool(env.get("TRUST_PROXY")),
        ai_provider=provider,
        ai_api_key=key,
        ai_base_url=(env.get("AI_BASE_URL", "").strip() or base_url).rstrip("/"),
        ai_model=env.get("AI_MODEL", "").strip() or model,
        ai_fallback_models=_csv(env.get("AI_FALLBACK_MODELS")) or DEFAULT_FALLBACKS.get(provider, []),
        ai_timeout_seconds=_int(env.get("AI_TIMEOUT_SECONDS"), 45, 5, 120),
        ai_max_retries=_int(env.get("AI_MAX_RETRIES"), 2, 0, 4),
        app_public_url=env.get("APP_PUBLIC_URL", "http://localhost:8000"),
        app_title=env.get("APP_TITLE", "Recipe Bot"),
        ai_rate_limit_per_minute=_int(env.get("AI_RATE_LIMIT_PER_MINUTE"), 8, 1, 1000),
        max_request_bytes=_int(env.get("MAX_REQUEST_BYTES"), 16384, 1024, 1_048_576),
        database_url=env.get("DATABASE_URL", "").strip() or f"sqlite:///{BASE_DIR / 'recipebot.sqlite3'}",
        session_days=_int(env.get("SESSION_DAYS"), 30, 1, 365),
        login_rate_limit_per_minute=_int(env.get("LOGIN_RATE_LIMIT_PER_MINUTE"), 8, 1, 100),
    )


@lru_cache
def get_settings() -> Settings:
    return load_settings()
