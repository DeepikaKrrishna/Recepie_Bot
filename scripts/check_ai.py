"""Developer utility: check that the configured AI key and model(s) respond.

Reads the key from .env / the environment (GROQ_API_KEY, GEMINI_API_KEY,
OPENROUTER_API_KEY or AI_API_KEY) and never prints it.

Usage:
    python scripts/check_ai.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import load_settings  # noqa: E402


def main() -> int:
    s = load_settings()
    if not s.llm_configured:
        print("No AI key found. Put GROQ_API_KEY=... in .env (free key: https://console.groq.com/keys).")
        return 1
    print(f"Provider: {s.ai_provider}  ({s.ai_base_url})")
    ok = False
    for model in s.models:
        try:
            res = httpx.post(
                f"{s.ai_base_url}/chat/completions",
                headers={"Authorization": f"Bearer {s.ai_api_key}"},
                json={"model": model, "messages": [{"role": "user", "content": "Reply with OK"}], "max_tokens": 5},
                timeout=30,
            )
            print(f"  {model}: HTTP {res.status_code}" + ("  ✓" if res.status_code == 200 else ""))
            if res.status_code in (401, 403):
                print("    The key was rejected: check it, or create a new one.")
            ok = ok or res.status_code == 200
        except httpx.HTTPError as exc:
            print(f"  {model}: {type(exc).__name__}")
    return 0 if ok else 2


if __name__ == "__main__":
    sys.exit(main())
