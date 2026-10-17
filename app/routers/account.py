"""Signup, login, logout, profile, password change, game score, export, deletion."""

from __future__ import annotations

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
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
from ..models import SavedRecipe, User, UserSession, utcnow
from ..security import client_ip

router = APIRouter(prefix="/api", tags=["account"])

Password = Annotated[str, StringConstraints(min_length=1, max_length=128, strip_whitespace=False)]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class SignupIn(Strict):
    email: Annotated[str, StringConstraints(max_length=254)]
    password: Password
    display_name: Annotated[str, StringConstraints(max_length=60)] = ""


class LoginIn(Strict):
    email: Annotated[str, StringConstraints(max_length=254)]
    password: Password


class ProfileIn(Strict):
    display_name: Annotated[str, StringConstraints(max_length=60)]


class PasswordChangeIn(Strict):
    current_password: Password
    new_password: Password


class DeleteAccountIn(Strict):
    password: Password
    confirm: Annotated[str, StringConstraints(max_length=20)]


class GameScoreIn(Strict):
    score: int = Field(ge=0, le=1_000_000)


def _me(db: Session, ctx: AuthContext) -> dict:
    user = ctx.user
    saved = db.scalar(select(func.count()).select_from(SavedRecipe).where(SavedRecipe.user_id == user.id)) or 0
    return {
        "user": {
            "email": user.email,
            "display_name": user.display_name,
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "stats": {"saved": saved, "cooked": user.cooked_count, "best_game_score": user.best_game_score},
        },
        "csrf_token": ctx.session.csrf_token,
    }


def _throttle(request: Request, key: str) -> None:
    allowed, retry = request.app.state.login_limiter.hit(key)
    if not allowed:
        raise HTTPException(429, "Too many attempts. Please wait a minute and try again.", headers={"Retry-After": str(retry)})


def _ip(request: Request) -> str:
    return client_ip(request, request.app.state.settings.trust_proxy)


@router.post("/auth/signup", status_code=201)
def signup(body: SignupIn, request: Request, response: Response, db: Session = Depends(get_db)):
    check_origin(request)
    _throttle(request, f"signup:{_ip(request)}")
    try:
        email = validate_email(body.email)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    problem = password_problems(body.password, email)
    if problem:
        raise HTTPException(422, problem)
    user = User(email=email, password_hash=hash_password(body.password), display_name=body.display_name[:60])
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "An account with this email already exists. Try signing in.") from None
    session = create_session(db, user, request.app.state.settings, response)
    return _me(db, AuthContext(user=user, session=session))


@router.post("/auth/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    check_origin(request)
    email = body.email.strip().lower()
    _throttle(request, f"login-ip:{_ip(request)}")
    _throttle(request, f"login-email:{email}")
    user = db.scalar(select(User).where(User.email == email))
    ok, new_hash = verify_password(user.password_hash if user else None, body.password)
    if not ok or user is None:
        raise HTTPException(401, "Email or password is incorrect.")
    if new_hash:
        user.password_hash = new_hash
    session = create_session(db, user, request.app.state.settings, response)
    return _me(db, AuthContext(user=user, session=session))


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
def me(ctx: AuthContext | None = Depends(optional_auth), db: Session = Depends(get_db)):
    if ctx is None:
        return {"user": None}
    return _me(db, ctx)


@router.put("/account/profile")
def update_profile(body: ProfileIn, ctx: AuthContext = Depends(require_csrf), db: Session = Depends(get_db)):
    user = db.get(User, ctx.user.id)
    user.display_name = body.display_name[:60]
    db.commit()
    return _me(db, AuthContext(user=user, session=ctx.session))


@router.post("/account/game-score")
def game_score(body: GameScoreIn, ctx: AuthContext = Depends(require_csrf), db: Session = Depends(get_db)):
    """Keep the player's best Chef Run score."""
    user = db.get(User, ctx.user.id)
    new_best = body.score > user.best_game_score
    if new_best:
        user.best_game_score = body.score
        db.commit()
    return {"best": user.best_game_score, "new_best": new_best}


@router.post("/account/password", status_code=204)
def change_password(
    body: PasswordChangeIn, response: Response, ctx: AuthContext = Depends(require_csrf), db: Session = Depends(get_db)
):
    user = db.get(User, ctx.user.id)
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


@router.get("/account/export")
def export_data(ctx: AuthContext = Depends(require_auth), db: Session = Depends(get_db)):
    """Everything we store about the signed-in user, as JSON."""

    def iso(v):
        return v.isoformat() if isinstance(v, dt.date | dt.datetime) else v

    u = ctx.user
    recipes = db.scalars(select(SavedRecipe).where(SavedRecipe.user_id == u.id)).all()
    return {
        "exported_at": utcnow().isoformat(),
        "account": {
            "email": u.email,
            "display_name": u.display_name,
            "created_at": iso(u.created_at),
            "cooked_count": u.cooked_count,
            "best_game_score": u.best_game_score,
        },
        "saved_recipes": [
            {
                "title": r.title,
                "recipe": r.data,
                "favorite": r.favorite,
                "notes": r.notes,
                "cooked_count": r.cooked_count,
                "created_at": iso(r.created_at),
            }
            for r in recipes
        ],
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
    user = db.get(User, ctx.user.id)
    ok, _ = verify_password(user.password_hash, body.password)
    if not ok:
        raise HTTPException(401, "Password is incorrect.")
    # Explicit deletes keep this correct even on databases without FK cascades.
    for model in (SavedRecipe, UserSession):
        db.execute(delete(model).where(model.user_id == user.id))
    db.delete(user)
    db.commit()
    clear_session_cookie(response, request.app.state.settings)
    response.status_code = 204
    return response
