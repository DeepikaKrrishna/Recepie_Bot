"""Signup, login, logout, preferences, password change, history, export, deletion."""

from __future__ import annotations

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import (
    AuthContext,
    check_origin,
    clear_session_cookie,
    create_session,
    hash_password,
    optional_auth,
    password_problems,
    require_auth,
    require_csrf,
    validate_email,
    verify_password,
)
from ..db import get_db
from ..models import (
    GenerationHistory,
    MealPlanEntry,
    PantryItem,
    Preferences,
    SavedRecipe,
    ShoppingItem,
    User,
    UserSession,
    utcnow,
)
from ..schemas import CUISINES, validate_diets

router = APIRouter(prefix="/api", tags=["account"])


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class SignupIn(Strict):
    email: Annotated[str, StringConstraints(max_length=254)]
    password: Annotated[str, StringConstraints(min_length=1, max_length=128, strip_whitespace=False)]
    display_name: Annotated[str, StringConstraints(max_length=60)] = ""


class LoginIn(Strict):
    email: Annotated[str, StringConstraints(max_length=254)]
    password: Annotated[str, StringConstraints(min_length=1, max_length=128, strip_whitespace=False)]


class PasswordChangeIn(Strict):
    current_password: Annotated[str, StringConstraints(min_length=1, max_length=128, strip_whitespace=False)]
    new_password: Annotated[str, StringConstraints(min_length=1, max_length=128, strip_whitespace=False)]


class DeleteAccountIn(Strict):
    password: Annotated[str, StringConstraints(min_length=1, max_length=128, strip_whitespace=False)]
    confirm: Annotated[str, StringConstraints(max_length=20)]


class PreferencesIn(Strict):
    display_name: Annotated[str, StringConstraints(max_length=60)] | None = None
    diets: list[str] = Field(default_factory=list, max_length=6)
    cuisine: str = "Any"
    servings: int = Field(default=2, ge=1, le=20)
    currency: Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")] = "INR"
    exclude: list[Annotated[str, StringConstraints(min_length=1, max_length=60)]] = Field(default_factory=list, max_length=20)
    history_retention_days: int = Field(default=30, ge=0, le=365)

    @field_validator("diets")
    @classmethod
    def _diets(cls, v: list[str]) -> list[str]:
        return validate_diets(v)

    @field_validator("cuisine")
    @classmethod
    def _cuisine(cls, v: str) -> str:
        match = next((c for c in CUISINES if c.lower() == v.lower()), None)
        if match is None:
            raise ValueError("Unsupported cuisine")
        return match


def _prefs(db: Session, user: User, settings) -> Preferences:
    prefs = db.get(Preferences, user.id)
    if prefs is None:
        prefs = Preferences(
            user_id=user.id,
            diets=[],
            exclude=[],
            cuisine="Any",
            servings=2,
            currency=settings.default_currency,
            history_retention_days=settings.default_history_retention_days,
        )
        db.add(prefs)
        db.flush()
    return prefs


def _prefs_out(p: Preferences) -> dict:
    return {
        "diets": p.diets or [],
        "cuisine": p.cuisine,
        "servings": p.servings,
        "currency": p.currency,
        "exclude": p.exclude or [],
        "history_retention_days": p.history_retention_days,
    }


def _me(db: Session, ctx: AuthContext, settings) -> dict:
    user = ctx.user
    prefs = _prefs(db, user, settings)
    db.commit()
    saved = db.scalar(select(func.count()).select_from(SavedRecipe).where(SavedRecipe.user_id == user.id)) or 0
    return {
        "user": {
            "email": user.email,
            "display_name": user.display_name,
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "stats": {"saved": saved, "cooked": user.cooked_count, "rescued": user.rescued_count},
        },
        "preferences": _prefs_out(prefs),
        "csrf_token": ctx.session.csrf_token,
    }


def _login_limiter(request: Request, key: str) -> None:
    limiter = request.app.state.login_limiter
    allowed, retry = limiter.hit(key)
    if not allowed:
        raise HTTPException(429, "Too many attempts. Please wait a minute and try again.", headers={"Retry-After": str(retry)})


def _client(request: Request) -> str:
    from ..security import client_ip

    return client_ip(request, request.app.state.settings.trust_proxy)


@router.post("/auth/signup", status_code=201)
def signup(body: SignupIn, request: Request, response: Response, db: Session = Depends(get_db)):
    check_origin(request)
    _login_limiter(request, f"signup:{_client(request)}")
    try:
        email = validate_email(body.email)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    problem = password_problems(body.password, email)
    if problem:
        raise HTTPException(422, problem)
    settings = request.app.state.settings
    user = User(email=email, password_hash=hash_password(body.password), display_name=body.display_name[:60])
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "An account with this email already exists. Try signing in.") from None
    _prefs(db, user, settings)
    db.commit()
    session = create_session(db, user, settings, response)
    return _me(db, AuthContext(user=user, session=session), settings)


@router.post("/auth/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    check_origin(request)
    email = body.email.strip().lower()
    _login_limiter(request, f"login-ip:{_client(request)}")
    _login_limiter(request, f"login-email:{email}")
    user = db.scalar(select(User).where(User.email == email))
    ok, new_hash = verify_password(user.password_hash if user else None, body.password)
    if not ok or user is None:
        raise HTTPException(401, "Email or password is incorrect.")
    if new_hash:
        user.password_hash = new_hash
    settings = request.app.state.settings
    session = create_session(db, user, settings, response)
    return _me(db, AuthContext(user=user, session=session), settings)


@router.post("/auth/logout", status_code=204)
def logout(request: Request, response: Response, ctx: AuthContext | None = Depends(optional_auth), db: Session = Depends(get_db)):
    check_origin(request)
    if ctx is not None:
        db.execute(delete(UserSession).where(UserSession.id == ctx.session.id))
        db.commit()
    clear_session_cookie(response, request.app.state.settings)
    response.status_code = 204
    return response


@router.get("/auth/me")
def me(request: Request, ctx: AuthContext | None = Depends(optional_auth), db: Session = Depends(get_db)):
    if ctx is None:
        return {"user": None}
    return _me(db, ctx, request.app.state.settings)


@router.put("/account/preferences")
def update_preferences(
    body: PreferencesIn, request: Request, ctx: AuthContext = Depends(require_csrf), db: Session = Depends(get_db)
):
    prefs = _prefs(db, ctx.user, request.app.state.settings)
    prefs.diets = body.diets
    prefs.cuisine = body.cuisine
    prefs.servings = body.servings
    prefs.currency = body.currency
    prefs.exclude = list(dict.fromkeys(e.lower() for e in body.exclude))
    prefs.history_retention_days = body.history_retention_days
    if body.display_name is not None:
        db.merge(ctx.user).display_name = body.display_name[:60]
    if body.history_retention_days == 0:
        db.execute(delete(GenerationHistory).where(GenerationHistory.user_id == ctx.user.id))
    db.commit()
    return _prefs_out(prefs)


@router.post("/account/password", status_code=204)
def change_password(
    body: PasswordChangeIn,
    request: Request,
    response: Response,
    ctx: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
):
    user = db.merge(ctx.user)
    ok, _ = verify_password(user.password_hash, body.current_password)
    if not ok:
        raise HTTPException(401, "Your current password is incorrect.")
    problem = password_problems(body.new_password, user.email)
    if problem:
        raise HTTPException(422, problem)
    user.password_hash = hash_password(body.new_password)
    # Sign out every other device.
    db.execute(delete(UserSession).where(UserSession.user_id == user.id, UserSession.id != ctx.session.id))
    db.commit()
    response.status_code = 204
    return response


@router.get("/account/history")
def history(ctx: AuthContext = Depends(require_auth), db: Session = Depends(get_db)):
    purge_expired_history(db)
    rows = db.scalars(
        select(GenerationHistory)
        .where(GenerationHistory.user_id == ctx.user.id)
        .order_by(GenerationHistory.created_at.desc())
        .limit(50)
    ).all()
    return [{"id": r.id, "request": r.request, "titles": r.titles, "created_at": r.created_at.isoformat()} for r in rows]


@router.delete("/account/history", status_code=204)
def clear_history(response: Response, ctx: AuthContext = Depends(require_csrf), db: Session = Depends(get_db)):
    db.execute(delete(GenerationHistory).where(GenerationHistory.user_id == ctx.user.id))
    db.commit()
    response.status_code = 204
    return response


@router.get("/account/export")
def export_data(ctx: AuthContext = Depends(require_auth), db: Session = Depends(get_db)):
    """Everything we store about the signed-in user, as JSON."""
    uid = ctx.user.id
    prefs = db.get(Preferences, uid)

    def rows(model):
        return db.scalars(select(model).where(model.user_id == uid)).all()

    def plain(obj, *fields):
        out = {}
        for f in fields:
            v = getattr(obj, f)
            out[f] = v.isoformat() if isinstance(v, dt.date | dt.datetime) else v
        return out

    return {
        "exported_at": utcnow().isoformat(),
        "account": plain(ctx.user, "email", "display_name", "created_at", "cooked_count", "rescued_count"),
        "preferences": _prefs_out(prefs) if prefs else None,
        "saved_recipes": [
            plain(r, "id", "title", "data", "favorite", "notes", "cooked_count", "created_at") for r in rows(SavedRecipe)
        ],
        "pantry": [plain(p, "name", "quantity", "unit", "category", "expires_on") for p in rows(PantryItem)],
        "meal_plan": [plain(m, "day", "slot", "recipe_id", "servings") for m in rows(MealPlanEntry)],
        "shopping_list": [plain(s, "name", "quantity", "unit", "category", "checked") for s in rows(ShoppingItem)],
        "generation_history": [plain(h, "request", "titles", "created_at") for h in rows(GenerationHistory)],
    }


@router.delete("/account", status_code=204)
def delete_account(
    body: DeleteAccountIn,
    request: Request,
    response: Response,
    ctx: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
):
    if body.confirm != "DELETE":
        raise HTTPException(422, "Type DELETE to confirm.")
    user = db.merge(ctx.user)
    ok, _ = verify_password(user.password_hash, body.password)
    if not ok:
        raise HTTPException(401, "Password is incorrect.")
    # Explicit deletes keep this correct even on databases without FK cascades.
    for model in (GenerationHistory, ShoppingItem, MealPlanEntry, PantryItem, SavedRecipe, UserSession, Preferences):
        db.execute(delete(model).where(model.user_id == user.id))
    db.delete(user)
    db.commit()
    clear_session_cookie(response, request.app.state.settings)
    response.status_code = 204
    return response


def purge_expired_history(db: Session) -> int:
    result = db.execute(delete(GenerationHistory).where(GenerationHistory.expires_at < utcnow()))
    db.commit()
    return result.rowcount or 0
