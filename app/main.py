"""FastAPI application factory.

Routes
  GET  /                         web app (static/index.html)
  GET  /healthz                  liveness
  GET  /readyz                   readiness + non-secret config status
  GET  /api/options              cuisines / diets for the UI
  GET  /api/suggest              instant matches from the local recipe dataset
  POST /api/recipes/generate     structured, validated AI recipes        (rate limited)
  POST /api/recipes/substitute   ingredient substitutions                (rate limited)
  POST /api/ask                  "Ask the Chef"                          (rate limited)

Legacy routes kept for backward compatibility with the original frontend:
  GET /suggest, POST /generate (SSE markdown stream), POST /ask
"""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import Annotated

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, StringConstraints

from . import __version__
from .config import Settings, get_settings
from .llm import LLMError, LLMTimeout, OpenRouterClient
from .recipes import DISCLAIMER, ask_chef, dataset_filter, generate_recipes, legacy_stream_messages, suggest_substitutes
from .recommender import RecipeRecommender
from .schemas import (
    CUISINES,
    DIETS,
    AskRequest,
    AskResponse,
    GenerateRequest,
    GenerateResponse,
    SubstituteRequest,
    SubstituteResponse,
    clean_text,
    validate_diets,
)
from .security import RateLimiter, SecurityMiddleware, configure_logging, rate_limit_dependency

log = logging.getLogger("recipebot")


class LegacyGenerate(BaseModel):
    """Request body of the original /generate endpoint."""

    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


# Upper bound for one user request, including retries and model fallbacks.
REQUEST_DEADLINE_SECONDS = 90


async def with_deadline(coro, seconds: float = REQUEST_DEADLINE_SECONDS):
    try:
        return await asyncio.wait_for(coro, timeout=seconds)
    except TimeoutError:
        raise LLMTimeout() from None


def create_app(settings: Settings | None = None, llm_transport: httpx.AsyncBaseTransport | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    llm = OpenRouterClient(settings, transport=llm_transport)
    recommender = RecipeRecommender(str(settings.recipes_csv))
    ai_limiter = RateLimiter(settings.ai_rate_limit_per_minute, 60.0)
    suggest_limiter = RateLimiter(max(60, settings.ai_rate_limit_per_minute * 10), 60.0)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        log.info(
            "startup",
            extra={"env": settings.app_env, "llm_configured": settings.llm_configured, "recipes": len(recommender)},
        )
        yield
        await llm.aclose()

    app = FastAPI(
        title="Recipe Bot API",
        version=__version__,
        lifespan=lifespan,
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
    )
    app.state.settings = settings
    app.state.llm = llm
    app.state.ai_limiter = ai_limiter
    app.state.suggest_limiter = suggest_limiter

    if settings.allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.allowed_origins,
            allow_credentials=False,
            allow_methods=["GET", "POST"],
            allow_headers=["Content-Type"],
        )
    app.add_middleware(SecurityMiddleware, settings=settings)

    ai_limit = Depends(rate_limit_dependency(ai_limiter, settings, "ai"))
    suggest_limit = Depends(rate_limit_dependency(suggest_limiter, settings, "suggest"))

    # ---- error handling ---------------------------------------------------------
    @app.exception_handler(LLMError)
    async def _llm_error(_request: Request, exc: LLMError):
        log.warning("llm_error", extra={"error": type(exc).__name__})
        headers = {"Retry-After": "30"} if exc.status_code == 429 else None
        return JSONResponse({"detail": exc.public_message}, status_code=exc.status_code, headers=headers)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_request: Request, exc: RequestValidationError):
        # Return field paths and messages only; never echo the submitted input back.
        errors = [
            {"field": ".".join(str(p) for p in e.get("loc", ())[1:]) or "body", "message": e.get("msg", "Invalid value")}
            for e in exc.errors()
        ][:10]
        return JSONResponse({"detail": "Please check your input.", "errors": errors}, status_code=422)

    @app.exception_handler(Exception)
    async def _unhandled(_request: Request, exc: Exception):
        log.exception("unhandled_error", extra={"error": type(exc).__name__})
        return JSONResponse({"detail": "Something went wrong on our side. Please try again."}, status_code=500)

    # ---- health ------------------------------------------------------------------
    @app.get("/healthz", tags=["ops"])
    async def healthz():
        return {"status": "ok"}

    @app.get("/readyz", tags=["ops"])
    async def readyz():
        checks = {"recipe_dataset": len(recommender) > 0, "llm_configured": settings.llm_configured}
        ready = all(checks.values())
        return JSONResponse(
            {"status": "ready" if ready else "degraded", "version": __version__, "checks": checks},
            status_code=200 if ready else 503,
        )

    # ---- API v1 ------------------------------------------------------------------
    @app.get("/api/options", tags=["recipes"])
    async def options():
        return {
            "cuisines": CUISINES,
            "diets": DIETS,
            "difficulties": ["easy", "medium", "hard"],
            "default_currency": settings.default_currency,
            "ai_available": settings.llm_configured,
            "disclaimer": DISCLAIMER,
        }

    @app.get("/api/suggest", tags=["recipes"], dependencies=[suggest_limit])
    async def api_suggest(
        ingredients: Annotated[str, Query(max_length=500)] = "",
        diets: Annotated[list[str], Query(max_length=6)] = [],  # noqa: B006 - FastAPI query default
        exclude: Annotated[list[str], Query(max_length=20)] = [],  # noqa: B006
    ):
        if not ingredients.strip():
            return {"matches": [], "fallback": False}
        try:
            diets = validate_diets(diets)
        except ValueError:
            raise HTTPException(status_code=422, detail="Unsupported dietary preference.") from None
        exclude = [clean_text(x)[:60] for x in exclude if clean_text(x)]
        return recommender.suggest(ingredients, top_n=5, allow=dataset_filter(diets, exclude))

    @app.post("/api/recipes/generate", response_model=GenerateResponse, tags=["recipes"], dependencies=[ai_limit])
    async def api_generate(body: GenerateRequest):
        if not body.has_subject():
            raise HTTPException(status_code=422, detail="Add at least one ingredient or a dish idea.")
        if body.exclude and body.ingredients:
            clash = {i.lower() for i in body.ingredients} & {e.lower() for e in body.exclude}
            if clash:
                raise HTTPException(status_code=422, detail="An ingredient is both included and excluded.")
        return await with_deadline(generate_recipes(llm, body, settings.default_currency))

    @app.post("/api/recipes/substitute", response_model=SubstituteResponse, tags=["recipes"], dependencies=[ai_limit])
    async def api_substitute(body: SubstituteRequest):
        return await with_deadline(suggest_substitutes(llm, body), 60)

    @app.post("/api/ask", response_model=AskResponse, tags=["chef"], dependencies=[ai_limit])
    async def api_ask(body: AskRequest):
        return await with_deadline(ask_chef(llm, body.question), 60)

    # ---- legacy (original frontend contract) -----------------------------------------
    @app.get("/suggest", tags=["legacy"], dependencies=[suggest_limit])
    async def legacy_suggest(ingredients: Annotated[str, Query(max_length=500)] = ""):
        if not ingredients:
            return {"suggestions": []}
        return {"suggestions": recommender.suggest_recipes(ingredients, top_n=5)}

    @app.post("/generate", tags=["legacy"], dependencies=[ai_limit])
    async def legacy_generate(body: LegacyGenerate):
        if not settings.llm_configured:
            raise HTTPException(status_code=503, detail="Recipe generation is not configured on this server.")

        async def events():
            try:
                async for text in llm.stream(legacy_stream_messages(body.title)):
                    yield f"data: {json.dumps({'text': text})}\n\n"
            except LLMError as exc:
                yield f"data: {json.dumps({'error': exc.public_message})}\n\n"

        return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-store"})

    @app.post("/ask", tags=["legacy"], dependencies=[ai_limit])
    async def legacy_ask(body: AskRequest):
        result = await with_deadline(ask_chef(llm, body.question), 60)
        return {"answer": result.answer}

    # ---- frontend ---------------------------------------------------------------
    static_dir = settings.static_dir
    if static_dir.exists():
        app.mount("/static", StaticFiles(directory=static_dir), name="static")

        @app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
        async def index():
            return FileResponse(static_dir / "index.html", headers={"Cache-Control": "no-cache"})

        for page in ("privacy", "terms"):

            def _page(name=page):
                async def handler():
                    return FileResponse(static_dir / f"{name}.html", headers={"Cache-Control": "no-cache"})

                return handler

            app.get(f"/{page}", include_in_schema=False)(_page())

    return app
