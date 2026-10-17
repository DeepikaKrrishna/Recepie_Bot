"""FastAPI application factory.

  GET  /healthz, /readyz                 liveness / readiness
  GET  /api/options                      cuisines, diets, moods for the UI
  POST /api/recipes/generate             validated AI recipes          [signed in, rate limited]
  POST /api/recipes/substitute           ingredient swaps              [signed in, rate limited]
  Accounts: routers/account.py · Cookbook: routers/cookbook.py
Every other GET path in APP_ROUTES serves the single-page app shell.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from starlette.concurrency import run_in_threadpool

from . import __version__
from .auth import AuthContext, check_origin, require_auth
from .config import Settings, get_settings
from .db import make_engine, make_sessionmaker
from .llm import ChatClient, LLMError, LLMTimeout
from .recipes import DISCLAIMER, generate_recipes, suggest_substitutes
from .routers import account, cookbook
from .schemas import (
    CUISINES,
    DIETS,
    OCCASIONS,
    GenerateRequest,
    GenerateResponse,
    SubstituteRequest,
    SubstituteResponse,
)
from .security import RateLimiter, SecurityMiddleware, client_ip, configure_logging

log = logging.getLogger("recipebot")

# Client-side routes that return the app shell on a full page load.
APP_ROUTES = [
    "/",
    "/welcome",
    "/login",
    "/signup",
    "/results",
    "/recipe/{rest:path}",
    "/cookbook",
    "/cookbook/{rest:path}",
    "/account",
]

# Upper bound for one user request, including retries and model fallbacks.
REQUEST_DEADLINE_SECONDS = 90


async def with_deadline(coro, seconds: float = REQUEST_DEADLINE_SECONDS):
    try:
        return await asyncio.wait_for(coro, timeout=seconds)
    except TimeoutError:
        raise LLMTimeout() from None


def create_app(
    settings: Settings | None = None,
    llm_transport: httpx.AsyncBaseTransport | None = None,
    auto_migrate: bool | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    llm = ChatClient(settings, transport=llm_transport)
    engine = make_engine(settings.database_url)
    ai_limiter = RateLimiter(settings.ai_rate_limit_per_minute, 60.0)
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
                "ai_provider": settings.ai_provider,
                "ai_model": settings.ai_model,
                "llm_configured": settings.llm_configured,
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

    def ai_guard(request: Request, ctx: AuthContext = Depends(require_auth)) -> AuthContext:
        """Signed-in users only; limited per user and per IP so one account can't burn the quota."""
        check_origin(request)
        for key in (f"ai:user:{ctx.user.id}", f"ai:ip:{client_ip(request, settings.trust_proxy)}"):
            allowed, retry = ai_limiter.hit(key)
            if not allowed:
                raise HTTPException(
                    429, "You're cooking fast! Please wait a moment and try again.", headers={"Retry-After": str(retry)}
                )
        if not settings.llm_configured:
            raise HTTPException(503, "Recipe generation is not configured on this server yet.")
        return ctx

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
        checks = {"database": db_ok, "llm_configured": settings.llm_configured}
        ready = all(checks.values())
        return JSONResponse(
            {"status": "ready" if ready else "degraded", "version": __version__, "checks": checks},
            status_code=200 if ready else 503,
        )

    # ---- recipes ------------------------------------------------------------------
    @app.get("/api/options", tags=["recipes"])
    async def options():
        return {
            "cuisines": CUISINES,
            "diets": DIETS,
            "occasions": OCCASIONS,
            "difficulties": ["easy", "medium", "hard"],
            "ai_available": settings.llm_configured,
            "demo_mode": settings.ai_provider == "demo",
            "disclaimer": DISCLAIMER,
        }

    @app.post("/api/recipes/generate", response_model=GenerateResponse, tags=["recipes"])
    async def api_generate(body: GenerateRequest, _ctx: AuthContext = Depends(ai_guard)):
        if not body.has_subject():
            raise HTTPException(status_code=422, detail="Add at least one ingredient or a dish idea.")
        if body.exclude and body.ingredients:
            clash = {i.lower() for i in body.ingredients} & {e.lower() for e in body.exclude}
            if clash:
                raise HTTPException(status_code=422, detail="An ingredient is both included and excluded.")
        return await with_deadline(generate_recipes(llm, body))

    @app.post("/api/recipes/substitute", response_model=SubstituteResponse, tags=["recipes"])
    async def api_substitute(body: SubstituteRequest, _ctx: AuthContext = Depends(ai_guard)):
        return await with_deadline(suggest_substitutes(llm, body), 60)

    app.include_router(account.router)
    app.include_router(cookbook.router)

    @app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
    async def api_not_found(rest: str):
        raise HTTPException(404, "Not found.")

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
