"""Application settings, read once from environment variables.

Secrets (the OpenRouter key) live only here on the server and are never sent to
the browser, logged, or included in error messages.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent


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

    openrouter_api_key: str = field(default="", repr=False)  # repr=False: never printed
    openrouter_model: str = "google/gemma-3-4b-it:free"
    openrouter_fallback_models: list[str] = field(default_factory=list)
    openrouter_timeout_seconds: int = 45
    openrouter_max_retries: int = 2
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    app_public_url: str = "http://localhost:8000"
    app_title: str = "Recipe Bot"

    ai_rate_limit_per_minute: int = 8
    max_request_bytes: int = 16384
    default_currency: str = "INR"

    recipes_csv: Path = BASE_DIR / "data" / "recipes.csv"
    static_dir: Path = BASE_DIR / "static"

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"

    @property
    def llm_configured(self) -> bool:
        return bool(self.openrouter_api_key)

    @property
    def models(self) -> list[str]:
        return [self.openrouter_model, *[m for m in self.openrouter_fallback_models if m != self.openrouter_model]]


def load_settings() -> Settings:
    load_dotenv(BASE_DIR / ".env")
    env = os.environ
    return Settings(
        app_env=env.get("APP_ENV", "development"),
        log_level=env.get("LOG_LEVEL", "INFO").upper(),
        allowed_origins=_csv(env.get("ALLOWED_ORIGINS")),
        trust_proxy=_bool(env.get("TRUST_PROXY")),
        openrouter_api_key=env.get("OPENROUTER_API_KEY", "").strip(),
        openrouter_model=env.get("OPENROUTER_MODEL", "").strip() or "google/gemma-3-4b-it:free",
        openrouter_fallback_models=_csv(env.get("OPENROUTER_FALLBACK_MODELS")),
        openrouter_timeout_seconds=_int(env.get("OPENROUTER_TIMEOUT_SECONDS"), 45, 5, 120),
        openrouter_max_retries=_int(env.get("OPENROUTER_MAX_RETRIES"), 2, 0, 4),
        app_public_url=env.get("APP_PUBLIC_URL", "http://localhost:8000"),
        app_title=env.get("APP_TITLE", "Recipe Bot"),
        ai_rate_limit_per_minute=_int(env.get("AI_RATE_LIMIT_PER_MINUTE"), 8, 1, 1000),
        max_request_bytes=_int(env.get("MAX_REQUEST_BYTES"), 16384, 1024, 1_048_576),
        default_currency=(env.get("DEFAULT_CURRENCY", "INR").strip().upper() or "INR")[:3],
    )


@lru_cache
def get_settings() -> Settings:
    return load_settings()
