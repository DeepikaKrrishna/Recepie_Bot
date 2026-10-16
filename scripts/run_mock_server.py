"""Run the app locally against a FAKE AI provider (no API key, no network).

Useful for UI work and demos. Every recipe it returns is canned sample data.

    python scripts/run_mock_server.py   # http://127.0.0.1:8000
"""

from __future__ import annotations

import dataclasses
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import uvicorn  # noqa: E402

from app.config import load_settings  # noqa: E402
from app.main import create_app  # noqa: E402
from tests.fakes import FakeOpenRouter  # noqa: E402

settings = dataclasses.replace(load_settings(), openrouter_api_key="fake-key-for-local-mock", ai_rate_limit_per_minute=60)
app = create_app(settings, llm_transport=FakeOpenRouter().transport)

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("PORT", "8000")))
