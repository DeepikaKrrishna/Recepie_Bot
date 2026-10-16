"""FastAPI application factory.

Public
  GET  /healthz, /readyz                 liveness / readiness
  GET  /api/options                      cuisines, diets, occasions for the UI
  GET  /api/suggest                      instant matches from the local dataset
  POST /api/recipes/generate             validated AI recipes (rescue mode via use_first)   [rate limited]
  POST /api/recipes/substitute           ingredient substitutions                           [rate limited]
  POST /api/ask                          Ask the Chef                                       [rate limited]
  GET  /api/shared/{share_id}            a recipe its owner chose to share
Accounts (see routers/account.py), cookbook, pantry, planner and shopping routers.

Legacy routes from v0.1 kept for compatibility: GET /suggest, POST /generate (SSE), POST /ask.
Every other non-API GET path in APP_ROUTES serves the single-page app shell.
"""

from __future__ import annotations

import asyncio
import datetime as dt
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
from sqlalchemy import text
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from . import __version__
from .auth import AuthContext, check_origin, optional_auth
from .config import Settings, get_settings
from .db import get_db, make_engine, make_sessionmaker
from .llm import LLMError, LLMTimeout, OpenRouterClient
from .models import GenerationHistory, Preferences, utcnow
from .recipes import DISCLAIMER, ask_chef, dataset_filter, generate_recipes, legacy_stream_messages, suggest_substitutes
from .recommender import RecipeRecommender
from .routers import account, cookbook, pantry, planner
from .schemas import (
    CUISINES,
    DIETS,
    OCCASIONS,
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

# Client-side routes that should return the app shell on a full page load.
APP_ROUTES = [
    "/",
    "/discover",
    "/results",
    "/recipe/{rest:path}",
    "/cookbook",
    "/cookbook/{rest:path}",
    "/pantry",
    "/plan",
    "/shopping",
    "/account",
    "/login",
    "/signup",
    "/r/{rest:path}",
    "/cook/{rest:path}",
]


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


def record_history(db: Session, ctx: AuthContext, body: GenerateRequest, result: GenerateResponse) -> None:
    prefs = db.get(Preferences, ctx.user.id)
    days = prefs.history_retention_days if prefs else 30
    if days <= 0:
        return
    request = body.model_dump(mode="json", exclude_none=True, exclude={"count"})
    db.add(
        GenerationHistory(
            user_id=ctx.user.id,
            request=request,
            titles=[r.title for r in result.recipes],
            expires_at=utcnow() + dt.timedelta(days=days),
        )
    )
    db.commit()


def create_app(
    settings: Settings | None = None,
    llm_transport: httpx.AsyncBaseTransport | None = None,
    auto_migrate: bool | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    llm = OpenRouterClient(settings, transport=llm_transport)
    recommender = RecipeRecommender(str(settings.recipes_csv))
    engine = make_engine(settings.database_url)
    ai_limiter = RateLimiter(settings.ai_rate_limit_per_minute, 60.0)
    suggest_limiter = RateLimiter(max(60, settings.ai_rate_limit_per_minute * 10), 60.0)
    login_limiter = RateLimiter(settings.login_rate_limit_per_minute, 60.0)
    if auto_migrate is None:
        auto_migrate = not settings.is_production

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if auto_migrate:
            from .migrate import upgrade

            await run_in_threadpool(upgrade, engine)
        log.info(
            "startup",
            extra={
                "env": settings.app_env,
                "llm_configured": settings.llm_configured,
                "recipes": len(recommender),
                "db": engine.dialect.name,
            },
        )
        yield
        await llm.aclose()
        engine.dispose()

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
    app.state.engine = engine
    app.state.sessionmaker = make_sessionmaker(engine)
    app.state.ai_limiter = ai_limiter
    app.state.suggest_limiter = suggest_limiter
    app.state.login_limiter = login_limiter

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
    def readyz():
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            db_ok = True
        except Exception:  # noqa: BLE001 - report, don't raise
            db_ok = False
        checks = {"database": db_ok, "recipe_dataset": len(recommender) > 0, "llm_configured": settings.llm_configured}
        ready = all(checks.values())
        return JSONResponse(
            {"status": "ready" if ready else "degraded", "version": __version__, "checks": checks},
            status_code=200 if ready else 503,
        )

    # ---- AI + discovery ----------------------------------------------------------
    @app.get("/api/options", tags=["recipes"])
    async def options():
        return {
            "cuisines": CUISINES,
            "diets": DIETS,
            "occasions": OCCASIONS,
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
    async def api_generate(
        body: GenerateRequest,
        request: Request,
        ctx: AuthContext | None = Depends(optional_auth),
        db: Session = Depends(get_db),
    ):
        check_origin(request)
        if not body.has_subject():
            raise HTTPException(status_code=422, detail="Add at least one ingredient or a dish idea.")
        if body.exclude and (body.ingredients or body.use_first):
            clash = {i.lower() for i in body.ingredients + body.use_first} & {e.lower() for e in body.exclude}
            if clash:
                raise HTTPException(status_code=422, detail="An ingredient is both included and excluded.")
        result = await with_deadline(generate_recipes(llm, body, settings.default_currency))
        if ctx is not None:
            try:
                await run_in_threadpool(record_history, db, ctx, body, result)
            except Exception:  # noqa: BLE001 - history is best-effort; never fail the user's request
                log.warning("history_write_failed")
                db.rollback()
        return result

    @app.post("/api/recipes/substitute", response_model=SubstituteResponse, tags=["recipes"], dependencies=[ai_limit])
    async def api_substitute(body: SubstituteRequest, request: Request):
        check_origin(request)
        return await with_deadline(suggest_substitutes(llm, body), 60)

    @app.post("/api/ask", response_model=AskResponse, tags=["chef"], dependencies=[ai_limit])
    async def api_ask(body: AskRequest, request: Request):
        check_origin(request)
        return await with_deadline(ask_chef(llm, body.question), 60)

    app.include_router(account.router)
    app.include_router(cookbook.router)
    app.include_router(pantry.router)
    app.include_router(planner.router)

    @app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
    async def api_not_found(rest: str):
        raise HTTPException(404, "Not found.")

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
                async for chunk in llm.stream(legacy_stream_messages(body.title)):
                    yield f"data: {json.dumps({'text': chunk})}\n\n"
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
        shell = static_dir / "index.html"

        async def app_shell():
            return FileResponse(shell, headers={"Cache-Control": "no-cache"})

        for route in APP_ROUTES:
            app.add_api_route(route, app_shell, methods=["GET", "HEAD"], include_in_schema=False)

        for page in ("privacy", "terms"):

            def _page(name=page):
                async def handler():
                    return FileResponse(static_dir / f"{name}.html", headers={"Cache-Control": "no-cache"})

                return handler

            app.add_api_route(f"/{page}", _page(), methods=["GET", "HEAD"], include_in_schema=False)

        @app.get("/manifest.webmanifest", include_in_schema=False)
        async def manifest():
            return FileResponse(static_dir / "manifest.webmanifest", media_type="application/manifest+json")

        @app.get("/sw.js", include_in_schema=False)
        async def service_worker():
            return FileResponse(
                static_dir / "js" / "sw.js",
                media_type="text/javascript",
                headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"},
            )

    return app
