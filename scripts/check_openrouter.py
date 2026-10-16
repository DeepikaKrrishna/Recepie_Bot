"""Developer utility: check that the configured OpenRouter key and model respond.

Replaces the old ad-hoc probe scripts (verify_key.py, test_models*.py, ...), which
had API keys hardcoded in them. This script reads the key from the environment
and never prints it.

Usage:
    python scripts/check_openrouter.py            # ping configured model(s)
    python scripts/check_openrouter.py --list-free  # list currently free models
"""

from __future__ import annotations

import argparse
import os
import sys

import httpx
from dotenv import load_dotenv

API = "https://openrouter.ai/api/v1"


def list_free() -> int:
    res = httpx.get(f"{API}/models", timeout=20)
    res.raise_for_status()
    models = res.json().get("data", [])
    free = [m["id"] for m in models if str(m.get("pricing", {}).get("prompt")) == "0"]
    print(f"{len(free)} free models currently listed:")
    for model_id in free:
        print("  ", model_id)
    return 0


def ping() -> int:
    key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not key:
        print("OPENROUTER_API_KEY is not set (put it in .env or your environment).")
        return 1
    models = [os.getenv("OPENROUTER_MODEL", "google/gemma-3-4b-it:free")]
    models += [m.strip() for m in os.getenv("OPENROUTER_FALLBACK_MODELS", "").split(",") if m.strip()]
    ok = False
    for model in models:
        try:
            res = httpx.post(
                f"{API}/chat/completions",
                headers={"Authorization": f"Bearer {key}"},
                json={"model": model, "messages": [{"role": "user", "content": "Reply with OK"}], "max_tokens": 5},
                timeout=30,
            )
            print(f"{model}: HTTP {res.status_code}")
            ok = ok or res.status_code == 200
        except httpx.HTTPError as exc:
            print(f"{model}: {type(exc).__name__}")
    return 0 if ok else 2


if __name__ == "__main__":
    load_dotenv()
    parser = argparse.ArgumentParser()
    parser.add_argument("--list-free", action="store_true")
    args = parser.parse_args()
    sys.exit(list_free() if args.list_free else ping())
